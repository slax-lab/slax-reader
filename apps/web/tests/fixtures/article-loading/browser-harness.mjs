// Synthetic article correctness harness. Run from repository root:
//   node apps/web/tests/fixtures/article-loading/browser-harness.mjs
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const web = resolve(here, '../../..')
const webRequire = createRequire(resolve(web, 'package.json'))
const wranglerRequire = createRequire(webRequire.resolve('wrangler'))
const { build } = wranglerRequire('esbuild')
const { Miniflare } = wranglerRequire('miniflare')
const fixtures = readdirSync(here).filter(name => name.endsWith('.html')).sort()

const bundle = async (contents, platform, extra = {}) => (await build({
  stdin: { contents, resolveDir: web, sourcefile: 'lcp-harness.ts', loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform, logLevel: 'silent', alias: { '~': resolve(web, 'app') }, ...extra,
})).outputFiles[0].text

const transformCode = await bundle(`
  import { applyArticleImageLoading } from './app/utils/articleImageLoading.ts';
  export const transform = html => applyArticleImageLoading(html, { enabled: true, excludedPresentation: false });
`, 'node')
const transformModule = await import(`data:text/javascript;base64,${Buffer.from(transformCode).toString('base64')}`)

// Production SSR runner plus Workers HTMLRewriter in Miniflare.
const ssrWorker = await bundle(`
  import { runArticleSsrProcessors } from './app/components/Article/processors/ssr-runner.ts';
  export default { async fetch(request) {
    return new Response(await runArticleSsrProcessors(await request.text()), { headers: { 'content-type': 'text/plain' } });
  }};
`, 'neutral', { define: { 'import.meta.server': 'true' } })
const miniflare = new Miniflare({ workers: [{ config: { name: 'article-ssr', type: 'worker', compatibilityDate: '2026-01-01', manifest: { mainModule: 'worker.js', modulesRoot: here, modules: { 'worker.js': { type: 'esm', contents: ssrWorker } } } } }] })
await miniflare.ready
const runSsr = async html => (await miniflare.dispatchFetch('http://article-ssr/', { method: 'POST', body: html })).text()

const client = await bundle(`
  import { createSSRApp, h } from 'vue';
  import restorePlugin from './app/plugins/restore-html.client.ts';
  import { applyArticleImageLoading } from './app/utils/articleImageLoading.ts';
  const input = JSON.parse(document.getElementById('input').textContent);
  const root = document.querySelector('.html-text');
  const warnings = [];
  const initialNodes = [...root.querySelectorAll('img')];
  const initialSources = initialNodes.map(img => img.getAttribute('src'));
  const initialCandidate = [...root.querySelectorAll('img[fetchpriority="high"]')].map(img => img.getAttribute('src'));
  const payload = { data: { ['content-' + input.fixture]: { body: '__SLAX_SSR_STRIPPED__' } } };
  restorePlugin.setup({ payload });
  const restoredBody = payload.data['content-' + input.fixture].body;
  const app = createSSRApp({ setup: () => () => h('div', { class: 'html-text', innerHTML: restoredBody }) });
  app.config.warnHandler = (message, instance, trace) => warnings.push({ message, trace });
  const beforeHydration = [...root.querySelectorAll('img')];
  try { app.mount(document.querySelector('.article-detail'), true); } catch (error) { warnings.push({ message: String(error), hydrationError: true }); }
  const hydratedRoot = document.querySelector('.html-text');
  const repairedCandidate = [...hydratedRoot.querySelectorAll('img[fetchpriority="high"]')].map(img => img.getAttribute('src'));
  const refresh = document.createElement('template'); refresh.innerHTML = applyArticleImageLoading(input.body, { enabled: true, excludedPresentation: false });
  const refreshedCandidate = [...refresh.content.querySelectorAll('img[fetchpriority="high"]')].map(img => img.getAttribute('src'));
  const result = {
    fixture: input.fixture, initialCandidate, repairedCandidate, refreshedCandidate,
    restoredBodyMatches: restoredBody === hydratedRoot.innerHTML,
    sameCandidateAfterHydration: JSON.stringify(initialCandidate) === JSON.stringify(repairedCandidate),
    sameCandidateAfterRefresh: JSON.stringify(initialCandidate) === JSON.stringify(refreshedCandidate),
    sourceIdentityPreserved: JSON.stringify(initialSources) === JSON.stringify([...hydratedRoot.querySelectorAll('img')].map(img => img.getAttribute('src'))),
    nodeIdentityPreserved: beforeHydration.every((node, index) => node === hydratedRoot.querySelectorAll('img')[index]),
    hydrationWarnings: warnings,
    resourceEntries: performance.getEntriesByType('resource').filter(item => item.initiatorType === 'img').map(item => ({ name: item.name, startTime: item.startTime })),
    userAgent: navigator.userAgent,
  };
  result.pass = result.sameCandidateAfterHydration && result.sameCandidateAfterRefresh && result.sourceIdentityPreserved && result.nodeIdentityPreserved && warnings.length === 0;
  document.getElementById('results').textContent = JSON.stringify(result, null, 2);
  document.title = (result.pass ? 'PASS ' : 'FAIL ') + input.fixture;
`, 'browser', { banner: { js: 'const defineNuxtPlugin = value => value;' } })

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:4318')
    if (url.pathname === '/client.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(client); return }
    if (url.pathname.startsWith('/images/')) { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#a3c4aa"/></svg>'); return }
    const fixture = url.searchParams.get('fixture') || fixtures[0]
    if (!fixtures.includes(fixture)) { response.writeHead(404).end(); return }
    const raw = readFileSync(resolve(here, fixture), 'utf8').replaceAll('https://fixtures.invalid/', '/images/')
    const body = raw.replace(/^<div class="html-text">/, '').replace(/<\/div>\s*$/, '')
    const ssr = await runSsr(body)
    const transformed = transformModule.transform(ssr)
    const input = JSON.stringify({ fixture, raw, body }).replaceAll('<', '\\u003c')
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><meta charset="utf-8"><title>LCP fixture</title><style>body{font:14px system-ui;margin:24px}img{max-width:100%;height:auto}#results{white-space:pre-wrap}nav a{margin-right:12px}</style><nav>${fixtures.map(name => `<a href="/?fixture=${name}">${name}</a>`).join('')}</nav><div class="article-detail"><div class="html-text">${transformed}</div></div><pre id="results">Running checks…</pre><script id="input" type="application/json">${input}</script><script type="module" src="/client.js"></script>`)
  } catch (error) { response.writeHead(500).end(String(error?.stack || error)) }
})
server.listen(4318, '127.0.0.1', () => console.log('Synthetic LCP harness: http://127.0.0.1:4318'))
const close = async () => { server.close(); await miniflare.dispose(); process.exit() }
process.on('SIGINT', close); process.on('SIGTERM', close)
