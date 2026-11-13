import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare } = runtimeRequire('miniflare')
const { build } = runtimeRequire('esbuild')
const root = fileURLToPath(new URL('../../../', import.meta.url))

test('workerd fills and reuses the signed edge cache after real R2 image hits', async () => {
  const bundled = await build({
    stdin: {
      contents: `
        import { handleImageProxy } from './src/handler/http/imageProxy';
        import { hashMD5, hashSHA256 } from './src/utils/strings';
        export default { async fetch(_request, env) {
          const results = [];
          for (const mode of ['', 'rss']) {
            const u = encodeURIComponent('https://images.example/cover.png');
            const query = new URLSearchParams({ u, r: '', d: await hashMD5(u + 'fixture-salt' + mode), ...(mode ? { m: mode } : {}) });
            const url = 'https://image-cache-fixture.invalid/static/image?' + query;
            const key = (mode ? 'rss-image/' : 'image/') + await hashSHA256(u);
            await env.OSS.put(key, 'native-r2-image', { httpMetadata: { contentType: 'image/png' } });
            const pending = [];
            let r2Gets = 0;
            const ctx = { env: { IMAGER_CHECK_DIGST_SALT: 'fixture-salt', OSS: { get: key => { r2Gets++; return env.OSS.get(key); } } }, execution: { waitUntil: operation => pending.push(operation) } };
            const first = await handleImageProxy(ctx, new Request(url));
            const firstBody = await first.text();
            await Promise.all(pending);
            const cached = await caches.default.match(url);
            if (!cached) throw new Error('R2 hit did not populate the native Cache API');
            const cachedBody = await cached.text();
            const second = await handleImageProxy(ctx, new Request(url));
            const secondBody = await second.text();
            results.push({ mode, firstStatus: first.status, secondStatus: second.status, firstBody, cachedBody, secondBody, r2Gets, cacheControl: second.headers.get('Cache-Control'), mime: second.headers.get('Content-Type') });
          }
          return Response.json(results);
        }};
      `,
      resolveDir: root,
      loader: 'ts'
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    alias: { '@': fileURLToPath(new URL('../../../src', import.meta.url)) },
    logLevel: 'silent'
  })
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    cf: false,
    inspectorPort: 0,
    workers: [{ config: {
      name: 'image-cache-fixture',
      type: 'worker',
      compatibilityDate: '2026-08-01',
      manifest: { mainModule: 'worker.mjs', modulesRoot: root, modules: { 'worker.mjs': { type: 'esm', contents: bundled.outputFiles[0].text } } },
      env: { OSS: { type: 'r2', name: 'image-cache-fixture-only' } }
    } }]
  })
  try {
    const response = await runtime.dispatchFetch('https://image-cache-fixture.invalid/check')
    const body = await response.text()
    expect(response.status, body).toBe(200)
    const results = JSON.parse(body)
    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result).toMatchObject({ firstStatus: 200, secondStatus: 200, firstBody: 'native-r2-image', cachedBody: 'native-r2-image', secondBody: 'native-r2-image', r2Gets: 1, mime: 'image/png' })
      expect(result.cacheControl).toContain('public')
    }
  } finally {
    await runtime.dispose()
  }
})
