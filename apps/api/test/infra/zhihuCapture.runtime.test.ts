import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare } = runtimeRequire('miniflare')
const { build } = runtimeRequire('esbuild')
const root = fileURLToPath(new URL('../../', import.meta.url))

test('persists and reads partial Zhihu captures in Workerd without replaying successful requests', async () => {
  const calls = new Map<string, { detail: number; answers: number }>()
  const wasmModules: Record<string, { type: 'wasm'; contents: Uint8Array }> = {}
  const wasmPaths = new Map<string, string>()
  const bundled = await build({
    plugins: [
      {
        name: 'workerd-wasm-modules',
        setup(pluginBuild: {
          onResolve(options: { filter: RegExp }, callback: (args: { resolveDir: string; path: string }) => Promise<{ path: string; external: boolean }>): void
        }) {
          pluginBuild.onResolve({ filter: /\.wasm$/ }, async args => {
            const absolutePath = resolve(args.resolveDir, args.path)
            let moduleName = wasmPaths.get(absolutePath)
            if (!moduleName) {
              moduleName = `runtime-${wasmPaths.size}.wasm`
              wasmPaths.set(absolutePath, moduleName)
              wasmModules[moduleName] = { type: 'wasm', contents: await readFile(absolutePath) }
            }
            return { path: `./${moduleName}`, external: true }
          })
        }
      }
    ],
    stdin: {
      contents: `
        import { fetchZhihuByUrl, ZhihuCaptureUnavailableError } from './src/infra/external/zhihu';
        import { CrawlService } from './src/domain/crawl';
        import { MediaSnapshotService } from './src/domain/mediaSnapshot';

        const rows = new Map();
        const publications = new Map();
        const repo = {
          async snapshot(id) { return rows.get(id) ?? null; },
          async ownsWrite(id, updatedAt) {
            const row = rows.get(id);
            return row?.status === 'parseing' && row.updated_at.getTime() === updatedAt.getTime();
          },
          async publishRevision(id, oldKey, content, options) {
            const row = rows.get(id);
            if (!row || row.content_key !== oldKey || row.updated_at.getTime() !== options.expectedUpdatedAt.getTime()) return false;
            rows.set(id, { ...row, ...content, ...options.fields, updated_at: options.publishedUpdatedAt });
            publications.set(id, (publications.get(id) ?? 0) + 1);
            return true;
          }
        };

        export default {
          async fetch(request, env) {
            const [, action, scenario] = new URL(request.url).pathname.split('/');
            const snapshots = Object.assign(Object.create(MediaSnapshotService.prototype), {
              repo, bucket: () => ({ R2Bucket: env.OSS })
            });
            if (action === 'read') {
              const row = rows.get(scenario);
              if (!row?.content_key) return Response.json({ saved: false }, { status: 404 });
              const html = await env.OSS.get(row.content_key);
              const text = await env.OSS.get(row.content_md_key);
              const loaded = await snapshots.load(scenario);
              return Response.json({
                saved: true, status: row.status, title: row.title,
                html: await html.text(), text: await text.text(),
                managed: loaded.managed, publications: publications.get(scenario)
              });
            }
            if (action !== 'capture' || request.method !== 'POST') return new Response(null, { status: 404 });
            const revision = new Date('2026-11-15T00:00:00.000Z');
            rows.set(scenario, {
              id: scenario, content_key: '', content_md_key: '', status: 'parseing',
              updated_at: revision, private_user: 1,
              userBookmarks: [{ uuid: 'runtime-' + scenario, user_id: 1 }]
            });
            const context = {
              env: { ...env, TIKHUB_TOKEN: 'offline-test-token', PROXY_IMAGE_PREFIX: 'https://reader.invalid/image_proxy', IMAGER_CHECK_DIGST_SALT: 'offline-only' },
              get(key) { return key === 'snapshotCaptureRevision' ? revision.toISOString() : undefined; }
            };
            const crawl = Object.assign(Object.create(CrawlService.prototype), { snapshots });
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (input, init) => {
              const outgoing = new Request(input, init);
              const target = new URL(outgoing.url);
              if (target.hostname !== 'api.tikhub.io') throw new Error('Unexpected outbound host: ' + target.hostname);
              target.protocol = 'http:';
              target.hostname = 'offline-provider';
              target.searchParams.set('scenario', scenario);
              return env.PROVIDER.fetch(new Request(target, outgoing));
            };
            try {
              const originalUrl = 'https://www.zhihu.com/question/123';
              const data = await fetchZhihuByUrl(context.env, originalUrl);
              if (!data) throw new Error('Expected a supported Zhihu URL');
              const result = await crawl.parseAndSaveZhihu(context, data, originalUrl, scenario, 'runtime-' + scenario);
              return Response.json({ saved: true, result });
            } catch (error) {
              if (!(error instanceof ZhihuCaptureUnavailableError)) throw error;
              return Response.json({ saved: false, terminal: true, publications: publications.get(scenario) ?? 0 }, { status: 422 });
            } finally {
              globalThis.fetch = originalFetch;
            }
          }
        };
      `,
      resolveDir: root,
      loader: 'ts'
    },
    tsconfig: fileURLToPath(new URL('../../tsconfig.json', import.meta.url)),
    bundle: true,
    write: false,
    platform: 'browser',
    conditions: ['workerd', 'worker'],
    format: 'esm',
    target: 'es2022',
    external: ['node:*', 'cloudflare:*'],
    logLevel: 'silent'
  })
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    cf: false,
    workers: [
      {
        config: {
          name: 'zhihu-partial-capture',
          type: 'worker',
          compatibilityDate: '2026-08-01',
          compatibilityFlags: ['nodejs_compat'],
          manifest: {
            mainModule: 'worker.mjs',
            modulesRoot: root,
            modules: { 'worker.mjs': { type: 'esm', contents: bundled.outputFiles[0].text }, ...wasmModules }
          },
          env: {
            OSS: { type: 'r2', name: 'zhihu-capture-local-only' },
            PROVIDER: {
              type: 'fetcher',
              handler: async (request: Request) => {
                const url = new URL(request.url)
                const scenario = url.searchParams.get('scenario')!
                const kind = /answer/i.test(url.pathname) ? 'answers' : 'detail'
                const count = calls.get(scenario) ?? { detail: 0, answers: 0 }
                count[kind] += 1
                calls.set(scenario, count)
                const failed =
                  scenario === 'unavailable' ||
                  (scenario === 'answers-only' && kind === 'detail') ||
                  (scenario === 'description-only' && kind === 'answers') ||
                  (scenario === 'recovery' && kind === 'detail' && count.detail < 3)
                if (failed) return Response.json({ detail: { code: 400, request_id: 'runtime-' + scenario, message: 'Request failed. Please retry.' } }, { status: 400 })
                return Response.json({
                  code: 200,
                  data:
                    kind === 'detail'
                      ? { title: 'Runtime question', detail: '<p>Question description retained</p>' }
                      : {
                          data: [
                            { target: { id: '2103951272701342345', content: '<p>Answer body retained</p>', question: { title: 'Runtime question' }, author: { name: 'Author' } } }
                          ]
                        }
                })
              }
            }
          }
        }
      }
    ]
  })
  try {
    await runtime.ready
    for (const scenario of ['answers-only', 'description-only', 'recovery', 'unavailable']) {
      const captured = await runtime.dispatchFetch('http://local/capture/' + scenario, { method: 'POST' })
      expect(captured.status, await captured.clone().text()).toBe(scenario === 'unavailable' ? 422 : 200)
      const countsBeforeRead = { ...calls.get(scenario) }
      const read = await runtime.dispatchFetch('http://local/read/' + scenario)
      const body = await read.json()
      expect(calls.get(scenario)).toEqual(countsBeforeRead)
      if (scenario === 'unavailable') {
        expect(await captured.json()).toEqual({ saved: false, terminal: true, publications: 0 })
        expect(read.status).toBe(404)
        expect(body).toEqual({ saved: false })
        expect(countsBeforeRead).toEqual({ detail: 4, answers: 4 })
      } else {
        expect(read.status).toBe(200)
        expect(body).toMatchObject({ saved: true, status: 'success', title: 'Runtime question', managed: true, publications: 1 })
        expect(body.html).toContain('slax-private-snapshot')
        if (scenario !== 'description-only') {
          expect(body.html).toContain('Answer body retained')
          expect(body.text).toContain('Answer body retained')
        } else {
          expect(body.html).not.toContain('Answer body retained')
        }
        if (scenario !== 'answers-only') {
          expect(body.html).toContain('Question description retained')
          expect(body.text).toContain('Question description retained')
        } else {
          expect(body.html).not.toContain('Question description retained')
        }
        expect(countsBeforeRead).toEqual(
          scenario === 'answers-only' ? { detail: 4, answers: 1 } : scenario === 'description-only' ? { detail: 1, answers: 4 } : { detail: 3, answers: 1 }
        )
      }
    }
    const bucket = await runtime.getR2Bucket('OSS')
    const objects = await bucket.list()
    expect(objects.objects).toHaveLength(6)
    expect(objects.objects.some((object: { key: string }) => object.key.includes('unavailable'))).toBe(false)
  } finally {
    await runtime.dispose()
  }
}, 120_000)
