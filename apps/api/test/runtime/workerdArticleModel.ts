import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DeepSeekError, type ArticleModel } from '../../src/infra/external/deepseekClient'

/** Run the production provider client inside Workerd, with its real outbound fetch. */
export async function workerdArticleModel(key: string): Promise<{ model: ArticleModel; dispose: () => Promise<void> }> {
  const require = createRequire(import.meta.url)
  const runtimeRequire = createRequire(require.resolve('wrangler/package.json'))
  const { Miniflare } = runtimeRequire('miniflare')
  const { build } = runtimeRequire('esbuild')
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const bundle = await build({
    stdin: {
      contents: `
        import { DeepSeekClient } from './src/infra/external/deepseekClient';
        export default { async fetch(request, env) {
          const { contents, config, options } = await request.json();
          try {
            return Response.json(await new DeepSeekClient(env).chat(contents, {
              ...config, abortSignal: AbortSignal.timeout(90_000)
            }, options));
          } catch (error) {
            return Response.json({ code: error.code ?? 'transport', providerStatus: error.providerStatus }, { status: 502 });
          }
        }}
      `,
      resolveDir: root,
      sourcefile: 'deepseek-live-worker.ts'
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false
  })
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    cf: false,
    workers: [
      {
        config: {
          name: 'deepseek-live',
          type: 'worker',
          compatibilityDate: '2026-08-01',
          manifest: { mainModule: 'worker.mjs', modulesRoot: root, modules: { 'worker.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } },
          env: { DEEPSEEK_API_KEY: { type: 'json', value: key } }
        }
      }
    ]
  })
  return {
    model: {
      async chat(contents, config, options) {
        const response = await runtime.dispatchFetch('http://local/', {
          method: 'POST',
          body: JSON.stringify({ contents, config: { ...config, abortSignal: undefined }, options }),
          signal: config.abortSignal
        })
        const result = await response.json()
        if (!response.ok) throw new DeepSeekError(result.code, result.providerStatus)
        return result
      }
    },
    dispose: () => runtime.dispose()
  }
}
