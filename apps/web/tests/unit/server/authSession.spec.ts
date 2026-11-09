// @vitest-environment happy-dom
import sessionRoute from '../../../server/api/auth/session.post'
import { createApp, toPlainHandler } from 'h3'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#app/nuxt', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRuntimeConfig: () => ({ public: config })
}))

const origin = 'https://reader.test'
const config = {
  PUBLIC_BASE_URL: origin,
  AUTH_BASE_URL: 'https://callback.test',
  DWEB_API_BASE_URL: 'https://api.test/prefix',
  COOKIE_TOKEN_NAME: 'token',
  COOKIE_DOMAIN: 'reader.test',
  GOOGLE_OAUTH_CLIENT_ID: 'google-test',
  APPLE_OAUTH_CLIENT_ID: 'apple-test'
}
const nonce = '1023456789abcdef1023456789abcdef'
const attribution = { source: 'hackerlinks', medium: 'header', campaign: 'mvp' }
const oauthState = (provider = 'google', target = '/bookmarks?view=unread') => JSON.stringify({ nonce, target, affCode: 'test-referral', platform: provider, auth_attribution: attribution })
const binding = (state: string) => `__Host-reader-oauth-${nonce}=${createHash('sha256').update(state).digest('hex')}`
const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const token = (claims: unknown) => `${segment({ alg: 'HS256' })}.${segment(claims)}.c2lnbmF0dXJl`
const issued = token({ id: 'account', exp: 4_000_000_000 })
const upstream = vi.fn<typeof fetch>()

async function request(options: { origin?: string | null; media?: string; body?: string; state?: string; cookie?: string; signal?: AbortSignal } = {}) {
  const app = createApp()
  app.use(sessionRoute)
  const state = options.state ?? oauthState()
  const headers: Record<string, string> = {
    'content-type': options.media ?? 'application/json; charset=utf-8',
    cookie: options.cookie ?? `${binding(state)}; token=existing-account`,
    authorization: 'Bearer existing-account',
    'x-client-locale': 'zh'
  }
  if (options.origin !== null) headers.origin = options.origin ?? origin
  const response = await toPlainHandler(app)({
    path: '/api/auth/session',
    method: 'POST',
    headers,
    body: options.body ?? JSON.stringify({ action: 'login', code: 'provider-code', state }),
    context: { cloudflare: { request: { signal: options.signal } } }
  })
  const values = (name: string) => response.headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value)
  return {
    status: response.status,
    headers: {
      get: (name: string) => values(name)[0],
      has: (name: string) => values(name).length > 0,
      getSetCookie: () => values('set-cookie')
    },
    json: () => JSON.parse(String(response.body)),
    text: () => String(response.body)
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', upstream)
  upstream.mockReset().mockResolvedValue(Response.json({ code: 200, data: { token: issued } }))
})
afterEach(() => vi.unstubAllGlobals())

describe('Nitro session endpoint', () => {
  it.each([null, 'null', 'https://other.test', 'https://reader.test:8443'])('rejects Origin %s before exchange', async value => {
    const response = await request({ origin: value })
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.has('set-cookie')).toBe(false)
    expect(upstream).not.toHaveBeenCalled()
  })

  it.each([
    { media: 'text/plain', body: '{}', status: 415 },
    { media: 'application/json', body: '{', status: 400 },
    { media: 'application/json', body: '{"action":"login","token":"arbitrary-token"}', status: 400 },
    { media: 'application/json', body: '{"action":"refresh"}', status: 400 }
  ])('rejects unsupported input with $status', async ({ status, ...input }) => {
    const response = await request(input)
    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.has('set-cookie')).toBe(false)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('rejects a callback from a different attempt before contacting the provider', async () => {
    const response = await request({ cookie: binding(oauthState('apple')) })
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.has('set-cookie')).toBe(false)
    expect(upstream).not.toHaveBeenCalled()
  })

  it.each(['google', 'apple'])('issues the shared cookie and preserves %s referral and attribution', async provider => {
    const response = await request({ state: oauthState(provider) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const session = response.headers.getSetCookie().find(value => value.startsWith(`token=${issued};`))
    expect(session).toContain('Domain=reader.test')
    expect(session).toContain('Path=/')
    expect(session).toContain('Secure')
    expect(session).not.toContain('HttpOnly')
    expect(await response.json()).toEqual({ target: '/bookmarks?view=unread' })
    const [url, init] = upstream.mock.calls[0]!
    expect(url).toBe('https://api.test/prefix/v1/user/login')
    expect(init?.redirect).toBe('manual')
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
    expect(new Headers(init?.headers).has('cookie')).toBe(false)
    expect(new Headers(init?.headers).get('x-client-locale')).toBe('zh')
    expect(JSON.parse(String(init?.body))).toEqual({
      code: 'provider-code',
      type: provider,
      client_id: `${provider}-test`,
      redirect_uri: 'https://callback.test/auth',
      aff_code: 'test-referral',
      auth_attribution: attribution
    })
  })

  it('rejects an external return destination', async () => {
    const response = await request({ state: oauthState('google', '//other.test/steal') })
    expect(await response.json()).toEqual({ target: '/bookmarks' })
  })

  it.each([
    'invalid',
    'ab..xyz',
    'abc.abc.a',
    issued.replace(/[^.]+$/, 'a'),
    token({ id: 'account' }),
    token({ id: 'account', exp: '4000000000' }),
    token({ id: 'account', exp: 1 })
  ])('rejects an unusable issued token without writing any cookie', async invalid => {
    upstream.mockResolvedValue(Response.json({ code: 200, data: { token: invalid } }))
    const response = await request()
    expect(response.status).toBe(502)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.has('set-cookie')).toBe(false)
    expect(await response.text()).not.toContain(invalid)
  })

  it('discards an upstream success received after the browser cancels', async () => {
    const controller = new AbortController()
    let complete!: (response: Response) => void
    upstream.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const pending = request({ signal: controller.signal })
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledOnce())
    controller.abort()
    complete(Response.json({ code: 200, data: { token: issued } }))
    const response = await pending
    expect(response.status).toBe(499)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.has('set-cookie')).toBe(false)
  })

  it('rejects a redirect without forwarding the code to a new origin', async () => {
    upstream.mockResolvedValue(Response.redirect('https://other.test', 307))
    const response = await request()
    expect(response.status).toBe(502)
    expect(response.headers.has('set-cookie')).toBe(false)
    expect(upstream).toHaveBeenCalledOnce()
  })
})
