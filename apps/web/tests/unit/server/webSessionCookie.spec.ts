// @vitest-environment happy-dom
import oauthCallback from '../../../server/middleware/oauth-callback'
import * as h3 from 'h3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ public: {
  PUBLIC_BASE_URL: 'https://reader.example.test', AUTH_BASE_URL: 'https://callback.test/oauth',
  DWEB_API_BASE_URL: 'https://api.test/reader', COOKIE_DOMAIN: 'reader.example.test',
  COOKIE_TOKEN_NAME: 'token', GOOGLE_OAUTH_CLIENT_ID: 'google-client', APPLE_OAUTH_CLIENT_ID: 'apple-client'
} }))
vi.mock('#app/nuxt', async original => ({ ...(await original<Record<string, unknown>>()), useRuntimeConfig: () => config }))
const nonce = '7ecb55901f8749ad8239dddd94b55308'
const acquisition = { source: 'hackerlinks', medium: 'header', campaign: 'mvp' }
const target = '/c/Collection123?subscribe_after_login=1#article'
const state = JSON.stringify({ nonce, platform: 'apple', affCode: 'referral', target, clientLocale: 'zh', auth_attribution: acquisition })
const jwt = (id: string, suffix = 'fixture') => [
  Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
  Buffer.from(JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
  suffix
].join('.')
const nextToken = jwt('A')
const upstream = vi.fn<typeof fetch>()
const handler = h3.toPlainHandler(h3.createApp().use(oauthCallback).use(h3.eventHandler(() => 'fallback page')))
beforeEach(() => {
  upstream.mockReset().mockImplementation(async () => Response.json({ code: 200, message: 'ok', data: { token: nextToken } }))
  vi.stubGlobal('fetch', upstream)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const request = (path: string, headers: Record<string, string> = {}, signal?: AbortSignal) =>
  handler({
    path,
    method: 'GET',
    headers: { host: 'reader.example.test', 'x-forwarded-proto': 'https', ...headers },
    context: signal ? { cloudflare: { request: { signal } } } : undefined
  })
const responseHeaders = (response: Awaited<ReturnType<typeof request>>) => new Headers(response.headers as never)
const bindingFor = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const binding = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return '__Host-reader-oauth-' + JSON.parse(value).nonce + '=' + binding
}
const boundCallback = async (value = state, binding = bindingFor(value), signal?: AbortSignal) =>
  request('/auth?' + new URLSearchParams({ code: 'one-time-code', state: value }), { cookie: await binding }, signal)
it('sets the shared Cookie on the OAuth redirect and forwards the registered URI and Apple attribution', async () => {
  const response = await boundCallback()
  expect(response.status).toBe(302)
  expect(responseHeaders(response).get('location')).toBe(target)
  const cookies = responseHeaders(response).get('set-cookie')
  expect(cookies).toContain('token=' + nextToken)
  expect(cookies).toContain('Domain=reader.example.test')
  expect(cookies).toContain('token=; Max-Age=0; Path=/; Secure')
  expect(cookies).toContain('token=; Max-Age=0; Domain=example.test; Path=/; Secure')
  expect(responseHeaders(response).get('cache-control')).toBe('no-store')
  expect(String(upstream.mock.calls[0]?.[0])).toBe('https://api.test/reader/v1/user/login')
  expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get('x-client-locale')).toBe('zh')
  expect(JSON.parse(String(upstream.mock.calls[0]?.[1]?.body))).toMatchObject({
    code: 'one-time-code', redirect_uri: 'https://callback.test/oauth/auth', type: 'apple', client_id: 'apple-client', aff_code: 'referral', auth_attribution: acquisition
  })
})

it('expires an explicit current-host Cookie when login issues the canonical parent-domain Cookie', async () => {
  const canonical = config.public.COOKIE_DOMAIN
  config.public.COOKIE_DOMAIN = 'example.test'
  try {
    const response = await boundCallback()
    const cookies = responseHeaders(response).get('set-cookie')
    expect(cookies).toContain('token=; Max-Age=0; Domain=reader.example.test; Path=/; Secure')
    expect(cookies).toContain('token=' + nextToken + '; Domain=example.test;')
  } finally {
    config.public.COOKIE_DOMAIN = canonical
  }
})

const collection = { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' }
it.each([
  { platform: 'google', attribution: collection, expected: collection },
  { platform: 'google', attribution: acquisition, expected: acquisition },
  { platform: 'apple', attribution: collection, expected: undefined },
  { platform: 'google', attribution: { collection_id: [] }, expected: undefined }
])('forwards only valid $platform login attribution and preserves the return target', async ({ platform, attribution, expected }) => {
  const response = await boundCallback(JSON.stringify({ nonce, platform, target, auth_attribution: attribution }))
  expect(responseHeaders(response).get('location')).toBe(target)
  const payload = JSON.parse(String(upstream.mock.calls[0]?.[1]?.body))
  expect(payload).toMatchObject({ type: platform, client_id: platform + '-client' })
  expect(payload.auth_attribution).toEqual(expected)
})

it('falls back to bookmarks for a cross-origin return target', async () => {
  const response = await boundCallback(JSON.stringify({ nonce, target: 'https://unrelated.test/redirect' }))
  expect(responseHeaders(response).get('location')).toBe('/bookmarks')
})

it('rejects a tampered state and does not clear a newer attempt', async () => {
  const value = JSON.stringify({ ...JSON.parse(state), target: '/user' })
  const response = await boundCallback(value, bindingFor(state))
  expect(responseHeaders(response).get('location')).toBe('/auth?result=failed#')
  expect(responseHeaders(response).get('set-cookie')).toBeNull()
  expect(upstream).not.toHaveBeenCalled()
})

it('consumes the matched browser binding and leaves another attempt intact', async () => {
  const otherNonce = '9cffef7205d3470a903f7cfa0d94cd74'
  const otherState = JSON.stringify({ ...JSON.parse(state), nonce: otherNonce })
  const cookies = (await bindingFor(state)) + '; ' + (await bindingFor(otherState))
  const response = await boundCallback(state, Promise.resolve(cookies))
  const setCookie = responseHeaders(response).get('set-cookie')
  expect(setCookie).toContain('__Host-reader-oauth-' + nonce + '=;')
  expect(setCookie).not.toContain(otherNonce)
})

it('redirects a cancelled callback to login', async () => {
  const response = await request('/auth?error=access_denied')
  expect(responseHeaders(response).get('location')).toBe('/login')
  expect(upstream).not.toHaveBeenCalled()
})

it('refuses to exchange a code without a browser-bound state', async () => {
  const response = await request('/auth?' + new URLSearchParams({ code: 'unbound', state }))
  expect(responseHeaders(response).get('location')).toBe('/auth?result=failed#')
  expect(responseHeaders(response).get('set-cookie')).toBeNull()
  expect(upstream).not.toHaveBeenCalled()
})

it('offers a fresh provider retry after a failed exchange without forwarding the old code to the page', async () => {
  upstream.mockResolvedValueOnce(Response.json({ code: 400, data: null }))
  const response = await boundCallback()
  const location = responseHeaders(response).get('location')!
  expect(location).toMatch(/^\/auth\?result=failed#/)
  expect(location).not.toContain('one-time-code')
  expect(decodeURIComponent(location)).toContain('"platform":"apple"')
  expect(decodeURIComponent(location)).toContain(target)
  expect(responseHeaders(response).get('set-cookie')).not.toContain('token=')
})

it('bounds login at 20 seconds and never sets the session Cookie from a late upstream success', async () => {
  const binding = await bindingFor(state)
  vi.useFakeTimers()
  let complete!: (response: Response) => void
  upstream.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const responsePromise = boundCallback(state, Promise.resolve(binding))
  await vi.waitFor(() => expect(upstream).toHaveBeenCalled())
  await vi.advanceTimersByTimeAsync(20_000)
  const response = await responsePromise
  complete(Response.json({ code: 200, data: { token: nextToken } }))
  expect(responseHeaders(response).get('location')).toMatch(/^\/auth\?result=timeout#/)
  expect(responseHeaders(response).get('set-cookie')).not.toContain('token=')
  expect(upstream.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
})

it('cancels the exchange when the incoming callback is abandoned', async () => {
  const controller = new AbortController()
  const complete = Promise.withResolvers<Response>()
  upstream.mockReturnValueOnce(complete.promise)
  const responsePromise = boundCallback(state, bindingFor(state), controller.signal)
  await vi.waitFor(() => expect(upstream).toHaveBeenCalled())
  controller.abort()
  const canceledUpstream = upstream.mock.calls[0]?.[1]?.signal?.aborted
  complete.resolve(Response.json({ code: 200, data: { token: nextToken } }))
  const response = await responsePromise
  expect(canceledUpstream).toBe(true)
  expect(response.status).toBe(499)
  expect(responseHeaders(response).get('location')).toBeNull()
  expect(responseHeaders(response).get('set-cookie')).not.toContain('token=')
})

it('passes the Android handoff to the page without contacting the API', async () => {
  const response = await request('/auth?platform=android&code=fixture')
  expect(response.body).toBe('fallback page')
  expect(upstream).not.toHaveBeenCalled()
})

it('offers recovery when the API returns a malformed token', async () => {
  const invalid = 'malformed!.' + nextToken.split('.')[1] + '.signature'
  upstream.mockResolvedValueOnce(Response.json({ code: 200, data: { token: invalid } }))
  const response = await boundCallback()
  expect(responseHeaders(response).get('location')).toMatch(/^\/auth\?result=failed#/)
  expect(responseHeaders(response).get('set-cookie')).not.toContain('token=')
})

it('rejects an upstream redirect without forwarding the authorization code again', async () => {
  upstream.mockResolvedValueOnce(Response.redirect('https://unrelated.test/login', 307))
  const response = await boundCallback()
  expect(responseHeaders(response).get('location')).toMatch(/^\/auth\?result=failed#/)
  expect(responseHeaders(response).get('set-cookie')).not.toContain('token=')
  expect(upstream).toHaveBeenCalledOnce()
  expect(upstream.mock.calls[0]?.[1]?.redirect).toBe('manual')
})
