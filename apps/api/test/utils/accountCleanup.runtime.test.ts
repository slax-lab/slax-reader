import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare } = runtimeRequire('miniflare')
const { build } = runtimeRequire('esbuild')
const root = fileURLToPath(new URL('../../', import.meta.url))

test('Workerd consumes failed cleanup once and later cron ticks do not replay it', async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { UserDeletionConsumer } from './src/handler/queue/userDeletionConsumer';
        import { handleMessage } from './src/di/generated/core/consumer';
        import { handleCronjob } from './src/di/generated/core/cronjob';
        const audit = { attempts: [], admitted: 0, acknowledged: [], retried: [], scheduled: [] };
        const consumer = new UserDeletionConsumer({ async cleanupUserData(id) {
          audit.attempts.push(id);
          if (id === 1) {
            audit.admitted++;
            throw new Error('synthetic failure after vector dispatch');
          }
        }});
        const container = { resolve(type) {
          if (type === UserDeletionConsumer) return consumer;
          return new Proxy({}, { get: (_, name) => async () => {
            audit.scheduled.push(name);
            if (name === 'recoverDeletedUsers') {
              await consumer.handleUserDeletion({ env: {} }, { id: 'recovered', info: { userId: 1 } });
            }
          }});
        }};
        export default { async fetch(request, env) {
          const pending = [];
          const execution = { waitUntil(task) { pending.push(task); } };
          if (new URL(request.url).pathname === '/queue') {
            const messages = [1, 2].map(userId => ({
              id: 'delete-' + userId, body: { userId },
              ack() { audit.acknowledged.push(userId); },
              retry() { audit.retried.push(userId); }
            }));
            await handleMessage(container, { queue: 'slax-reader-user-deletion-beta', messages }, env, execution);
          } else {
            const time = Number(new URL(request.url).searchParams.get('time'));
            await handleCronjob(container, { cron: '*/5 * * * *', scheduledTime: time }, env, execution);
            for (let i = 0; i < pending.length; i++) await pending[i];
          }
          return Response.json(audit);
        }};
      `,
      resolveDir: root,
      sourcefile: 'account-cleanup-smoke.ts'
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    tsconfig: `${root}tsconfig.json`,
    plugins: [
      {
        name: 'isolated-cleanup-dependencies',
        setup(builder: any) {
          // Keep the real queue consumer and generated dispatchers; unrelated jobs and I/O are fixtures.
          builder.onLoad({ filter: /src\/handler\/(cron\/\w+Job|queue\/(bookmarkConsumer|subscriptionConsumer))\.ts$/ }, (args: { path: string }) => {
            const file = args.path.split('/').pop()!.replace('.ts', '')
            const name = file[0].toUpperCase() + file.slice(1)
            return { contents: `export class ${name} {}`, loader: 'ts' }
          })
          builder.onLoad({ filter: /src\/domain\/userDeletion\.ts$/ }, () => ({ contents: 'export class UserDeletionService {}', loader: 'ts' }))
        }
      }
    ]
  })
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    cf: false,
    workers: [
      {
        config: {
          name: 'account-cleanup-smoke',
          type: 'worker',
          compatibilityDate: '2026-08-01',
          manifest: { mainModule: 'worker.mjs', modulesRoot: root, modules: { 'worker.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } }
        }
      }
    ]
  })
  try {
    const initial = await (await runtime.dispatchFetch('http://local/queue')).json()
    expect(initial).toMatchObject({ attempts: [1, 2], admitted: 1, acknowledged: [1, 2], retried: [] })
    for (const time of [0, 300_000, 600_000]) {
      const audit = await (await runtime.dispatchFetch(`http://local/cron?time=${time}`)).json()
      expect(audit).toMatchObject({ attempts: [1, 2], admitted: 1, acknowledged: [1, 2], retried: [] })
      expect(audit.scheduled).not.toContain('recoverDeletedUsers')
      for (const name of ['checkImportProgress', 'recoverPayments', 'refreshRss', 'sweepPodcasts', 'sweepYoutubeArticles']) {
        expect(audit.scheduled).toContain(name)
      }
    }
  } finally {
    await runtime.dispose()
  }
}, 30_000)
