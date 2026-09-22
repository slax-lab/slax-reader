import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Container } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import { requireActiveUser } from '@/utils/activeUser'
import { ApiKeyAuth } from '@/utils/apiKeyAuth'
import { UserRepo } from '@/infra/repository/dbUser'
import { auth, authToken } from '@/middleware/auth'
import { Auth } from '@/utils/jwt'
import { ContextManager } from '@/utils/context'
import { Hashid } from '@/utils/hashids'
import { EDGE_IDENTITY_HEADER, EDGE_SECRET_HEADER, encodeEdgeIdentity } from '@/const/edge'

const env = { HASH_IDS_SALT: 'salt', JWT_SECRET_TEXT: 'test-secret', JWT_ISSUER: 'test', JWT_ALGORITHMS: 'HS256', JWT_EXPIRES: '3600', EDGE_SHARED_SECRET: 'shared' } as Env
const query = vi.fn()
const pg = { $queryRaw: query, $transaction: vi.fn((fn: any) => fn({ $queryRaw: query })) }
let scope: Container
beforeEach(() => {
  vi.restoreAllMocks()
  query.mockReset().mockResolvedValue([{ id: 42 }])
  pg.$transaction.mockClear()
  scope = new Container()
  scope.registerInstance(PRISIMA_HYPERDRIVE_CLIENT, pg)
})

describe('fresh account gate', () => {
  test('reads directly every time with a non-cacheable timestamp', async () => {
    await expect(requireActiveUser(scope, 42)).resolves.toBeUndefined()
    query.mockResolvedValue([])
    await expect(requireActiveUser(scope, 42)).rejects.toMatchObject({ errCode: 401 })
    expect(pg.$transaction).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0][0].join('')).toContain('CURRENT_TIMESTAMP')
    expect(query.mock.calls[0][0].join('')).toContain('deleted_at IS NULL')
    expect(query.mock.calls[0][1]).toBe(42)
  })
  test.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid user id %s before querying', async userId => {
    await expect(requireActiveUser(scope, userId)).rejects.toMatchObject({ errCode: 401 })
    expect(query).not.toHaveBeenCalled()
    expect(pg.$transaction).not.toHaveBeenCalled()
  })
  test('missing user and unavailable DB fail closed', async () => {
    query.mockResolvedValue([])
    await expect(requireActiveUser(scope, 42)).rejects.toMatchObject({ errCode: 401 })
    query.mockRejectedValue(new Error('db unavailable'))
    await expect(requireActiveUser(scope, 42)).rejects.toThrow('db unavailable')
    await expect(requireActiveUser(new Container(), 42)).rejects.toThrow('No provider')
  })
  test('API keys require an active joined user in a fresh query', async () => {
    query.mockResolvedValue([])
    await expect(new ApiKeyAuth(scope).verify('key')).rejects.toBeDefined()
    const sql = query.mock.calls[0][0].join('')
    expect(sql).toContain('INNER JOIN sr_user u')
    expect(sql).toContain('u.deleted_at IS NULL')
    expect(sql).toContain('CURRENT_TIMESTAMP')
  })
})

describe('Core JWT and trusted edge identity gates', () => {
  test.each(['jwt', 'edge'])('%s rejects deleted and clears the context before business can use it', async mode => {
    const ctx = new ContextManager({} as ExecutionContext, env)
    const enId = new Hashid(env).encodeId(42)
    vi.spyOn(Auth.prototype, 'verify').mockResolvedValue({ id: String(enId), email: 'test@example.com', lang: 'en' })
    query.mockResolvedValue([])
    const headers =
      mode === 'jwt'
        ? { Authorization: 'Bearer token' }
        : {
            [EDGE_SECRET_HEADER]: 'shared',
            [EDGE_IDENTITY_HEADER]: encodeEdgeIdentity({ deId: 42, enId, email: 'test@example.com', lang: 'en', audience: 'reader' })
          }
    await expect(auth(new Request('https://api-reader.slax.com/v1/user/me', { headers }), ctx, scope)).rejects.toBeDefined()
    expect(ctx.getUserId()).toBe(0)
  })
  test('crypto-only authToken does not acquire infrastructure', async () => {
    const ctx = new ContextManager({} as ExecutionContext, env)
    vi.spyOn(Auth.prototype, 'verify').mockResolvedValue({ id: String(new Hashid(env).encodeId(42)), email: 'test@example.com', lang: 'en' })
    await authToken(ctx, 'token')
    expect(ctx.getUserId()).toBe(42)
    expect(pg.$transaction).not.toHaveBeenCalled()
  })
})

describe('atomic account deletion and login race', () => {
  function repo(tx: any) {
    return new UserRepo(
      () => ({}) as any,
      () => ({ $transaction: (fn: any) => fn(tx) }) as any
    )
  }
  test('locks the identity, tombstones and deletes keys in one transaction', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: 42, deleted_at: null }]), sr_user: { update: vi.fn() }, sr_user_api_key: { deleteMany: vi.fn() } }
    await repo(tx).markUserAsDeleted(42)
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE')
    expect(tx.sr_user.update).toHaveBeenCalledOnce()
    expect(tx.sr_user_api_key.deleteMany).toHaveBeenCalledWith({ where: { user_id: 42 } })
  })
  test('propagates failed key revocation rather than reporting successful deletion', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 42, deleted_at: null }]),
      sr_user: { update: vi.fn() },
      sr_user_api_key: { deleteMany: vi.fn().mockRejectedValue(new Error('write failed')) }
    }
    await expect(repo(tx).markUserAsDeleted(42)).rejects.toThrow('write failed')
  })
  test('register locks before deciding and never clears a recent tombstone', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: 42, deleted_at: new Date() }]), sr_user: { update: vi.fn(), create: vi.fn() } }
    await expect(repo(tx).registerUser({ email: 'a@example.com', deleted_at: null } as any)).rejects.toBeDefined()
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE')
    expect(tx.sr_user.update).not.toHaveBeenCalled()
    expect(tx.sr_user.create).not.toHaveBeenCalled()
  })
  test('keeps a matched provider identity when its verified email changes', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 42, email: 'old@example.com', deleted_at: null }]),
      sr_user: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({ id: 42, email: 'new@example.com' }), create: vi.fn() }
    }
    await expect(repo(tx).registerUser({ id: 42, email: 'new@example.com' } as any)).resolves.toMatchObject({ id: 42 })
    expect(tx.sr_user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 } }))
    expect(tx.sr_user.create).not.toHaveBeenCalled()
  })
  test('does not merge a matched provider identity into a different email owner', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 42, deleted_at: null }]),
      sr_user: { findFirst: vi.fn().mockResolvedValue({ id: 99 }), update: vi.fn(), create: vi.fn() }
    }
    await expect(repo(tx).registerUser({ id: 42, email: 'other@example.com' } as any)).rejects.toBeDefined()
    expect(tx.sr_user.update).not.toHaveBeenCalled()
    expect(tx.sr_user.create).not.toHaveBeenCalled()
  })
  test('after 30 days recreates a different identity instead of reviving the old id', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 42, deleted_at: new Date(Date.now() - 31 * 86400000) }]),
      sr_user: { delete: vi.fn(), update: vi.fn(), create: vi.fn().mockResolvedValue({ id: 99 }) }
    }
    await expect(repo(tx).registerUser({ email: 'a@example.com', deleted_at: null } as any)).resolves.toEqual({ id: 99 })
    expect(tx.sr_user.delete).not.toHaveBeenCalled()
    expect(tx.sr_user.update).toHaveBeenCalledWith({ where: { id: 42 }, data: { email: expect.stringMatching(/@deleted\.invalid$/) } })
    expect(tx.sr_user.create.mock.calls[0][0].data).not.toHaveProperty('id')
    expect(tx.sr_user.create.mock.calls[0][0].data).not.toHaveProperty('uuid')
    expect(tx.sr_user.create.mock.calls[0][0].data).not.toHaveProperty('deleted_at')
  })
})
