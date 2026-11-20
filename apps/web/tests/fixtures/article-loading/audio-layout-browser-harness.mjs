// Real reader cascade, audio processor, status component, marks and preview; no account services.
// Run from the repository root, then open http://127.0.0.1:4324/?manual=1.
import transformerDirectives from '@unocss/transformer-directives'
import { createJiti } from 'jiti'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as sass from 'sass'
import { createGenerator } from 'unocss'

const web = fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(resolve(web, 'package.json'))
const { parse, compileScript, compileStyle } = require('vue/compiler-sfc')
const { build } = createRequire(require.resolve('wrangler'))('esbuild')
const { default: MagicString } = createRequire(require.resolve('@unocss/transformer-directives'))('magic-string')
const uno = await createGenerator(await createJiti(import.meta.url).import(resolve(web, 'uno.config.ts'), { default: true }))
const transformer = transformerDirectives({ applyVariable: ['--at-apply', '--style'] })
const id = 'data-v-audio-layout-check'
const origin = 'http://127.0.0.1:4324'

async function style(source, filename, scoped) {
  const css = sass.compileString(source.replaceAll('~~/', web + '/'), { loadPaths: [dirname(filename), resolve(web, 'node_modules')] }).css
  const code = new MagicString(css)
  await transformer.transform(code, filename + '.css', { uno })
  const result = compileStyle({ source: code.toString(), filename, id, scoped })
  assert.deepEqual(result.errors, [])
  return result.code
}
const articleFile = resolve(web, 'app/components/Article/BookmarkArticle.vue')
const article = parse(readFileSync(articleFile, 'utf8'), { filename: articleFile }).descriptor
const css = [
  (await uno.generate('hidden opacity-0')).css,
  readFileSync(resolve(web, 'styles/theme.tokens.css'), 'utf8'),
  readFileSync(resolve(web, 'styles/theme.css'), 'utf8'),
  await style(readFileSync(resolve(web, 'styles/global.scss'), 'utf8'), resolve(web, 'styles/global.scss'), false),
  ...(await Promise.all(article.styles.map(s => style(s.content, articleFile, !!s.scoped))))
].join('\n')

const client = (await build({
  stdin: { contents: `
    import { createApp, nextTick, ref } from 'vue';
    import Bar from './app/components/Snapshot/PodcastBar.vue';
    import { PodcastProcessor } from './app/components/Article/processors/podcast.processor';
    import { ImageProcessor } from './app/components/Article/processors/image.processor';
    import Preview from './app/components/ImagePreview';
    import { MarkRenderer } from '@slax-reader/selection';
    import { DwebEnvironmentAdapter } from './app/components/Article/Selection/adapters/DwebEnvironmentAdapter';
    globalThis.useNuxtApp = () => ({ $i18n: { t: key => key.split('.').at(-1), te: () => false } });
    globalThis.tryUseNuxtApp = () => null;
    globalThis.useI18n = () => ({ t: key => key.split('.').at(-1) });
    window.fixturePhase = ref('done'); window.fixtureState = ref(null); window.fixtureTranslation = ref(null);
    const query = new URL(location.href).searchParams;
    const body = document.querySelector('.article-detail');
    const paragraph = document.getElementById('highlight-target');
    const firstText = paragraph.firstChild;
    const firstImage = body.querySelector('img');
    const context = { container: body, url: new URL('https://example.com/podcast'), articleStyle: 'default', callbacks: { screenLockUpdate() {}, showImagePreview: options => Preview.showImagePreview(options), websiteClick() {} }, cleanups: [] };
    const positionKey = 'slax:podcast-pos:' + body.querySelector('audio').src;
    if (!localStorage.getItem(positionKey)) localStorage.setItem(positionKey, '30');
    const result = { highlightClicked: false, theme: document.documentElement.dataset.slaxTheme, viewport: innerWidth, positionKey };
    const renderer = new MarkRenderer({ containerDom: document.getElementById('reader'), monitorDom: body }, new DwebEnvironmentAdapter(), { getUserId: () => 1 });
    renderer.setMarkClickHandler(() => { result.highlightClicked = true; });
    const snapshot = () => ({ bodyTop: body.getBoundingClientRect().top, paragraphTop: paragraph.getBoundingClientRect().top, native: body.querySelector('audio')?.getBoundingClientRect().toJSON(), player: document.querySelector('podcast-player-view')?.getBoundingClientRect().toJSON() });
    window.fixtureResult = result;
    window.fixtureSnapshot = snapshot;
    const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const bar = createApp(Bar, { bookmarkUid: 'fixture-podcast', bodyHasArticle: true });
    bar.config.globalProperties.$t = key => key.split('.').at(-1);
    let enhanced = false;
    const enhance = async () => {
      if (enhanced) return; enhanced = true;
      const before = snapshot();
      new ImageProcessor().process(context); new PodcastProcessor().process(context);
      await nextTick(); await frames(); const after = snapshot();
      bar.mount(document.getElementById('status')); await nextTick(); await frames();
      const withEmptyStatus = snapshot();
      Object.assign(result, { before, after, withEmptyStatus,
        bodyDelta: after.bodyTop - before.bodyTop, paragraphDelta: after.paragraphTop - before.paragraphTop,
        statusDelta: withEmptyStatus.bodyTop - after.bodyTop,
        textRetained: paragraph.firstChild === firstText, imageRetained: body.contains(firstImage),
        playerOutsideMarks: !body.contains(document.querySelector('podcast-player-view')),
        liveRegion: !!document.querySelector('.pod-status-region[aria-live="polite"]'),
        pass: Math.abs(after.bodyTop-before.bodyTop)<1 && Math.abs(after.paragraphTop-before.paragraphTop)<1 && Math.abs(withEmptyStatus.bodyTop-after.bodyTop)<1 });
    };
    document.getElementById('enhance').onclick = enhance;
    document.getElementById('status-toggle').onclick = () => { window.fixturePhase.value = window.fixturePhase.value === 'done' ? 'writing' : 'done'; };
    document.getElementById('draw').onclick = () => renderer.drawMark({ id: 'fixture-mark', source: [{ type: 'text', path: '#highlight-target', start: 0, end: 14 }], stroke: [{ userId: 1 }], comments: [] });
    document.getElementById('clear').onclick = () => renderer.clearAllMarks();
    if (!query.has('manual')) setTimeout(enhance, 700);
    setInterval(() => {
      const player = document.querySelector('podcast-player-view'); const audio = player?.shadowRoot?.querySelector('audio');
      document.getElementById('results').textContent = JSON.stringify({ ...result, audio: audio ? { currentTime: audio.currentTime, paused: audio.paused, preload: audio.preload, duration: audio.duration, stored: localStorage.getItem(positionKey) } : null, previewOpen: !!document.querySelector('.image-preview'), highlights: body.querySelectorAll('slax-mark').length }, null, 2);
    }, 200);
  `, resolveDir: web, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent', alias: { '~': resolve(web, 'app') },
  plugins: [{ name: 'actual-audio-components', setup(plugin) {
    plugin.onResolve({ filter: /\/CEComponents$|^\.\.\/CEComponents$/ }, () => ({ path: 'audio', namespace: 'fixture-ce' }))
    plugin.onLoad({ filter: /.*/, namespace: 'fixture-ce' }, () => ({ contents: `import { defineCustomElement } from 'vue'; import Player from '${resolve(web, 'app/components/Article/CEComponents/podcast/PodcastPlayer.ce.vue')}'; export const PodcastPlayerElement = defineCustomElement(Player); customElements.define('podcast-player-view', PodcastPlayerElement);`, resolveDir: web, loader: 'ts' }))
    plugin.onResolve({ filter: /composables\/bookmark\/usePodcast$/ }, () => ({ path: 'status-service', namespace: 'fixture-status' }))
    plugin.onLoad({ filter: /.*/, namespace: 'fixture-status' }, () => ({ contents: `import { ref } from 'vue'; export const usePodcast = () => ({ state: window.fixtureState, translation: window.fixtureTranslation, phase: window.fixturePhase, acting: ref(false), stalled: ref(false), start: async () => {}, stop() {}, retry: async () => {} });`, resolveDir: web, loader: 'ts' }))
    plugin.onLoad({ filter: /\.vue$/ }, async args => {
      const { descriptor } = parse(readFileSync(args.path, 'utf8'), { filename: args.path })
      const script = compileScript(descriptor, { id, inlineTemplate: true })
      const auto = ['computed', 'onMounted', 'onBeforeUnmount', 'onUnmounted', 'watch', 'nextTick'].filter(name => !script.bindings[name] && new RegExp('\\b'+name+'\\s*\\(').test(script.content))
      const styles = await Promise.all(descriptor.styles.map(s => style(s.content, args.path, !!s.scoped)))
      const attach = args.path.endsWith('.ce.vue') ? '' : `document.head.appendChild(Object.assign(document.createElement('style'), {textContent:${JSON.stringify(styles.join('\n'))}}));`
      return { contents: `${auto.length ? 'import { '+auto.join(',')+' } from "vue";' : ''}\n${script.content.replace('export default', 'const Component =')}\nComponent.__scopeId='${id}'; Component.styles=${JSON.stringify(styles)}; ${attach} export default Component;`, resolveDir: web, loader: 'ts' }
    })
  } }]
})).outputFiles[0].text

const wav = Buffer.alloc(44 + 90 * 8000 * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28)
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
const server = createServer((request, response) => {
  const url = new URL(request.url, origin)
  if (url.pathname === '/client.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(client); return }
  if (url.pathname === '/cover.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#a3c4aa"/></svg>'); return }
  if (url.pathname === '/episode.wav') {
    if (url.searchParams.has('fail')) { response.statusCode = 503; response.end('Fixture media failure'); return }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '')
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1
    response.setHeader('Content-Type', 'audio/wav'); response.setHeader('Accept-Ranges', 'bytes'); response.setHeader('Cache-Control', 'no-store')
    if (range) { response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${wav.length}`) }
    response.setHeader('Content-Length', end - start + 1); response.end(wav.subarray(start, end + 1)); return
  }
  if (/^\/fonts\/(playfair-display-latin(-ext)?\.woff2|source-serif-pro-(400|700)-normal\.woff)$/.test(url.pathname)) {
    response.setHeader('Content-Type', 'font/woff'); response.end(readFileSync(resolve(web, 'public', url.pathname.slice(1)))); return
  }
  const theme = ['light', 'dark', 'eink'].includes(url.searchParams.get('theme')) ? url.searchParams.get('theme') : 'light'
  const media = `<slax-media data-kind="audio" data-src="${origin}/episode.wav${url.searchParams.has('error') ? '?fail=1' : ''}" data-title="${url.searchParams.has('untitled') ? '' : 'Saved podcast controls'}" data-show="${url.searchParams.has('untitled') ? '' : 'Layout regression'}" data-cover="${url.searchParams.has('untitled') ? '' : origin + '/cover.svg'}" data-duration-ms="90000" data-cues="[]"><audio controls preload="none" src="${origin}/episode.wav"></audio></slax-media>`
  const body = `<div class="slax-pod">${media}<article class="slax-pod-article" data-slax-derived="podcast-article"><aside class="slax-yt-introduction"><p id="highlight-target">Readable saved podcast text, kept in its original nodes while the audio player is enhanced. The entire article remains available before playback and supports existing annotations.</p></aside><h2 class="slax-pod-heading" data-start-ms="45000">Chapter at 0:45</h2><p class="slax-pod-p" data-start-ms="45000"><span data-media-seek="45000" role="button" tabindex="0">0:45</span> The original chapter supports click and keyboard seeking.</p><img src="/cover.svg" width="800" height="400" alt="Preview regression image"><p>${'Complete readable article. '.repeat(160)}</p></article></div>`
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html data-slax-theme="${theme}" class="${theme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Audio layout and interaction regression</title><style>${css}body{margin:0;background:var(--slax-background);color:var(--slax-text)}#results{white-space:pre-wrap;font:12px monospace}.bookmark-article{--slax-content-w:800px}#toolbar{position:relative;padding:16px}#toolbar button{margin:4px;padding:8px}img{max-width:100%}</style><section id="toolbar"><button id="enhance">Enhance player</button><button id="status-toggle">Toggle working / empty status</button><button id="draw">Draw highlight</button><button id="clear">Clear highlights</button><p>Use 0:45 to seek, click the image to preview, pause then reload to verify resume. The media is a local 90-second silent WAV.</p></section><main id="reader" class="bookmark-article snapshot default" ${id}><header class="article-header" ${id}><h1 class="article-title" ${id}>Saved audio article</h1></header><div id="status"></div><div class="article-detail article-body default" ${id}><div class="html-text" ${id}>${body}</div></div></main><pre id="results">Waiting for enhancement…</pre><script type="module" src="/client.js"></script></html>`)
})
server.listen(4324, '127.0.0.1', () => console.log('Audio layout fixture: ' + origin + '/?manual=1'))
process.on('SIGINT', () => server.close()); process.on('SIGTERM', () => server.close())
