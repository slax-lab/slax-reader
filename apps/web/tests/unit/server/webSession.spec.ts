// @vitest-environment happy-dom
import * as h3 from 'h3'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const origin = 'https://reader.test'
const fetchUser = vi.fn()
const config = { public: { PUBLIC_BASE_URL: origin, DWEB_API_BASE_URL: 'https://api.test', COOKIE_TOKEN_NAME: 'reader_token', COOKIE_DOMAIN: '.reader.test' } }
vi.mock('#app/nuxt', async original => ({
  ...(await original<Record<string, unknown>>()),
  useRuntimeConfig: () => config
}))

let handle: ReturnType<typeof h3.toPlainHandler>
beforeAll(async () => {
  Object.assign(globalThis, { useRuntimeConfig: () => config })
  const route = await import('../../../server/api/auth/session.post')
  const app = h3.createApp()
  app.use(route.default)
  handle = h3.toPlainHandler(app)
})

beforeEach(() => {
  fetchUser.mockReset().mockImplementation(async () => Response.json({ code: 200, data: { email: 'private@example.test' } }))
  vi.stubGlobal('fetch', fetchUser)
})

const token = (id = '1', exp: unknown = Date.now() / 1000 + 600, signature = 'fixture') =>
  `e30.${Buffer.from(JSON.stringify({ id, exp })).toString('base64url')}.${signature}`
const starting = token()
const refreshed = token('1', Date.now() / 1000 + 800, 'renewed')
const state = '{"nonce":"callback-attempt"}'
const call = async (body: unknown, headers: Record<string, string> = {}, raw = false) => {
  const res = await handle({
    path: '/api/auth/session',
    method: 'POST',
    headers: { host: 'reader.test', 'x-forwarded-proto': 'https', origin, 'content-type': 'application/json; charset=UTF-8', ...headers },
    body: raw ? String(body) : JSON.stringify(body)
  })
  const cookies = (res.headers as [string, string | string[]][]).flatMap(([name, value]) => name === 'set-cookie' ? value : [])
  expect(new Headers(res.headers as never).get('cache-control')).toBe('no-store')
  return { ...res, cookies }
}
const refresh = { action: 'refresh', token: refreshed }
const sessionHeaders = { authorization: `Bearer ${starting}`, cookie: `reader_token=${starting}` }

describe('Web session cookie writer', () => {
  it.each(['', 'null', 'https://foreign.test', 'https://reader.test:8000'])('rejects Origin %j', async origin => {
    const { status, cookies } = await call(refresh, { ...sessionHeaders, origin })
    expect([status, cookies]).toEqual([403, []])
    expect(fetchUser).not.toHaveBeenCalled()
  })

  it('rejects form and non-JSON requests', async () => {
    expect((await call(refresh, { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415)
    expect((await call("{ action: 'refresh' }", {}, true)).status).toBe(400)
    expect(fetchUser).not.toHaveBeenCalled()
  })

  it.each(['one.two', 'e30.e30.+/', 'e30.not-json.fixture', token('1', Date.now() / 1000 + 600, 'x'), token('1', '2050'), token('1', 1), token('')])('rejects malformed or expired credentials', async token => {
    expect((await call({ action: 'refresh', token }, sessionHeaders)).status).toBe(400)
    expect(fetchUser).not.toHaveBeenCalled()
  })

  it('rejects an unbound login and a replaced or different renewal account', async () => {
    expect((await call({ action: 'login', state, token: refreshed })).status).toBe(400)
    expect((await call(refresh, { ...sessionHeaders, cookie: '' })).status).toBe(409)
    expect((await call(refresh, { ...sessionHeaders, cookie: `reader_token=${token('2')}` })).status).toBe(409)
    expect((await call({ ...refresh, token: token('2') }, sessionHeaders)).status).toBe(409)
    expect(fetchUser).not.toHaveBeenCalled()
  })

  it('writes only the configured, readable cookie on refresh without requesting the API', async () => {
    const { status, cookies, body } = await call(refresh, sessionHeaders)
    expect(status).toBe(204)
    expect(body).toBeFalsy()
    expect(cookies).toEqual([expect.stringContaining(`reader_token=${refreshed}`)])
    expect(cookies[0]).toMatch(/Domain=\.?reader\.test; Path=\/; Expires=.+; Secure/i)
    expect(cookies[0]).not.toMatch(/HttpOnly/i)
    expect(fetchUser).not.toHaveBeenCalled()
  })

  it('consumes the exact browser-bound state on login', async () => {
    const { oauthAttemptCookie, oauthStateDigest } = await import('../../../app/utils/oauthAttempt')
    const cookie = `${oauthAttemptCookie(true)}=${await oauthStateDigest(state)}`
    expect((await call({ action: 'login', state: state + ' ', token: refreshed }, { cookie })).status).toBe(400)
    const { status, cookies } = await call({ action: 'login', state, token: refreshed }, { cookie })
    expect(status).toBe(204)
    expect(cookies).toEqual(expect.arrayContaining([expect.stringContaining(`reader_token=${refreshed}`), expect.stringContaining(`${oauthAttemptCookie(true)}=;`)]))
    expect(fetchUser).not.toHaveBeenCalled()
  })
})
