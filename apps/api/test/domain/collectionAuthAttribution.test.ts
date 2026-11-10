import { afterEach, describe, expect, test, vi } from 'vitest'
import { UserService } from '@/domain/user'
import { ContextManager } from '@/utils/context'
import { SlaxAuth } from '@/utils/auth'

const attribution = {
  collection_id: 'Collection123',
  source_screen: 'collection',
  presentation: 'modal',
  trigger_element_id: 'collection_subscribe_button'
}

const acquisition = {
  source: 'hackerlinks',
  medium: 'header',
  campaign: 'mvp'
} as const

function fixture(isNew = false) {
  const pending: Promise<unknown>[] = []
  const send = vi.fn().mockResolvedValue(undefined)
  const ctx = new ContextManager(
    { waitUntil: (p: Promise<unknown>) => pending.push(p) } as ExecutionContext,
    {
      HASH_IDS_SALT: 'collection-attribution-test',
      JWT_SECRET_TEXT: 'unit-test-only',
      JWT_ISSUER: 'test',
      JWT_EXPIRES: 600,
      JWT_ALGORITHMS: 'HS256',
      SLAX_READER_STREAM_STREAM: { send }
    } as unknown as Env
  )
  const provider = vi.spyOn(SlaxAuth.prototype, 'login').mockResolvedValue({ sub: 'provider-id', email: 'fixture@example.test', picture: '', name: 'Fixture' } as never)
  const persisted = { id: 7, uuid: 'fixture-user', lang: 'en', email: 'fixture@example.test' }
  const bindAlias = vi.fn().mockResolvedValue(undefined)
  const service = new UserService(
    {
      requireActiveUser: vi.fn().mockResolvedValue(undefined),
      bindUserDeviceAlias: bindAlias
    } as never,
    (() => ({ putRemoteIfKeyExists: vi.fn().mockResolvedValue(null) })) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { trackEvent: vi.fn().mockResolvedValue(undefined) } as never,
    { track: vi.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {} as never,
    { signInWithProvider: vi.fn().mockResolvedValue({ user: persisted, isNew }) } as never,
    {} as never
  )
  const login = (metadata: unknown, type = 'google') =>
    service.userLogin(
      ctx,
      new Request('https://fixture.test/v1/user/login', {
        method: 'POST',
        headers: { 'X-Device-ID': 'browser-1' },
        body: JSON.stringify({ type, code: 'fixture-code', auth_attribution: metadata })
      })
    )
  return { login, send, provider, bindAlias, settled: () => Promise.all(pending) }
}

afterEach(() => vi.restoreAllMocks())

describe('collection authentication attribution', () => {
  test.each([true, false])('attributes only the server-confirmed account fact (new=%s)', async isNew => {
    const f = fixture(isNew)
    const result = await f.login({ ...attribution, user_id: 999, device_id: 'forged', method: 'apple', token: 'discard' })
    await f.settled()
    expect(result.token).toBeTruthy()
    expect(result).not.toHaveProperty('auth_attribution')
    expect(f.send).toHaveBeenCalledTimes(1)
    expect(f.send).toHaveBeenCalledWith([
      expect.objectContaining({
        event_name: isNew ? 'user_created' : 'user_logged_in',
        user_id: 7,
        device_id: 'browser-1',
        properties: { ...attribution, method: 'google', platform: 'web', locale: 'en', client_version: 'unknown' }
      })
    ])
    expect(f.bindAlias).toHaveBeenCalledWith('browser-1', 7, isNew ? 'signup' : 'login')
  })

  test.each([
    undefined,
    null,
    'wrong-type',
    [],
    {},
    { ...attribution, collection_id: 'bad/code' },
    { ...attribution, collection_id: 'a'.repeat(65) },
    { ...attribution, collection_id: '' },
    { ...attribution, source_screen: 'bookmark' },
    { ...attribution, presentation: 'screen' },
    { ...attribution, trigger_element_id: 'other' }
  ])('omits invalid optional metadata without failing authentication: %j', async metadata => {
    const f = fixture()
    await expect(f.login(metadata)).resolves.toMatchObject({ is_new_user: false })
    await f.settled()
    expect(f.send).toHaveBeenCalledWith([
      expect.objectContaining({
        properties: {
          method: 'google',
          platform: 'web',
          locale: 'en',
          client_version: 'unknown'
        }
      })
    ])
  })

  test('does not attribute an Apple login to the Google collection funnel', async () => {
    const f = fixture()
    await f.login(attribution, 'apple')
    await f.settled()
    expect(f.send.mock.calls[0]![0][0].properties).toEqual({ method: 'apple', platform: 'web', locale: 'en', client_version: 'unknown' })
  })

  test('emits no success when authentication fails', async () => {
    const f = fixture()
    f.provider.mockRejectedValue(new Error('authorization rejected'))
    await expect(f.login(attribution)).rejects.toThrow('authorization rejected')
    expect(f.send).not.toHaveBeenCalled()
    expect(f.bindAlias).not.toHaveBeenCalled()
  })

  test('preserves login success when the analytics stream fails', async () => {
    const f = fixture()
    f.send.mockRejectedValue(new Error('stream unavailable'))
    await expect(f.login(attribution)).resolves.toMatchObject({ is_new_user: false })
    await expect(f.settled()).resolves.toBeDefined()
  })
})

describe('acquisition authentication attribution', () => {
  test.each([
    { type: 'google', isNew: true, medium: 'header' },
    { type: 'apple', isNew: true, medium: 'resource_detail' },
    { type: 'google', isNew: false, medium: 'header' },
    { type: 'apple', isNew: false, medium: 'resource_detail' }
  ] as const)('attributes only new-account facts ($type, new=$isNew)', async ({ type, isNew, medium }) => {
    const f = fixture(isNew)
    const result = await f.login({ ...acquisition, medium, user_id: 999, device_id: 'forged', method: 'other', token: 'discard', utm_content: 'discard' }, type)
    await f.settled()
    expect(result).toMatchObject({ is_new_user: isNew, login_type: type })
    expect(result).not.toHaveProperty('auth_attribution')
    expect(f.send).toHaveBeenCalledTimes(1)
    expect(f.send).toHaveBeenCalledWith([
      expect.objectContaining({
        event_name: isNew ? 'user_created' : 'user_logged_in',
        user_id: 7,
        device_id: 'browser-1',
        properties: {
          ...(isNew ? { ...acquisition, medium } : {}),
          method: type,
          platform: 'web',
          locale: 'en',
          client_version: 'unknown'
        }
      })
    ])
    expect(f.bindAlias).toHaveBeenCalledWith('browser-1', 7, isNew ? 'signup' : 'login')
  })

  test.each([
    undefined,
    null,
    'wrong-type',
    [],
    {},
    { source: 'hackerlinks', campaign: 'mvp' },
    { ...acquisition, source: ['hackerlinks'] },
    { ...acquisition, source: 'other' },
    { ...acquisition, medium: 'other' },
    { ...acquisition, campaign: 'other' }
  ])('omits invalid acquisition without failing registration: %j', async metadata => {
    const f = fixture(true)
    await expect(f.login(metadata)).resolves.toMatchObject({ is_new_user: true })
    await f.settled()
    expect(f.send).toHaveBeenCalledWith([
      expect.objectContaining({
        event_name: 'user_created',
        properties: { method: 'google', platform: 'web', locale: 'en', client_version: 'unknown' }
      })
    ])
  })

  test('emits no acquisition success when Apple authentication fails', async () => {
    const f = fixture(true)
    f.provider.mockRejectedValue(new Error('authorization rejected'))
    await expect(f.login(acquisition, 'apple')).rejects.toThrow('authorization rejected')
    expect(f.send).not.toHaveBeenCalled()
    expect(f.bindAlias).not.toHaveBeenCalled()
  })

  test('preserves new-account success when acquisition delivery fails', async () => {
    const f = fixture(true)
    f.send.mockRejectedValue(new Error('stream unavailable'))
    await expect(f.login(acquisition)).resolves.toMatchObject({ is_new_user: true })
    await expect(f.settled()).resolves.toBeDefined()
  })
})
