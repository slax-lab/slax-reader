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

const snapshotSource = '00000000-0000-4000-8000-000000000001'

const snapshot = {
  source_screen: 'detail',
  presentation: 'modal',
  trigger_element_id: 'snapshot_save_button',
  source_bookmark_id: snapshotSource
} as const

function fixture(isNew = false) {
  const pending: Promise<unknown>[] = []
  const send = vi.fn().mockResolvedValue(undefined)
  const createBatch = vi.fn().mockResolvedValue([])
  const ctx = new ContextManager(
    { waitUntil: (p: Promise<unknown>) => pending.push(p) } as ExecutionContext,
    {
      HASH_IDS_SALT: 'collection-attribution-test',
      JWT_SECRET_TEXT: 'unit-test-only',
      JWT_ISSUER: 'test',
      JWT_EXPIRES: 600,
      JWT_ALGORITHMS: 'HS256',
      SLAX_READER_STREAM_STREAM: { send },
      VECTOR_V5_MAINTENANCE_WORKFLOW: { createBatch }
    } as unknown as Env
  )
  const provider = vi.spyOn(SlaxAuth.prototype, 'login').mockResolvedValue({ sub: 'provider-id', email: 'fixture@example.test', picture: '', name: 'Fixture' } as never)
  const persisted = { id: 7, uuid: 'fixture-user', lang: 'en', email: 'fixture@example.test', name: 'Fixture' }
  const bindAlias = vi.fn().mockResolvedValue(undefined)
  const verifyCode = vi.fn().mockResolvedValue({ key: 'email-key', delivery: 'fixture@example.test' })
  const signInWithEmail = vi.fn().mockResolvedValue({ user: persisted, isNew })
  const collectionRepo = { ensureUserShareCollectWithCreation: vi.fn().mockResolvedValue({ collection: { id: 3 }, created: false }) }
  const service = new UserService(
    {
      requireActiveUser: vi.fn().mockResolvedValue(undefined),
      getInfoByUserId: vi.fn().mockResolvedValue(persisted),
      bindUserDeviceAlias: bindAlias
    } as never,
    (() => ({ putRemoteIfKeyExists: vi.fn().mockResolvedValue(null) })) as never,
    {} as never,
    {} as never,
    collectionRepo as never,
    {} as never,
    {} as never,
    { trackEvent: vi.fn().mockResolvedValue(undefined) } as never,
    { track: vi.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    { verifyCode } as never,
    { signInWithProvider: vi.fn().mockResolvedValue({ user: persisted, isNew }), signInWithEmail } as never,
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
  const loginEmail = (metadata: unknown) =>
    service.userLogin(
      ctx,
      new Request('https://fixture.test/v1/user/login', {
        method: 'POST',
        headers: { 'X-Device-ID': 'browser-1' },
        body: JSON.stringify({ type: 'email', email: 'fixture@example.test', request_id: 'request-1', code: '012345', auth_attribution: metadata })
      })
    )
  return { login, loginEmail, send, createBatch, provider, bindAlias, collectionRepo, verifyCode, signInWithEmail, settled: () => Promise.all(pending) }
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

describe('collection provisioning during authentication', () => {
  test('provisions and indexes the default collection after the active account is confirmed', async () => {
    const f = fixture(true)
    f.collectionRepo.ensureUserShareCollectWithCreation.mockResolvedValue({ collection: { id: 3 }, created: true })

    await expect(f.login(undefined)).resolves.toMatchObject({ is_new_user: true })
    await f.settled()

    expect(f.collectionRepo.ensureUserShareCollectWithCreation).toHaveBeenCalledWith(7, "Fixture's Reading Recommendations")
    expect(f.createBatch).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ params: { eventId: expect.any(String), target: { kind: 'collection', id: 3 } } })
    ])
  })

  test('does not dispatch indexing for an existing collection', async () => {
    const f = fixture()
    await f.login(undefined)
    await f.settled()
    expect(f.createBatch).not.toHaveBeenCalled()
  })

  test('preserves login success when collection provisioning fails', async () => {
    const f = fixture()
    f.collectionRepo.ensureUserShareCollectWithCreation.mockRejectedValue(new Error('collection unavailable'))
    await expect(f.login(undefined)).resolves.toMatchObject({ is_new_user: false, token: expect.any(String) })
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

describe('snapshot save authentication attribution', () => {
  test.each([
    { type: 'google', isNew: true },
    { type: 'google', isNew: false },
    { type: 'apple', isNew: true },
    { type: 'apple', isNew: false }
  ] as const)('attributes the server-confirmed $type account fact (new=$isNew)', async ({ type, isNew }) => {
    const f = fixture(isNew)
    const result = await f.login({ ...snapshot, user_id: 999, device_id: 'forged', method: 'other', token: 'discard' }, type)
    await f.settled()
    expect(result).toMatchObject({ is_new_user: isNew, login_type: type })
    expect(result).not.toHaveProperty('auth_attribution')
    expect(f.send).toHaveBeenCalledTimes(1)
    expect(f.send).toHaveBeenCalledWith([
      expect.objectContaining({
        event_name: isNew ? 'user_created' : 'user_logged_in',
        user_id: 7,
        device_id: 'browser-1',
        properties: { ...snapshot, method: type, platform: 'web', locale: 'en', client_version: 'unknown' }
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
    { ...snapshot, source_screen: 'collection' },
    { ...snapshot, presentation: 'screen' },
    { ...snapshot, trigger_element_id: 'collection_subscribe_button' },
    { ...snapshot, source_bookmark_id: '' },
    { ...snapshot, source_bookmark_id: 'source-bookmark' },
    { ...snapshot, source_bookmark_id: 'bad/source' },
    { ...snapshot, source_bookmark_id: '00000000-0000-4000-8000-00000000000' },
    { ...snapshot, source_bookmark_id: '00000000-0000-4000-8000-00000000000z' }
  ])('omits invalid snapshot metadata without failing authentication: %j', async metadata => {
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

  test('omits a malformed snapshot attribution from Apple without failing authentication', async () => {
    const f = fixture()
    await expect(f.login({ ...snapshot, source_bookmark_id: 'source-bookmark' }, 'apple')).resolves.toMatchObject({ is_new_user: false })
    await f.settled()
    expect(f.send).toHaveBeenCalledWith([
      expect.objectContaining({
        properties: { method: 'apple', platform: 'web', locale: 'en', client_version: 'unknown' }
      })
    ])
  })

  test('emits no snapshot success when Apple authentication fails', async () => {
    const f = fixture(true)
    f.provider.mockRejectedValue(new Error('authorization rejected'))
    await expect(f.login(snapshot, 'apple')).rejects.toThrow('authorization rejected')
    expect(f.send).not.toHaveBeenCalled()
    expect(f.bindAlias).not.toHaveBeenCalled()
  })

  test.each([true, false])('carries snapshot attribution through the email code path (new=%s)', async isNew => {
    const f = fixture(isNew)
    const result = await f.loginEmail(snapshot)
    await f.settled()
    expect(result).toMatchObject({ is_new_user: isNew, login_type: 'email' })
    expect(f.verifyCode).toHaveBeenCalledOnce()
    expect(f.signInWithEmail).toHaveBeenCalledOnce()
    expect(f.send).toHaveBeenCalledTimes(1)
    expect(f.send).toHaveBeenCalledWith([
      expect.objectContaining({
        event_name: isNew ? 'user_created' : 'user_logged_in',
        user_id: 7,
        device_id: 'browser-1',
        properties: { ...snapshot, method: 'email', platform: 'web', locale: 'en', client_version: 'unknown' }
      })
    ])
  })

  test.each([true, false])('preserves existing email collection and HackerLinks attribution behavior (new=%s)', async isNew => {
    for (const metadata of [attribution, acquisition]) {
      const f = fixture(isNew)
      await expect(f.loginEmail(metadata)).resolves.toMatchObject({ is_new_user: isNew, login_type: 'email' })
      await f.settled()
      const preserved = metadata === attribution || isNew
      expect(f.send).toHaveBeenCalledWith([
        expect.objectContaining({
          event_name: isNew ? 'user_created' : 'user_logged_in',
          properties: { ...(preserved ? metadata : {}), method: 'email', platform: 'web', locale: 'en', client_version: 'unknown' }
        })
      ])
    }
  })
})
