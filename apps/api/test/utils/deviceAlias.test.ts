import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { UserRepo } from '@/infra/repository/dbUser'
import { UserService } from '@/domain/user'
import { ContextManager } from '@/utils/context'
import { Hashid } from '@/utils/hashids'
import { SlaxAuth } from '@/utils/auth'

afterEach(() => vi.restoreAllMocks())

describe('bindUserDeviceAlias', () => {
  const upsert = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    upsert.mockClear()
  })

  test.each([true, false])('the real public login path binds the device after a successful account write (new=%s)', async isNew => {
    const pending: Promise<unknown>[] = []
    const ctx = new ContextManager(
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext,
      {
        HASH_IDS_SALT: 'alias-test',
        JWT_SECRET_TEXT: 'alias-unit-test-secret',
        JWT_ISSUER: 'test',
        JWT_EXPIRES: 600,
        JWT_ALGORITHMS: 'HS256'
      } as unknown as Env
    )
    vi.spyOn(SlaxAuth.prototype, 'login').mockResolvedValue({ sub: 'provider-id', email: 'test@example.test', picture: '', name: 'Test' } as never)
    const persisted = { id: 7, uuid: 'user-uuid', lang: 'en', email: 'test@example.test' }
    const repo = {
      signInWithProvider: vi.fn().mockResolvedValue({ user: persisted, isNew }),
      requireActiveUser: vi.fn().mockResolvedValue(undefined),
      bindUserDeviceAlias: vi.fn().mockResolvedValue(undefined)
    }
    const service = new UserService(
      repo as never,
      (() => ({ putRemoteIfKeyExists: vi.fn().mockResolvedValue(null) })) as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { trackEvent: vi.fn().mockResolvedValue(undefined) } as never,
      { track: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never
    )
    const response = await service.userLogin(
      ctx,
      new Request('https://api.test/v1/user/login', { method: 'POST', headers: { 'X-Device-ID': 'browser-1' }, body: JSON.stringify({ type: 'google', code: 'test-code' }) })
    )
    await Promise.all(pending)
    expect(response.is_new_user).toBe(isNew)
    expect(repo.bindUserDeviceAlias).toHaveBeenCalledWith('browser-1', 7, isNew ? 'signup' : 'login')
    expect(repo.signInWithProvider.mock.invocationCallOrder[0]).toBeLessThan(repo.bindUserDeviceAlias.mock.invocationCallOrder[0])
  })

  test('upserts a D1 binding and preserves the first bind source', async () => {
    const repo = new UserRepo((() => ({ user_device_alias: { upsert } })) as never, (() => undefined) as never)
    await repo.bindUserDeviceAlias('device-1', 7, 'signup')
    expect(upsert).toHaveBeenCalledWith({
      where: { device_id_user_id: { device_id: 'device-1', user_id: 7 } },
      create: { device_id: 'device-1', user_id: 7, bind_source: 'signup', bound_at: expect.any(Date) },
      update: {}
    })
  })

  test.each([
    { isNew: true, headers: { 'x-device-id': 'header-device' }, expected: 'header-device', source: 'signup' },
    { isNew: false, headers: { cookie: '_su=cookie-device' }, expected: 'cookie-device', source: 'login' },
    { isNew: false, headers: { 'x-device-id': 'header-device', cookie: '_su=cookie-device' }, expected: 'header-device', source: 'login' }
  ])('登录请求的身份同时用于 D1 关联与服务端事件: $source/$expected', async ({ isNew, headers, expected, source }) => {
    const send = vi.fn().mockResolvedValue(undefined)
    const pending: Promise<unknown>[] = []
    const env = {
      HASH_IDS_SALT: 'test-alias',
      SLAX_READER_STREAM_STREAM: { send },
      JWT_SECRET_TEXT: 'alias-unit-test-secret',
      JWT_ISSUER: 'test',
      JWT_EXPIRES: 600,
      JWT_ALGORITHMS: 'HS256'
    } as unknown as Env
    const ctx = new ContextManager({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext, env)
    vi.spyOn(SlaxAuth.prototype, 'login').mockResolvedValue({ sub: 'provider-id', email: 'test@example.test', picture: '', name: 'Test' } as never)
    const persisted = { id: 7, uuid: 'test-uuid', lang: 'en', email: 'test@example.test' }
    const repo = new UserRepo((() => ({ user_device_alias: { upsert } })) as never, (() => undefined) as never)
    vi.spyOn(repo, 'signInWithProvider').mockResolvedValue({ user: persisted, isNew } as never)
    vi.spyOn(repo, 'requireActiveUser').mockResolvedValue(undefined)
    const service = new UserService(
      repo as never,
      (() => ({ putRemoteIfKeyExists: vi.fn().mockResolvedValue(null) })) as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { trackEvent: vi.fn().mockResolvedValue(undefined) } as never,
      { track: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never
    )
    await service.userLogin(ctx, new Request('https://reader.test/v1/user/login', { method: 'POST', headers, body: JSON.stringify({ type: 'google', code: 'test-code' }) }))
    await Promise.all(pending)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ device_id: expected, user_id: 7, bind_source: source }) }))
    expect(send).toHaveBeenCalledWith([expect.objectContaining({ event_name: isNew ? 'user_created' : 'user_logged_in', user_id: 7, device_id: expected })])
  })
})
