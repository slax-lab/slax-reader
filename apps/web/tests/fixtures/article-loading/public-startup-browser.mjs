// Synthetic BFCache fixture for the real restore plugin and exit policy.
// Database, token storage and Nuxt navigation boundaries are test adapters.
// Run: node apps/web/tests/fixtures/article-loading/public-startup-browser.mjs
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const web = fileURLToPath(new URL('../../..', import.meta.url))
const require = createRequire(resolve(web, 'package.json'))
const { build } = createRequire(require.resolve('wrangler'))('esbuild')
const adapter = `
  export const defineNuxtPlugin = value => value;
  export const getUserToken = () => {
    const state = sessionStorage.getItem('lcp-fixture-state') || 'absent';
    if (state === 'error') throw new Error('synthetic unreadable token');
    return state === 'present' ? 'synthetic' : null;
  };
  export const router = {
    currentRoute: { get value() { return { fullPath: location.pathname + location.search + location.hash }; } },
    resolve(path) { const url = new URL(path, location.href); return { fullPath: url.pathname + url.search + url.hash }; }
  };
  export const useRouter = () => router;
  export const navigateTo = path => {
    sessionStorage.setItem('lcp-fixture-navigations', String(Number(sessionStorage.getItem('lcp-fixture-navigations') || 0) + 1));
    location.assign(path);
    return false;
  };
`
const output = await build({
  stdin: { sourcefile: 'public-startup-browser.ts', resolveDir: web, contents: `
    import restore from './app/plugins/powersync-public-restore.client.ts';
    import { shouldBypassPublicDatabase, needsPublicDocumentExit } from './app/local-first/public-startup-policy.ts';
    import { getUserToken } from 'fixture-adapter';
    let tokenState = 'error';
    try { tokenState = getUserToken() ? 'present' : 'absent'; } catch {}
    const bypassed = shouldBypassPublicDatabase({ enabled:true, pathname:location.pathname, topLevel:true, tokenState });
    const app = { $powersyncPublicBypass: bypassed, runWithContext: fn => fn(), vueApp: { onUnmount: () => {} } };
    const { provide } = restore.setup(app);
    const id = crypto.randomUUID();
    let persisted = null;
    const render = () => {
      document.getElementById('state').textContent = JSON.stringify({ document:id, bypassed, path:location.pathname + location.search + location.hash, persisted, token:sessionStorage.getItem('lcp-fixture-state') || 'absent', navigations:Number(sessionStorage.getItem('lcp-fixture-navigations') || 0), restoreEvents:JSON.parse(sessionStorage.getItem('lcp-fixture-restores') || '[]') }, null, 2);
    };
    addEventListener('pageshow', event => {
      persisted = event.persisted;
      if (event.persisted) {
        const events = JSON.parse(sessionStorage.getItem('lcp-fixture-restores') || '[]');
        events.push({ document:id, path:location.pathname, token:sessionStorage.getItem('lcp-fixture-state') || 'absent' });
        sessionStorage.setItem('lcp-fixture-restores', JSON.stringify(events));
      }
      render();
    });
    for (const button of document.querySelectorAll('button[data-state]')) button.onclick = () => { sessionStorage.setItem('lcp-fixture-state', button.dataset.state); render(); };
    document.getElementById('reset').onclick = () => {
      for (const key of ['state','navigations','restores']) sessionStorage.removeItem('lcp-fixture-' + key);
      location.assign('/login?campaign=synthetic#start');
    };
    for (const link of document.querySelectorAll('a')) link.onclick = async event => {
      const to = new URL(link.href); event.preventDefault();
      if (needsPublicDocumentExit(bypassed, to.pathname)) await provide.powersyncPublicNavigate(to.pathname + to.search + to.hash);
      else location.assign(to.pathname + to.search + to.hash);
    };
    render();
  ` },
  bundle: true, write: false, format: 'esm', platform: 'browser',
  inject: ['fixture-adapter'],
  plugins: [{ name: 'fixture-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(fixture-adapter|~\/utils\/request)$/ }, () => ({ path: 'adapter', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: adapter, loader: 'js' }))
  } }]
})
const server = createServer((request, response) => {
  if (request.url === '/app.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(output.outputFiles[0].text)
    return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end('<!doctype html><title>Public startup BFCache fixture</title><style>body{font:16px system-ui;margin:24px}button,a{margin-right:12px}pre{white-space:pre-wrap}</style><h1>Public startup BFCache fixture</h1><p>All account state here is synthetic.</p><button id="reset">Reset to anonymous login</button><button data-state="absent">Set absent</button><button data-state="present">Set present</button><button data-state="error">Set read error</button><p><a href="/normal?campaign=synthetic#destination">Leave public page</a><a href="/guide?campaign=synthetic#guide">Open guide</a><a href="/login?campaign=synthetic#login">Open login</a></p><pre id="state"></pre><script type="module" src="/app.js"></script>')
})
server.listen(4319, '127.0.0.1', () => console.log('Public startup fixture: http://127.0.0.1:4319/login'))
process.on('SIGTERM', () => { server.close(); process.exit() })
