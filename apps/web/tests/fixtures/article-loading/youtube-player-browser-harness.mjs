// Compile the actual reader cascade and YouTube enhancement; inspect :4323 in a browser.
// The default matrix stubs only the remote YouTube API. ?live=1 uses the real service.
// Optional argument: an existing saved article body HTML file (not a complete page).
// Optional second argument: a baseline article stylesheet directory for before/after checks.
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
const origin = 'http://127.0.0.1:4323'
const id = 'data-v-player-check'
const articleStyles = process.argv[3] ? resolve(process.argv[3]) : resolve(web, 'styles/article')

async function style(source, filename, scoped) {
  const css = sass.compileString(source.replaceAll('~~/styles/article/', articleStyles + '/').replaceAll('~~/', web + '/'), { loadPaths: [dirname(filename), resolve(web, 'node_modules')] }).css
  const code = new MagicString(css)
  await transformer.transform(code, filename + '.css', { uno })
  const compiled = compileStyle({ source: code.toString(), filename, id, scoped })
  assert.deepEqual(compiled.errors, [])
  return compiled.code
}

async function componentStyles(path) {
  const filename = resolve(web, path)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  return (await Promise.all(descriptor.styles.map(s => style(s.content, filename, !!s.scoped)))).join('\n')
}

const css = [
  readFileSync(resolve(web, 'styles/theme.tokens.css'), 'utf8'),
  readFileSync(resolve(web, 'styles/theme.css'), 'utf8'),
  await style(readFileSync(resolve(web, 'styles/global.scss'), 'utf8'), resolve(web, 'styles/global.scss'), false),
  await componentStyles('app/components/Article/BookmarkArticle.vue')
].join('\n')

const client = (await build({
  stdin: { contents: `
    import { nextTick } from 'vue';
    import { YoutubeProcessor } from './app/components/Article/processors/youtube.processor';
    globalThis.tryUseNuxtApp = () => null;
    const live = new URL(location.href).searchParams.has('live');
    if (!live) window.YT = { Player: class {
      constructor(node, options) { const frame = document.createElement('iframe'); frame.src = '/native'; node.replaceWith(frame); options.events.onReady(); }
      seekTo() {} playVideo() {} getCurrentTime() { return 0; } destroy() {}
    } };
    const container = document.querySelector('.article-detail');
    const paragraph = container.querySelector('.slax-yt-introduction p');
    const text = paragraph.firstChild;
    const context = { container, url: new URL('https://youtube.com/watch?v=goiVFy4jqPA'), articleStyle: 'default', callbacks: {}, cleanups: [] };
    const snapshot = () => {
      const host = container.querySelector('youtube-player, youtube-player-view');
      const frame = host.shadowRoot?.querySelector('.player-frame') || host.querySelector('iframe');
      const box = host.getBoundingClientRect(), inner = frame.getBoundingClientRect();
      return { hostDisplay: getComputedStyle(host).display, width: box.width, height: box.height, frameHeight: inner.height,
        top: inner.top, paragraphTop: paragraph.getBoundingClientRect().top, minHeight: getComputedStyle(frame).minHeight };
    };
    let cls = 0; const candidates = [];
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(list => { for (const e of list.getEntries()) candidates.push({ startTime: e.startTime, id: e.element?.id, size: e.size }); }).observe({ type: 'largest-contentful-paint', buffered: true });
    const controls = ['#ordinary', '#podcast', '#raw', '#expanded'].map(selector => {
      const node = document.querySelector(selector); const frame = node.querySelector('iframe');
      return { node, height: frame.getBoundingClientRect().height, html: node.innerHTML, minHeight: getComputedStyle(frame).minHeight };
    });
    const run = async () => {
      const before = snapshot(); new YoutubeProcessor().process(context); await nextTick();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = snapshot();
      setTimeout(() => {
        const delta = after.paragraphTop - before.paragraphTop;
        const result = { type: 'youtube-player-layout-result', theme: document.documentElement.dataset.slaxTheme, viewport: innerWidth, leadingNode: new URL(location.href).searchParams.has('leading'), before, after,
          paragraphDelta: delta, textRetained: paragraph.firstChild === text, candidates, cls,
          negativeControlsUnchanged: controls.every(c => c.minHeight === '400px' && c.node.innerHTML === c.html && c.node.querySelector('iframe').getBoundingClientRect().height === c.height),
          pass: Math.abs(delta) < 1 && Math.abs(before.frameHeight - after.frameHeight) < 1 && Math.abs(before.width - after.width) < 1 && Math.abs(before.height - after.height) < 1 && Math.abs(before.top - after.top) < 1 };
        document.getElementById('results').textContent = JSON.stringify(result, null, 2);
        if (parent !== window) parent.postMessage(result, location.origin);
      }, 350);
    };
    document.getElementById('enhance').onclick = run;
    if (!live) setTimeout(run, 1000);
  `, resolveDir: web, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent', alias: { '~': resolve(web, 'app') },
  plugins: [{ name: 'actual-youtube-element', setup(plugin) {
    plugin.onResolve({ filter: /\/CEComponents$|^\.\.\/CEComponents$/ }, () => ({ path: 'youtube', namespace: 'fixture-ce' }))
    plugin.onLoad({ filter: /.*/, namespace: 'fixture-ce' }, () => ({ contents: `import { defineCustomElement } from 'vue'; import Player from '${resolve(web, 'app/components/Article/CEComponents/youtube/YoutubePlayer.ce.vue')}'; export const YoutubePlayerElement = defineCustomElement(Player); customElements.define('youtube-player-view', YoutubePlayerElement); export const PodcastPlayerElement = null;`, resolveDir: web, loader: 'ts' }))
    plugin.onLoad({ filter: /\.ce\.vue$/ }, async args => {
      const { descriptor } = parse(readFileSync(args.path, 'utf8'), { filename: args.path })
      const script = compileScript(descriptor, { id, inlineTemplate: true })
      const styles = await Promise.all(descriptor.styles.map(s => style(s.content, args.path, !!s.scoped)))
      return { contents: script.content.replace('export default', 'const Component =') + `\nComponent.__scopeId='${id}'; Component.styles=${JSON.stringify(styles)}; export default Component;`, resolveDir: web, loader: 'ts' }
    })
  } }]
})).outputFiles[0].text

const iframe = '<iframe src="/native" style="width:100%;aspect-ratio:16/9;border:0" frameborder="0" allowfullscreen></iframe>'
const source = `<div class="slax-yt" data-slax-derived="youtube"><youtube-player data-video-id="goiVFy4jqPA" data-cues="[]">${iframe}</youtube-player><article class="slax-pod-article" data-slax-derived="youtube-article"><aside class="slax-yt-introduction"><span class="slax-yt-label">Introduction</span><p id="introduction">Readable saved article text retains its original nodes and becomes visible without waiting for player enhancement. This paragraph is deliberately long enough to remain a useful contentful-paint candidate.</p></aside><h2 class="slax-pod-heading" data-start-ms="65000">Chapter</h2><p class="slax-pod-p">Complete chapter text.</p></article></div>`
const bodySource = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : source
const server = createServer((request, response) => {
  const url = new URL(request.url, origin)
  if (url.pathname === '/client.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(client); return }
  if (url.pathname === '/native') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Native player fallback</title><button>Native player control</button>'); return }
  if (/^\/fonts\/(playfair-display-latin(-ext)?\.woff2|source-serif-pro-(400|700)-normal\.woff)$/.test(url.pathname)) {
    response.setHeader('Content-Type', 'font/woff'); response.end(readFileSync(resolve(web, 'public', url.pathname.slice(1)))); return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (url.pathname === '/matrix') {
    const frames = ['light', 'dark', 'eink'].flatMap(theme => [390, 768, 1440].flatMap(width => ['', '&leading=1'].map(leading => `<iframe title="${theme} ${width}${leading}" style="width:${width}px;height:844px" src="/?theme=${theme}${leading}"></iframe>`))).join('')
    response.end(`<!doctype html><title>YouTube player geometry matrix</title><h1>YouTube player geometry matrix</h1><pre id="results">Running 18 layout cases…</pre><script>const rows=[];addEventListener('message',e=>{if(e.origin!==location.origin||e.data?.type!=='youtube-player-layout-result')return;rows.push(e.data);document.getElementById('results').textContent=JSON.stringify({complete:rows.length,passed:rows.filter(r=>r.pass&&r.textRetained&&r.negativeControlsUnchanged).length,rows},null,2)})</script>${frames}`)
    return
  }
  const theme = ['light', 'dark', 'eink'].includes(url.searchParams.get('theme')) ? url.searchParams.get('theme') : 'light'
  const live = url.searchParams.has('live')
  const savedBody = url.searchParams.has('leading') ? bodySource.replace('<youtube-player', '<script type="application/json">null</script><youtube-player') : bodySource
  const body = live ? savedBody.replace('src="/native"', 'src="https://www.youtube.com/embed/goiVFy4jqPA"') : savedBody.replace(/src="https:\/\/www.youtube.com\/embed\/[^"]+"/, 'src="/native"')
  response.end(`<!doctype html><html data-slax-theme="${theme}" class="${theme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube player layout regression</title><style>${css}body{margin:0}#results{white-space:pre-wrap;font:12px monospace}.bookmark-article{--slax-content-w:800px}</style><div class="bookmark-article snapshot default" ${id}><header class="article-header" ${id}><h1 class="article-title" ${id}>Saved YouTube article</h1></header><div class="article-detail article-body default" ${id}><div class="html-text" ${id}>${body}</div></div></div><button id="enhance">Enhance player</button><pre id="results">Waiting for initial paint…</pre><section id="ordinary" class="article-detail default"><p>Ordinary iframe</p>${iframe}</section><section id="podcast" class="article-detail default"><article data-slax-derived="podcast-article">Podcast control</article>${iframe}</section><section id="raw" class="article-detail default"><youtube-player>${iframe}</youtube-player><div class="slax-yt-transcript">Raw captions</div></section><section id="expanded" class="article-detail default"><youtube-player>${iframe}</youtube-player></section><article data-slax-derived="youtube-article">Separate article outside the raw container.</article><script type="module" src="/client.js"></script></html>`)
})
server.listen(4323, '127.0.0.1', () => console.log('YouTube layout fixture: ' + origin + '/matrix'))
process.on('SIGINT', () => server.close()); process.on('SIGTERM', () => server.close())
