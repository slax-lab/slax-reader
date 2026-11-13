// Source-compiled body hydration plus real highlight, preview and podcast components.
// Run from the repository root and open http://127.0.0.1:4321 in a browser.
// This is a local mechanism/interaction fixture, not an authenticated Nuxt integration.
// Optional argument: a directory of podcast/mole/wechat.json objects with string body fields.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('../../../', import.meta.url))
const root = resolve(web, '../..')
const require = createRequire(resolve(web, 'package.json'))
const { parse, compileScript, compileStyleAsync } = require('vue/compiler-sfc')
const ts = require('typescript')
const { build } = createRequire(require.resolve('wrangler'))('esbuild')
const { createSSRApp, h } = require('vue')
const { renderToString } = require('vue/server-renderer')
const origin = 'http://127.0.0.1:4321'
const articleFile = 'apps/web/app/components/Article/BookmarkArticle.vue'
const sampleDirectory = process.argv[2]

const variants = Object.fromEntries(['current', 'baseline'].map(mode => {
  const source = mode === 'current' ? readFileSync(resolve(root, articleFile), 'utf8') : execFileSync('git', ['show', `origin/dev:${articleFile}`], { cwd: root, encoding: 'utf8' })
  const { descriptor } = parse(source)
  const element = descriptor.template.content.match(/<div class="html-text"[^>]*><\/div>/)?.[0]
  assert(element, 'The actual article body binding must exist')
  const ast = ts.createSourceFile('article.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const directive = ast.statements.find(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'vArticleHtml'))?.getText(ast) || ''
  return [mode, `<template>${element}</template><script setup lang="ts">
    import { computed } from 'vue';
    import { applyArticleImageLoading } from '~/utils/articleImageLoading';
    import type { ObjectDirective } from 'vue';
    const props = defineProps<{ body: string; touch: number }>();
    const articleHTML = computed(() => applyArticleImageLoading(props.body, { enabled: true, excludedPresentation: false }));
    ${directive}
  </script>`]
}))

const components = ssr => ({
  name: 'fixture-vue',
  setup(plugin) {
    plugin.onResolve({ filter: /^fixture-body:/ }, args => ({ path: args.path, namespace: 'fixture-body' }))
    plugin.onLoad({ filter: /.*/, namespace: 'fixture-body' }, args => compile(variants[args.path.split(':')[1]], args.path, ssr))
    plugin.onResolve({ filter: /\/CEComponents$|^\.\.\/CEComponents$/ }, () => ({ path: 'podcast-only', namespace: 'fixture-ce' }))
    plugin.onLoad({ filter: /.*/, namespace: 'fixture-ce' }, () => ({ contents: `import { defineCustomElement } from 'vue'; import Player from '${resolve(web, 'app/components/Article/CEComponents/podcast/PodcastPlayer.ce.vue')}'; export const PodcastPlayerElement = defineCustomElement(Player); export const registerComponents = () => { if (!customElements.get('podcast-player-view')) customElements.define('podcast-player-view', PodcastPlayerElement); };`, resolveDir: web, loader: 'ts' }))
    plugin.onLoad({ filter: /\.vue$/ }, args => compile(readFileSync(args.path, 'utf8'), args.path, ssr))
  }
})

async function compile(source, filename, ssr) {
  const { descriptor } = parse(source, { filename })
  const id = 'data-v-hydration-check'
  const script = compileScript(descriptor, { id, inlineTemplate: true, templateOptions: { ssr } })
  const auto = ['computed', 'onMounted', 'onBeforeUnmount', 'onUnmounted', 'watch', 'nextTick'].filter(name => !script.bindings[name] && new RegExp(`\\b${name}\\s*\\(`).test(script.content))
  const styles = await Promise.all(descriptor.styles.map(style => compileStyleAsync({ source: style.content, filename, id, scoped: !!style.scoped, preprocessLang: style.lang })))
  const css = styles.map(style => style.code).join('\n')
  const code = script.content.replace('export default', 'const Component =')
  return { contents: `${auto.length ? `import { ${auto.join(',')} } from 'vue';` : ''}\n${code}\nComponent.__scopeId = '${id}'; Component.styles = [${JSON.stringify(css)}]; ${!ssr && !filename.endsWith('.ce.vue') && css ? `document.head.appendChild(Object.assign(document.createElement('style'), {textContent:${JSON.stringify(css)}}));` : ''} export default Component;`, resolveDir: web, loader: 'ts' }
}

async function bundle(contents, platform, ssr = false) {
  return (await build({ stdin: { contents, resolveDir: web, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform, logLevel: 'silent', alias: { '~': resolve(web, 'app') }, plugins: [components(ssr)], ...(platform === 'node' ? { external: ['vue', 'vue/server-renderer'], absWorkingDir: web } : { banner: { js: 'const defineNuxtPlugin = value => value;' } }) })).outputFiles[0].text
}

// Import in the Web workspace so the SSR and DOM runtime resolve the same Vue build.
const serverComponents = {}
for (const mode of ['current', 'baseline']) {
  const code = await bundle(`export { default } from 'fixture-body:${mode}';`, 'node', true)
  const { pathToFileURL } = await import('node:url')
  const rewritten = code.replaceAll('from "vue"', `from ${JSON.stringify(pathToFileURL(require.resolve('vue/dist/vue.runtime.esm-bundler.js')).href)}`).replaceAll('from "vue/server-renderer"', `from ${JSON.stringify(pathToFileURL(require.resolve('vue/server-renderer')).href)}`)
  serverComponents[mode] = (await import(`data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`)).default
}

const client = await bundle(`
  import { createSSRApp, h, reactive, nextTick } from 'vue';
  import Current from 'fixture-body:current'; import Baseline from 'fixture-body:baseline';
  import restorePlugin from './app/plugins/restore-html.client';
  import { ImageProcessor } from './app/components/Article/processors/image.processor';
  import { PodcastProcessor } from './app/components/Article/processors/podcast.processor';
  import { registerComponents } from './app/components/Article/CEComponents';
  import Preview from './app/components/ImagePreview';
  import { MarkRenderer } from '@slax-reader/selection';
  import { DwebEnvironmentAdapter } from './app/components/Article/Selection/adapters/DwebEnvironmentAdapter';
  globalThis.useNuxtApp = () => ({ $i18n: { t: key => key.split('.').at(-1) } });
  globalThis.tryUseNuxtApp = () => null;
  const input = JSON.parse(document.getElementById('input').textContent);
  if (input.seed && localStorage.getItem(input.positionKey) === null) localStorage.setItem(input.positionKey, input.seed);
  const root = document.querySelector('.html-text'); const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let firstText;
  while (walker.nextNode()) { if (walker.currentNode.textContent.trim()) { firstText = walker.currentNode; break; } }
  const firstImage = root.querySelector('img');
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML'); let writes = 0, reads = 0, serializationMs = 0;
  Object.defineProperty(root, 'innerHTML', { get() { const start = performance.now(); const value = descriptor.get.call(this); serializationMs += performance.now() - start; reads++; return value; }, set(value) { writes++; descriptor.set.call(this, value); }, configurable: true });
  const payload = { data: { 'content-fixture': { body: '__SLAX_SSR_STRIPPED__' } } };
  restorePlugin.setup({ payload });
  reads = 0; serializationMs = 0;
  const state = reactive({ body: payload.data['content-fixture'].body, touch: 0 });
  const app = createSSRApp({ render: () => h(input.mode === 'baseline' ? Baseline : Current, state) });
  const errors = []; app.config.warnHandler = message => errors.push(message);
  const mountStartedAt = performance.now(); app.mount(document.querySelector('.article-detail')); const synchronousHydrationMs = performance.now() - mountStartedAt; await nextTick();
  const result = { mode: input.mode, sample: input.sample || 'synthetic', ssrBodyPresent: !!firstText, bodyBytes: input.bodyBytes, hydrationWrites: writes, comparisonReads: reads, serializationMs, synchronousHydrationMs, textNodeRetained: root.contains(firstText), imageNodeRetained: firstImage ? root.contains(firstImage) : null, highlightClicked: false, unrelatedUpdatePreserved: null, warnings: errors };
  if (input.sample) {
    document.getElementById('draw').hidden = true; document.getElementById('clear').hidden = true; document.getElementById('unrelated').hidden = true;
    document.getElementById('results').textContent = JSON.stringify(result, null, 2);
  } else {
  registerComponents();
  const context = { container: document.querySelector('.article-detail'), url: new URL('https://example.com/article'), articleStyle: 'default', callbacks: { screenLockUpdate: value => { result.screenLocked = value; }, showImagePreview: options => Preview.showImagePreview(options), websiteClick() {} }, cleanups: [] };
  new ImageProcessor().process(context); new PodcastProcessor().process(context);
  const renderer = new MarkRenderer({ containerDom: document.getElementById('reader'), monitorDom: context.container }, new DwebEnvironmentAdapter(), { getUserId: () => 1 });
  renderer.setMarkClickHandler(() => { result.highlightClicked = true; });
  const draw = async () => { await renderer.drawMark({ id: 'fixture-mark', source: [{ type: 'text', path: '#highlight-target', start: 0, end: 14 }], stroke: [{ userId: 1 }], comments: [] }); };
  document.getElementById('draw').onclick = draw;
  document.getElementById('clear').onclick = () => renderer.clearAllMarks();
  document.getElementById('unrelated').onclick = async () => { const mark = root.querySelector('slax-mark'); const image = root.querySelector('img'); const player = document.querySelector('podcast-player-view'); state.touch++; await nextTick(); result.unrelatedUpdatePreserved = mark === root.querySelector('slax-mark') && image === root.querySelector('img') && player === document.querySelector('podcast-player-view'); };
  const firstPlaying = []; window.addEventListener('slax:youtube-time', event => { if (event.detail.playing && firstPlaying.length < 4) firstPlaying.push(event.detail.t); });
  setInterval(async () => { const audio = document.querySelector('podcast-player-view')?.shadowRoot?.querySelector('audio'); const stats = await (await fetch('/stats?case=' + encodeURIComponent(input.case))).json(); document.getElementById('results').textContent = JSON.stringify({ ...result, bodyWrites: writes, highlights: root.querySelectorAll('slax-mark').length, imageReady: root.querySelector('img')?.naturalWidth > 0, previewOpen: !!document.querySelector('.image-preview'), preload: audio?.preload, currentTime: audio?.currentTime, paused: audio?.paused, rate: audio?.playbackRate, audioRequests: stats.requests, firstPlayingTimes: firstPlaying, storedPosition: localStorage.getItem(input.positionKey) }, null, 2); }, 500);
  }
`, 'browser')

const wav = Buffer.alloc(44 + 90 * 8000 * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28)
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
const requests = new Map()
const tokens = readFileSync(resolve(web, 'styles/theme.tokens.css'), 'utf8')
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin)
    const caseId = url.searchParams.get('case') || 'hydration'
    if (url.pathname === '/client.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(client); return }
    if (url.pathname === '/stats') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ requests: requests.get(caseId) || 0 })); return }
    if (url.pathname === '/cover.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#a3c4aa"/></svg>'); return }
    if (url.pathname === '/episode.wav') {
      requests.set(caseId, (requests.get(caseId) || 0) + 1)
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '')
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1
      response.setHeader('Content-Type', 'audio/wav'); response.setHeader('Accept-Ranges', 'bytes'); response.setHeader('Cache-Control', 'no-store')
      if (range) { response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${wav.length}`) }
      response.setHeader('Content-Length', end - start + 1); response.end(wav.subarray(start, end + 1)); return
    }
    const mode = url.searchParams.get('mode') === 'baseline' ? 'baseline' : 'current'
    const src = `${origin}/episode.wav?case=${encodeURIComponent(caseId)}`
    const sample = url.searchParams.get('sample')
    if (sample && (!sampleDirectory || !['podcast', 'mole', 'wechat'].includes(sample))) { response.writeHead(404).end(); return }
    const body = sample ? JSON.parse(readFileSync(resolve(sampleDirectory, sample + '.json'), 'utf8')).body : `<slax-media data-kind="audio" data-src="${src}" data-duration-ms="90000" data-title="Hydration podcast"><audio controls preload="none" src="${src}"></audio></slax-media><h2 id="chapter">Article chapter</h2><p id="highlight-target">Readable article text stays available before hydration and supports highlights.</p><img src="${origin}/cover.svg" width="800" height="400"><p><button data-media-seek="45000">Play paragraph at 0:45</button></p>`
    const html = await renderToString(createSSRApp({ render: () => h(serverComponents[mode], { body, touch: 0 }) }))
    assert(html.includes(body.slice(0, 40)), 'SSR must contain the article body')
    const input = JSON.stringify({ mode, sample, bodyBytes: Buffer.byteLength(body), case: caseId, seed: url.searchParams.get('saved'), positionKey: 'slax:podcast-pos:' + src }).replaceAll('<', '\\u003c')
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Article hydration regression</title><style>${tokens}body{margin:16px;background:var(--slax-background);color:var(--slax-text);font:16px system-ui}#reader{max-width:820px;margin:auto}img{max-width:100%;height:auto}pre{white-space:pre-wrap;font-size:12px}slax-mark{background:#f4df7a;cursor:pointer}button{margin:6px}</style><h1>Article hydration regression (${mode})</h1><button id="draw">Draw highlight</button><button id="clear">Clear highlights</button><button id="unrelated">Update attribution</button><div id="reader"><div class="article-detail">${html}</div></div><pre id="results">Hydrating…</pre><script id="input" type="application/json">${input}</script><script type="module" src="/client.js"></script>`)
  } catch (error) { response.writeHead(500).end(String(error.stack || error)) }
})
server.listen(4321, '127.0.0.1', () => console.log(`Hydration/reading/media fixture: ${origin}`))
process.on('SIGINT', () => server.close()); process.on('SIGTERM', () => server.close())
