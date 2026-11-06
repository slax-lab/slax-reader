import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare } = runtimeRequire('miniflare')
const { build } = runtimeRequire('esbuild')
const ROOT = fileURLToPath(new URL('../../', import.meta.url))

test('Workerd sends DeepSeek requests and refuses redirects without forwarding credentials', async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { DeepSeekClient } from './src/infra/external/deepseekClient';
        export default { async fetch() {
          try {
            const reply = await new DeepSeekClient({ DEEPSEEK_API_KEY: 'runtime-test-key' }).chat(
              [{ role: 'user', parts: [{ text: 'Translate this public example.' }] }],
              { maxOutputTokens: 100, responseSchema: { type: 'object' } },
              { systemInstruction: 'Return JSON.' }
            );
            return Response.json(reply);
          } catch (error) {
            return Response.json({ message: error.message, code: error.code, providerStatus: error.providerStatus }, { status: 502 });
          }
        }}
      `,
      resolveDir: ROOT,
      sourcefile: 'deepseek-runtime-worker.ts'
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false
  })
  let status = 200
  const requests: Array<{ url: string; authorization: string | null }> = []
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    cf: false,
    workers: [
      {
        config: {
          name: 'deepseek-runtime',
          type: 'worker',
          compatibilityDate: '2026-08-01',
          manifest: { mainModule: 'worker.mjs', modulesRoot: ROOT, modules: { 'worker.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } }
        },
        dev: {
          outboundService: {
            type: 'fetcher',
            handler: async (request: Request) => {
              requests.push({ url: request.url, authorization: request.headers.get('Authorization') })
              if (status !== 200) return new Response('Do not expose provider response content', { status, headers: { Location: 'https://redirect.invalid/leak' } })
              return Response.json({
                choices: [{ message: { content: '{"text":"公开示例"}' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 5 }
              })
            }
          }
        }
      }
    ]
  })
  try {
    const response = await runtime.dispatchFetch('http://local/')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ text: '{"text":"公开示例"}', finishReason: 'STOP' })
    expect(requests).toEqual([{ url: 'https://api.deepseek.com/chat/completions', authorization: 'Bearer runtime-test-key' }])
    for (status of [301, 302, 303, 307, 308, 401, 429, 500]) {
      requests.length = 0
      const failed = await runtime.dispatchFetch('http://local/')
      expect(failed.status).toBe(502)
      expect(await failed.json()).toEqual({ message: `deepseek_http:${status}`, code: 'http', providerStatus: status })
      expect(requests).toEqual([{ url: 'https://api.deepseek.com/chat/completions', authorization: 'Bearer runtime-test-key' }])
    }
  } finally {
    await runtime.dispose()
  }
}, 30_000)
