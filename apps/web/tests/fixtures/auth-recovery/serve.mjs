// Local HTTP fault service and actual callback Vue/composable/request client.
// Run: node apps/web/tests/fixtures/auth-recovery/serve.mjs [port] [--baseline]
// Provider endpoints are redirected to local receipts; no real account or code is used.
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { createApp, eventHandler, setResponseHeader, toNodeListener } from 'h3'
import { createJiti } from 'jiti'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = fileURLToPath(new URL('../../../', import.meta.url))
// Icon collections resolve from the application directory, just as in the Nuxt runner.
process.chdir(webRoot)
const fixtureRoot = path.join(webRoot, 'tests/fixtures/auth-recovery')
const require = createRequire(path.join(webRoot, 'package.json'))
const { createServer } = await import(require.resolve('vite'))
const { default: UnoCSS } = await import(require.resolve('unocss/vite'))
const builder = createRequire(require.resolve('nuxt/package.json')).resolve('@nuxt/vite-builder')
const { default: vue } = await import(createRequire(builder).resolve('@vitejs/plugin-vue'))
const port = Number(process.argv[2] || 44020)
const baseline = process.argv.includes('--baseline')
const baselineRef = '08bf850a9272d45211b974a1876324560f054ef8'
const original = file => execFileSync('git', ['show', `${baselineRef}:apps/web/${file}`], { cwd: webRoot, encoding: 'utf8' })
const oldPage = baseline ? original('app/pages/auth.vue') : null
const oldAuth = baseline ? original('app/composables/useAuth.ts') : null
const runtime = path.join(fixtureRoot, 'runtime.ts')
const requests = []
const origin = `http://127.0.0.1:${port}`
const fixtureToken = [
  Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
  Buffer.from(JSON.stringify({ id: 'fixture', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
  'synthetic'
].join('.')
globalThis.useRuntimeConfig = () => ({ public: {
  PUBLIC_BASE_URL: origin,
  AUTH_BASE_URL: origin,
  DWEB_API_BASE_URL: origin,
  GOOGLE_OAUTH_CLIENT_ID: 'synthetic-google-client',
  APPLE_OAUTH_CLIENT_ID: 'synthetic-apple-client',
  COOKIE_TOKEN_NAME: 'slax_auth_probe'
} })
const serveCallback = toNodeListener(createApp()
  .use(await createJiti(import.meta.url).import('../../../server/middleware/oauth-callback.ts', { default: true }))
  .use(eventHandler(async event => {
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return callbackHtml()
  })))
function callbackHtml() {
  return server.transformIndexHtml('/auth', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/tests/fixtures/auth-recovery/main.ts"></script></body></html>')
}
const server = await createServer({
  root: webRoot,
  cacheDir: path.join(webRoot, `node_modules/.vite-auth-recovery-${port}`),
  configFile: false,
  define: { 'import.meta.client': 'true', 'import.meta.server': 'false' },
  server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [path.resolve(webRoot, '../..')] } },
  resolve: { alias: [
    { find: '~/stores/user', replacement: runtime },
    { find: '~~', replacement: webRoot },
    { find: '~', replacement: path.join(webRoot, 'app') }
  ] },
  plugins: [{
    name: 'auth-recovery-environment',
    enforce: 'pre',
    transform(source, id) {
      if (id.includes('?')) return
      if (id.endsWith('/app/pages/auth.vue')) return (oldPage ?? source).replaceAll('import.meta.client', 'true').replace('<script lang="ts" setup>', `<script lang="ts" setup>
import { useI18n } from 'vue-i18n'
import { useAuth, navigateTo, useHead } from '${runtime}'
`)
      if (id.endsWith('/app/composables/useAuth.ts')) return `import { useRuntimeConfig } from '${runtime}'\nimport { request } from '~/utils/request'\n${oldAuth ?? source}`
        .replace('https://accounts.google.com/o/oauth2/v2/auth', '/__fixture/google/authorize')
        .replace('https://appleid.apple.com/auth/authorize', '/__fixture/apple/authorize')
      if (id.endsWith('/app/utils/request.ts')) return `import { useRuntimeConfig, useAuth, navigateTo, tryUseNuxtApp, useRequestHeaders } from '${runtime}';\n${source}`
      if (/\/app\/components\/(Google|Apple)LoginButton\.vue$/.test(id)) return source.replace('<script lang="ts" setup>', `<script lang="ts" setup>\nimport { useAuth, useNuxtApp, analyticsLog, eventLog } from '${runtime}'\n`)
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, `http://127.0.0.1:${port}`)
        const json = (data, status = 200) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        }
        const html = body => {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${body}</body></html>`)
        }
        if (url.pathname === '/__fixture/requests') return json(requests)
        if (url.pathname.match(/^\/__fixture\/(google|apple)\/authorize$/)) {
          requests.push({ kind: 'authorization', provider: url.pathname.split('/')[2], query: Object.fromEntries(url.searchParams) })
          return html('<h1>Fresh provider authorization started</h1><p>This is a local receipt; no Google or Apple account was contacted.</p><a href="/">Back to scenarios</a>')
        }
        if (url.pathname === '/__fixture/done') return html('<h1>Login completed</h1><p>The callback set a synthetic session and navigated here.</p><a href="/">Back to scenarios</a>')
        if (url.pathname === '/login') return html('<h1>Login entry</h1><a href="/">Back to scenarios</a>')
        if (url.pathname === '/') {
          const links = ['disconnect', 'pending', 'provider-error', 'success'].map(mode =>
            `<li><a href="/__fixture/start?case=${mode}">${mode}</a></li>`
          ).join('')
          return html(`<h1>OAuth callback recovery acceptance</h1><p>Actual callback and local synthetic API/provider boundaries. Pending takes 20 seconds.</p><ul>${links}</ul>`)
        }
        if (url.pathname === '/__fixture/start') {
          const mode = url.searchParams.get('case') || 'disconnect'
          const nonce = randomBytes(16).toString('hex')
          const state = JSON.stringify({ nonce, redirectUrl: `${url.origin}/auth`, target: '/__fixture/done?return=preserved', affCode: 'synthetic-referral', platform: 'google' })
          const query = new URLSearchParams({ case: mode, code: 'synthetic-' + mode, state })
          res.writeHead(302, {
            'Set-Cookie': 'reader-oauth-' + nonce + '=' + createHash('sha256').update(state).digest('hex') + '; Path=/; SameSite=Lax',
            Location: '/auth?' + query.toString()
          })
          return res.end()
        }
        const match = url.pathname.match(/^\/api\/([^/]+)\/v1\/user\/login$/)
        if (match || url.pathname === '/v1/user/login') {
          let body = ''
          for await (const chunk of req) body += chunk
          const payload = JSON.parse(body)
          const entry = { kind: 'login', mode: match?.[1] ?? payload.code.replace(/^synthetic-/, ''), body: payload, canceled: false }
          requests.push(entry)
          res.on('close', () => { if (!res.writableEnded) entry.canceled = true })
          if (entry.mode === 'pending') return
          if (entry.mode === 'disconnect') return req.socket.destroy()
          if (entry.mode === 'provider-error') return json({ code: 500, message: 'Google SSO error', data: 'GOOGLE_SSO_ERROR' }, 500)
          return json({ code: 200, message: 'ok', data: { token: baseline ? 'synthetic-session-token' : fixtureToken } })
        }
        if (url.pathname === '/auth') {
          if (!baseline) return serveCallback(req, res)
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(await callbackHtml())
          return
        }
        next()
      })
    }
  }, UnoCSS(path.join(webRoot, 'uno.config.ts')), vue()]
})
await server.listen()
console.log(`Auth callback acceptance fixture: http://127.0.0.1:${port}/ (baseline=${baseline})`)
