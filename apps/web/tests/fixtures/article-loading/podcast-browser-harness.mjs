// Real custom element and native audio. Run from the repository root, then open :4319.
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const web = fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(resolve(web, 'package.json'))
const wrangler = createRequire(require.resolve('wrangler'))
const { build } = wrangler('esbuild')
const { parse, compileScript, compileStyleAsync } = require('vue/compiler-sfc')
const file = resolve(web, 'app/components/Article/CEComponents/podcast/PodcastPlayer.ce.vue')
const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
const script = compileScript(descriptor, { id: 'podcast-check', inlineTemplate: true })
const styles = await Promise.all(descriptor.styles.map(style => compileStyleAsync({ source: style.content, filename: file, id: 'podcast-check', scoped: !!style.scoped, preprocessLang: 'scss' })))
const component = script.content.replace('export default', 'const Player =')
const { outputFiles } = await build({
  stdin: { contents: `${component}\nimport { defineCustomElement } from 'vue';
    const useNuxtApp = () => ({ $i18n: { t: key => key.split('.').at(-1) } });
    const src = location.origin + '/episode.wav?case=' + (new URL(location.href).searchParams.get('case') || 'default');
    const saved = new URL(location.href).searchParams.get('saved') || '30';
    localStorage.setItem('slax:podcast-pos:' + src, saved);
    Player.__scopeId = 'data-v-podcast-check';
    document.documentElement.dataset.slaxTheme = new URL(location.href).searchParams.get('theme') || 'light';
    document.documentElement.className = document.documentElement.dataset.slaxTheme;
    Player.styles = ${JSON.stringify(styles.map(style => style.code))};
    customElements.define('slax-podcast-check', defineCustomElement(Player));
    const player = document.createElement('slax-podcast-check'); player.src = src; player.title = 'Real podcast controls'; player.durationMs = new URL(location.href).searchParams.get('duration') || '90000'; document.getElementById('player').append(player);
    document.getElementById('description').textContent = 'Saved position: ' + saved + ' seconds. Supplied duration: ' + player.durationMs + ' ms. Native media: 90 seconds.';
    const events = [];
    window.addEventListener('slax:youtube-time', event => { if (event.detail.playing) events.push(event.detail); });
    document.getElementById('chapter').onclick = () => window.dispatchEvent(new CustomEvent('slax:youtube-seek', { detail: { t: 45 } }));
    setInterval(async () => {
      const audio = player.shadowRoot?.querySelector('audio');
      if (!audio) return;
      const stats = await (await fetch('/stats' + new URL(src).search)).json();
      const result = { preload: audio.preload, readyState: audio.readyState, currentTime: audio.currentTime, paused: audio.paused, rate: audio.playbackRate, currentDisplay: player.shadowRoot.querySelector('.time')?.textContent, durationDisplay: player.shadowRoot.querySelector('.total')?.textContent, error: !!player.shadowRoot.querySelector('.error'), audioRequests: stats.requests, firstPlayingTimes: events.slice(0, 8) };
      document.getElementById('results').textContent = JSON.stringify(result, null, 2);
    }, 250);
  `, resolveDir: web, sourcefile: 'podcast-browser.ts', loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent', alias: { '~': resolve(web, 'app') }
})
// Ninety seconds of silent PCM, served with real Range support for browser seeking.
const wav = Buffer.alloc(44 + 90 * 8000 * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28)
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
const requests = new Map()
const tokens = readFileSync(resolve(web, 'styles/theme.tokens.css'), 'utf8')
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4319')
  const key = url.searchParams.get('case') || 'default'
  if (url.pathname === '/client.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(outputFiles[0].text); return }
  if (url.pathname === '/stats') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ requests: requests.get(key) || 0 })); return }
  if (url.pathname === '/episode.wav') {
    requests.set(key, (requests.get(key) || 0) + 1)
    response.setHeader('Content-Type', 'audio/wav'); response.setHeader('Accept-Ranges', 'bytes'); response.setHeader('Cache-Control', 'no-store')
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '')
    const start = range ? Number(range[1]) : 0
    const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1
    if (range) { response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${wav.length}`) }
    response.setHeader('Content-Length', end - start + 1); response.end(wav.subarray(start, end + 1)); return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Podcast playback regression</title><style>${tokens}body{margin:16px;background:var(--slax-background);color:var(--slax-text);font-family:system-ui}pre{white-space:pre-wrap}iframe{display:block;width:100%;height:180px;border:0}</style><h1>Podcast playback regression</h1><p id="description">Saved position: 0:30. Chapter intent: 0:45. Duration: 1:30.</p><button id="chapter">Play chapter at 0:45</button><div id="player"></div><pre id="results">Loading controls…</pre><script type="module" src="/client.js"></script>`)
})
server.listen(4319, '127.0.0.1', () => console.log('Podcast browser harness: http://127.0.0.1:4319'))
process.on('SIGINT', () => server.close()); process.on('SIGTERM', () => server.close())
