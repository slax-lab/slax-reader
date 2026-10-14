import { LocaleUnauthorizedError, readLocaleUserInfo } from '../src/entrypoints/background/localeApi'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('../src/utils/session', () => ({ getExtensionEventHeaders: async () => ({ 'X-CLIENT-LOCALE': 'en' }) }))
afterEach(() => vi.unstubAllGlobals())

it('reads the backend code envelope with the captured token and abort signal', async () => {
  // apps/api/src/utils/responseUtils.ts serializes { data, message, code }.
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 200, message: 'ok', data: { userId: 'opaque-id', email: 'a@test', lang: 'zh' } })))
  vi.stubGlobal('fetch', fetcher)
  const signal = new AbortController().signal
  expect((await readLocaleUserInfo('token-a', signal)).lang).toBe('zh')
  expect(fetcher.mock.calls[0]).toEqual([
    expect.stringContaining('/v1/user/me'),
    expect.objectContaining({ signal, headers: expect.objectContaining({ Authorization: 'Bearer token-a' }) })
  ])
})
it.each([
  [401, 401],
  [401, 200],
  [500, 500],
  [400, 200]
])('rejects error code %s with HTTP status %s even with plausible user data', async (code, status) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ code, message: 'bad', data: { userId: 'opaque-id', lang: 'zh' } }), { status }))
  )
  const result = readLocaleUserInfo('a', new AbortController().signal)
  if (code === 401) await expect(result).rejects.toBeInstanceOf(LocaleUnauthorizedError)
  else await expect(result).rejects.toThrow()
})
it.each([
  null,
  {},
  { status: 200, data: { userId: 'opaque-id', lang: 'zh' } },
  { code: 200 },
  { code: 200, data: null },
  { code: 200, data: { lang: 'zh' } },
  { code: 200, data: { userId: 'opaque-id' } }
])('rejects malformed envelopes and user payloads: %j', async body => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body)))
  )
  await expect(readLocaleUserInfo('a', new AbortController().signal)).rejects.toThrow()
})
