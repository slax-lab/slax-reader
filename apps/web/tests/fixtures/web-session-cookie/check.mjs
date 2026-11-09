// Exercise the built Reader Pages Worker with a local API and a simulated browser Cookie jar.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { Window } from 'happy-dom'
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const { createAccountLocaleRequest } = await jiti.import('../../../app/utils/accountLocaleRequest.ts')
const { UserLocaleTasks } = await jiti.import('../../../app/utils/userLocaleTasks.ts')
const origin = 'http://localhost:3000'
const apiOrigin = 'http://127.0.0.1:8787'
const cookieName = 'token'
const callbackUri = 'http://callback.test/auth'
const target = '/bookmarks?filter=unread&view=all#article'
const acquisition = { source: 'hackerlinks', medium: 'header', campaign: 'mvp' }
const collection = { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' }
const jwt = (id, kind) => [
  Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
  Buffer.from(JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
  Buffer.from(kind).toString('base64url')
].join('.')
const initial = jwt('A', 'login')
const rotated = jwt('A', 'renewed')
const replacement = jwt('B', 'login')
const exchanges = []
let delayed

const upstream = createServer(async (request, response) => {
  const { url, method, headers } = request
  const send = (status, body) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
  if (method !== 'POST') return send(404, {})
  if (url === '/v1/user/login') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks))
    exchanges.push({ body, headers })
    if (body.code === 'fixture-denied') return send(400, { code: 400, message: 'Rejected' })
    if (body.code === 'fixture-invalid-token') return send(200, { code: 200, data: { token: 'invalid-token' } })
    return send(200, { code: 200, data: { token: body.code === 'fixture-account-b' ? replacement : initial } })
  }
  if (url !== '/v1/user/refresh' || headers.authorization !== 'Bearer ' + initial) return send(401, { code: 401 })
  if (delayed) {
    const { entered, released, status } = delayed
    entered.resolve()
    await released.promise
    if (status === 401) return send(401, { code: 401 })
  }
  send(200, { code: 200, data: { token: rotated } })
})

function cookieJar() {
  const { document } = new Window({ url: origin })
  const getToken = () => document.cookie.split('; ').find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || undefined
  const setToken = value => { document.cookie = cookieName + '=' + value + '; Domain=localhost; Path=/' }
  const clearToken = () => { document.cookie = cookieName + '=; Domain=localhost; Path=/; Max-Age=0' }
  const request = async (path, options = {}) => {
    const response = await fetch(origin + path, {
      ...options,
      headers: { Cookie: document.cookie, ...options.headers },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000)
    })
    for (const cookie of response.headers.getSetCookie()) document.cookie = cookie
    return response
  }
  const login = (platform, code, attribution = acquisition) => {
    const nonce = randomBytes(16).toString('hex')
    const state = JSON.stringify({ nonce, platform, target, affCode: 'fixture-invite', auth_attribution: attribution })
    const binding = createHash('sha256').update(state).digest('hex')
    document.cookie = 'reader-oauth-' + nonce + '=' + binding + '; Path=/; SameSite=Lax'
    return request('/api/auth/session', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'Accept-Language': 'en-US,en', 'X-Client-Locale': 'zh' },
      body: JSON.stringify({ action: 'login', code, state })
    })
  }
  const tasks = new UserLocaleTasks({ user: null, locale: 'en', confirmedAccountLocale: null }, {
    api: createAccountLocaleRequest({ baseUrl: apiOrigin, headers: {} }),
    getToken,
    setToken,
    apply: async () => {},
    notify: () => {},
    expire: async () => clearToken()
  })
  return { getToken, clearToken, login, renew: () => tasks.refreshToken() }
}

async function verifyHappyPaths() {
  for (const [provider, attribution] of [['google', collection], ['apple', acquisition]]) {
    const jar = cookieJar()
    const login = await jar.login(provider, 'fixture-account-a', attribution)
    assert.equal(login.status, 200)
    assert.deepEqual(await login.json(), { target })
    assert.equal(login.headers.get('cache-control'), 'no-store')
    assert.equal(jar.getToken(), initial)
    const { body, headers } = exchanges.at(-1)
    assert.equal(body.type, provider)
    assert.equal(body.redirect_uri, callbackUri)
    assert.equal(body.aff_code, 'fixture-invite')
    assert.deepEqual(body.auth_attribution, attribution)
    assert.equal(headers['x-client-locale'], 'zh')
    assert.equal(headers['accept-language'], 'en-US,en')
    assert.equal(headers.cookie, undefined)
    await jar.renew()
    assert.equal(jar.getToken(), rotated)
  }
  const jar = cookieJar()
  const failure = await jar.login('apple', 'fixture-denied')
  assert.equal(failure.status, 502)
  assert.equal(failure.headers.get('cache-control'), 'no-store')
  assert.equal(failure.headers.has('set-cookie'), false)
  assert.equal(jar.getToken(), undefined)
  console.log('PASS: Google and Apple session issuance, failed exchange, and guarded direct API renewal')
}

async function verifyRejections() {
  const endpoint = origin + '/api/auth/session'
  const json = { 'Content-Type': 'application/json' }
  const sameOrigin = { Origin: origin, ...json }
  const cases = [
    [403, json, '{}'],
    [403, { Origin: 'https://other.test', ...json }, '{}'],
    [415, { Origin: origin, 'Content-Type': 'text/plain' }, '{}'],
    [400, sameOrigin, '{'],
    [400, sameOrigin, '{"action":"login","token":"arbitrary-token"}']
  ]
  const exchangesBefore = exchanges.length
  for (const [status, headers, body] of cases) {
    const response = await fetch(endpoint, { method: 'POST', headers, body })
    assert.equal(response.status, status)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.has('set-cookie'), false)
  }
  assert.equal(exchanges.length, exchangesBefore)
  const response = await cookieJar().login('google', 'fixture-invalid-token')
  assert.equal(response.status, 502)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.has('set-cookie'), false)
  console.log('PASS: Worker rejects invalid origin, media type, request and upstream token without writing a cookie')
}

async function clearAsExtension(jar) {
  const current = () => jar.getToken() ? { name: cookieName, value: jar.getToken(), domain: 'localhost', path: '/', secure: false, storeId: 'fixture' } : null
  globalThis.browser = { cookies: { getAll: async () => [current()].filter(Boolean), get: async () => current(), remove: async () => jar.clearToken() } }
  Object.assign(process.env, { PUBLIC_BASE_URL: origin, COOKIE_DOMAIN: 'localhost', COOKIE_TOKEN_NAME: cookieName })
  const { SessionService } = await jiti.import('../../../../extension/src/entrypoints/background/sessionService.ts')
  assert.equal(await new SessionService().clearSession(initial), true)
}

async function verifyOrdering() {
  const switchAccount = async jar => {
    assert.equal((await jar.login('google', 'fixture-account-b')).status, 200)
  }
  const cases = [
    ['Web logout Cookie removal', jar => jar.clearToken(), undefined, 200],
    ['new OAuth login', switchAccount, replacement, 200],
    ['existing Extension clear', clearAsExtension, undefined, 200],
    ['new OAuth login before old renewal 401', switchAccount, replacement, 401]
  ]
  let failures = 0
  for (const [name, mutate, expected, status] of cases) {
    const jar = cookieJar()
    assert.equal((await jar.login('google', 'fixture-account-a')).status, 200)
    const entered = Promise.withResolvers()
    const released = Promise.withResolvers()
    delayed = { entered, released, status }
    const renewal = jar.renew()
    try {
      await Promise.race([entered.promise, renewal.then(() => { throw new Error('Refresh completed before the timing barrier') })])
      await mutate(jar)
      assert.equal(jar.getToken(), expected)
    } finally {
      released.resolve()
      await renewal
      delayed = undefined
    }
    if (jar.getToken() !== expected) {
      failures++
      console.error('FAIL: ' + name + ' was overwritten by the delayed response')
    } else {
      console.log('PASS: ' + name + ' survived the delayed response')
    }
  }
  assert.equal(failures, 0, 'A late renewal must not restore or replace the session')
}

try {
  await new Promise((resolve, reject) => upstream.once('error', reject).listen(8787, '127.0.0.1', resolve))
  await verifyHappyPaths()
  await verifyRejections()
  if (!process.argv.includes('--happy-only')) await verifyOrdering()
} finally {
  upstream.close()
}
