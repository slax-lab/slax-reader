// Exercise the built Pages Worker and real renewal code against a simulated cookie jar.
import { Window } from 'happy-dom'
import { createJiti } from 'jiti'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const jiti = createJiti(import.meta.url)
const { createAccountLocaleRequest } = await jiti.import('../../../app/utils/accountLocaleRequest.ts')
const { UserLocaleTasks } = await jiti.import('../../../app/utils/userLocaleTasks.ts')
const { withWebSessionLock, writeWebSession } = await jiti.import('../../../app/utils/webSession.ts')
const origin = process.env.SESSION_TEST_ORIGIN || 'http://localhost:3320'
const api = process.env.SESSION_TEST_API || 'http://127.0.0.1:8790'
const name = process.env.SESSION_TEST_COOKIE_NAME || 'reader_token'
const path = '/api/auth/session'
const jwt = (id, marker) =>
  ['{"alg":"HS256"}', JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + 3600 }), marker]
    .map(value => Buffer.from(value).toString('base64url')).join('.')
const old = jwt('1', 'initial')
const fresh = jwt('1', 'renewed')
const replacement = jwt('2', 'replacement')
const user = { userId: '1', uuid: 'test', name: 'Fixture', lang: 'en', email: 'fixture@example.test', subscription_type: 0 }
const attribution = { source: 'hackerlinks', medium: 'header', campaign: 'mvp' }
const records = []
let barrier
const networkFetch = globalThis.fetch
// Node Web Locks are shared by the simulated Reader tabs.
globalThis.window = new Window({ url: origin })

const upstream = createServer(async (req, res) => {
  const { url, method, headers } = req
  const reply = (status, data) => res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': headers['access-control-request-headers'] ?? '*'
  }).end(JSON.stringify({ code: status, data }))
  if (method === 'OPTIONS') return reply(200)
  const target = new URL(url, api)
  if (target.pathname === '/fixture') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.end('<h1>Reader local OAuth and cookie test</h1><p>All accounts and credentials are synthetic.</p><ul><li><a href="/start?provider=google">Google callback</a></li><li><a href="/start?provider=apple">Apple callback</a></li></ul>')
  }
  if (target.pathname === '/start') {
    const platform = target.searchParams.get('provider') === 'apple' ? 'apple' : 'google'
    const state = JSON.stringify({ nonce: crypto.randomUUID(), platform, redirectUrl: origin + '/auth', target: '/guide?return=fixture', affCode: 'fixture-referral', auth_attribution: attribution })
    const query = new URLSearchParams({ code: 'fixture', state })
    return res.writeHead(302, { Location: origin + '/auth?' + query,
      'Set-Cookie': [name + '=; Path=/; Max-Age=0', `slax_oauth_attempt=${digest(state)}; Path=/; SameSite=Lax; Max-Age=600`]
    }).end()
  }
  if (target.pathname === '/observations') {
    const cookie = headers.cookie?.split('; ').find(value => value.startsWith(name + '='))
    const session = cookie === name + '=' + fresh ? 'renewed' : cookie === name + '=' + old ? 'signed in' : 'missing'
    return reply(200, { session, requests: records })
  }
  if (url === '/v1/user/login') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    records.push({ url, origin: headers.origin, body: JSON.parse(Buffer.concat(chunks)) })
    return reply(200, { token: old })
  }
  if (url === '/v1/user/refresh') {
    if (headers.origin) records.push({ url, origin: headers.origin })
    if (barrier?.stage === 'refresh') {
      barrier.entered.resolve()
      const status = await barrier.released.promise
      if (status === 401) return reply(401)
    }
    return headers.authorization === 'Bearer ' + old ? reply(200, { token: fresh }) : reply(401)
  }
  if (url === '/v1/user/me') {
    records.push({ url, origin: headers.origin })
    return [old, fresh, replacement].some(token => headers.authorization === 'Bearer ' + token) ? reply(200, user) : reply(401)
  }
  if (url?.startsWith('/v1/sync/token')) return reply(200, { token: '', endpoint: '' })
  if (url?.startsWith('/v1/user/setting')) return reply(200, {})
  return reply(200, [])
})

const digest = state => createHash('sha256').update(state).digest('hex')

function fixture() {
  const { document } = new Window({ url: origin })
  const read = () => document.cookie.split('; ').find(entry => entry.startsWith(name + '='))?.slice(name.length + 1) || undefined
  const set = value => { document.cookie = name + '=' + value + '; Domain=localhost; Path=/' }
  const remove = () => { document.cookie = name + '=; Domain=localhost; Path=/; Max-Age=0' }
  const request = async (options = {}) => {
    const response = await networkFetch(origin + path, {
      ...options,
      headers: { Origin: origin, Cookie: document.cookie, ...options.headers },
      signal: options.signal ?? AbortSignal.timeout(8000)
    })
    if (barrier?.stage === 'response' && options.headers?.Authorization) {
      barrier.entered.resolve()
      await barrier.released.promise
    }
    for (const header of response.headers.getSetCookie()) document.cookie = header
    return response
  }
  const login = token => withWebSessionLock(async () => {
    const state = JSON.stringify({ nonce: crypto.randomUUID() })
    document.cookie = 'slax_oauth_attempt=' + digest(state) + '; Path=/; SameSite=Lax'
    const response = await request({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', token, state })
    })
    assert.equal(response.status, 204)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(await response.text(), '')
    assert.equal(read(), token)
  })
  const tasks = new UserLocaleTasks({ user: null, locale: 'en', confirmedAccountLocale: null }, {
    api: createAccountLocaleRequest({ baseUrl: api, headers: {} }),
    getToken: read,
    setToken: set,
    writeWebSession: (token, startingToken, signal) => writeWebSession({ action: 'refresh', token, startingToken }, signal),
    apply: async () => {},
    notify: () => {},
    expire: async () => remove()
  })
  const renew = async (writerUnavailable = false) => {
    globalThis.fetch = (url, options) => {
      if (url !== path) return networkFetch(url, options)
      if (writerUnavailable) return Promise.resolve(new Response(null, { status: 503 }))
      return request(options)
    }
    try {
      await tasks.refreshToken()
    } finally {
      globalThis.fetch = networkFetch
    }
  }
  const logout = () => withWebSessionLock(() => {
    remove()
    tasks.clear()
  })
  return { read, login, logout, remove, renew }
}

async function clearAsExtension({ read, remove }) {
  const get = async () => read() ? { name, domain: 'localhost', path: '/', secure: false, value: read(), storeId: 'fixture' } : null
  globalThis.browser = { cookies: { getAll: async () => [await get()].filter(Boolean), get, remove } }
  Object.assign(process.env, { PUBLIC_BASE_URL: origin, COOKIE_DOMAIN: 'localhost', COOKIE_TOKEN_NAME: name })
  const { SessionService } = await jiti.import('../../../../extension/src/entrypoints/background/sessionService.ts')
  assert.equal(await new SessionService().clearSession(old), true)
}

async function ordering() {
  const cases = [
    ['same-tab logout', 200, f => f.logout(), undefined],
    ['other-tab logout', 200, f => withWebSessionLock(f.remove), undefined],
    ['replacement login', 200, f => f.login(replacement), replacement],
    ['legacy Extension cleanup', 200, clearAsExtension, undefined],
    ['replacement login before old 401', 401, f => f.login(replacement), replacement]
  ]
  for (const stage of ['refresh', 'response']) {
    for (const [label, status, mutate, expected] of cases) {
      if (stage === 'response' && status === 401) continue
      const f = fixture()
      await f.login(old)
      barrier = { stage, entered: Promise.withResolvers(), released: Promise.withResolvers() }
      const pending = f.renew()
      try {
        await Promise.race([barrier.entered.promise, pending.then(() => { throw new Error('Renewal finished before ' + stage + ' barrier') })])
        const mutation = mutate(f)
        if (stage === 'response' && label !== 'legacy Extension cleanup') {
          const { pending: requests } = await navigator.locks.query()
          assert(requests.some(request => request.name === 'slax-reader:web-session'), 'Reader mutation should wait for the writer')
          assert.equal(f.read(), old)
          barrier.released.resolve(status)
        }
        await mutation
        assert.equal(f.read(), expected)
      } finally {
        barrier.released.resolve(status)
        await pending
        barrier = undefined
      }
      const test = stage + ' / ' + label
      if (stage === 'response' && label === 'legacy Extension cleanup') {
        assert.equal(f.read(), fresh, 'A delayed response can still overwrite direct Extension cleanup')
        console.log('DEFERRED: ' + test + ' still reproduces without the Reader lock')
      } else {
        assert.equal(f.read(), expected, test + ' must preserve the latest session')
        console.log('PASS: ' + test)
      }
    }
  }
}

await new Promise((resolve, reject) => upstream.once('error', reject).listen(Number(new URL(api).port), '127.0.0.1', resolve))
if (process.argv.includes('--serve')) {
  console.log('Synthetic OAuth callbacks: ' + new URL('/fixture', api).href.replace('127.0.0.1', 'localhost'))
} else {
  try {
    const f = fixture()
    await f.login(old)
    await f.renew()
    assert.equal(f.read(), fresh)
    console.log('PASS: Pages Worker issues the cookie for login and renewal')
    const degraded = fixture()
    await degraded.login(old)
    await degraded.renew(true)
    assert.equal(degraded.read(), fresh)
    console.log('PASS: Renewal falls back to JavaScript when the cookie request returns 503')
    if (!process.argv.includes('--skip-ordering')) await ordering()
    assert(!records.some(record => record.url === '/v1/user/me'), 'Cookie writes should not request the user profile')
  } finally {
    upstream.close()
  }
}
