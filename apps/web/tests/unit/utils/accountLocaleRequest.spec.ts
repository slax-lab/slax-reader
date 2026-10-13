import { AccountLocaleUnauthorizedError, createAccountLocaleRequest } from '~~/app/utils/accountLocaleRequest'

import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

const createApi = () => createAccountLocaleRequest({ baseUrl: 'https://api.test', headers: { 'X-CLIENT-LOCALE': 'en' } })
// apps/api/src/utils/responseUtils.ts serializes { data, message, code }.
const reply = (data: unknown, code = 200, status = 200) => new Response(JSON.stringify({ data, message: code === 200 ? 'ok' : 'bad', code }), { status })

it('reads the user from the backend code envelope', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply({ userId: 'opaque-id', email: 'a@test', lang: 'zh' }))
  )
  await expect(createApi().readUser('A')).resolves.toMatchObject({ userId: 'opaque-id', lang: 'zh' })
})
it('saves language using the backend setting response and captured token', async () => {
  const fetcher = vi.fn(async () => reply('ok'))
  vi.stubGlobal('fetch', fetcher)
  await expect(createApi().saveLanguage('A', 'zh')).resolves.toBeUndefined()
  expect(fetcher.mock.calls[0]).toEqual([
    'https://api.test/v1/user/setting',
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer A' }), body: JSON.stringify({ key: 'lang', value: 'zh' }) })
  ])
})
it('refreshes the token from the backend code envelope with the abort signal', async () => {
  const fetcher = vi.fn(async () => reply({ token: 'next-token' }))
  vi.stubGlobal('fetch', fetcher)
  const signal = new AbortController().signal
  await expect(createApi().refreshToken('A', signal)).resolves.toBe('next-token')
  expect(fetcher.mock.calls[0]).toEqual(['https://api.test/v1/user/refresh', expect.objectContaining({ signal, headers: expect.objectContaining({ Authorization: 'Bearer A' }) })])
})
it.each(['read', 'save', 'refresh'] as const)('rejects HTTP and envelope failures during %s', async operation => {
  const call = () => {
    const api = createApi()
    if (operation === 'read') return api.readUser('A')
    if (operation === 'save') return api.saveLanguage('A', 'zh')
    return api.refreshToken('A', new AbortController().signal)
  }
  // Even plausible data must never turn an error into a successful read/save/refresh.
  const data = { userId: 'opaque-id', email: 'a@test', lang: 'zh', token: 'bad-token' }
  for (const [code, status] of [
    [401, 401],
    [401, 200],
    [400, 200],
    [500, 500]
  ]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(data, code, status))
    )
    if (code === 401) await expect(call()).rejects.toBeInstanceOf(AccountLocaleUnauthorizedError)
    else await expect(call()).rejects.toThrow()
  }
})
it.each([null, {}, { data: 'ok' }, { status: 200, data: 'ok' }, { code: 200 }])('rejects malformed setting envelopes: %j', async body => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body)))
  )
  await expect(createApi().saveLanguage('A', 'zh')).rejects.toThrow()
})
it.each([null, {}])('rejects missing user identity and refreshed token: %j', async data => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply(data))
  )
  await expect(createApi().readUser('A')).rejects.toThrow()
  await expect(createApi().refreshToken('A', new AbortController().signal)).rejects.toThrow()
})

it.each([42, {}, [], '', '  '])('rejects malformed refreshed tokens: %j', async token => {
  vi.stubGlobal('fetch', vi.fn(async () => reply({ token })))
  await expect(createApi().refreshToken('A', new AbortController().signal)).rejects.toThrow('Invalid refreshed token')
})
