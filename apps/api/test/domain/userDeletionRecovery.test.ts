import { describe, expect, test, vi } from 'vitest'
import { UserDeletionJob } from '@/handler/cron/userDeletionJob'

const harness = () => {
  const deleted_at = new Date('2026-09-18T00:00:00Z')
  const values = new Map<string, string>()
  const get = vi.fn(async (key: string) => values.get(key) ?? null)
  const put = vi.fn(async (key: string, value: string) => void values.set(key, value))
  const cleanupUserData = vi.fn().mockResolvedValue(undefined)
  const revokeUser = vi.fn().mockResolvedValue(undefined)
  const prisma = { sr_user: { findMany: vi.fn().mockResolvedValue([{ id: 1, deleted_at }]) } }
  const job = new UserDeletionJob(() => prisma as never, { cleanupUserData } as never)
  const ctx = { env: { KV: { get, put }, WEBSOCKET_SERVER: { idFromName: () => 'global', get: () => ({ revokeUser }) } } } as never
  return { job, ctx, prisma, values, cleanupUserData, revokeUser, deleted_at }
}

describe('deleted-account cleanup recovery', () => {
  test('reconstructs lost queue work from durable tombstones', async () => {
    const h = harness()
    await h.job.recoverDeletedUsers(h.ctx)
    expect(h.revokeUser).toHaveBeenCalledWith(1)
    expect(h.cleanupUserData).toHaveBeenCalledWith(1, (h.ctx as { env: unknown }).env)
    expect(h.values.get(`user-deletion-recovery:done:1:${h.deleted_at.getTime()}`)).toBe('1')
    await h.job.recoverDeletedUsers(h.ctx)
    expect(h.cleanupUserData).toHaveBeenCalledOnce()
  })

  test('retries failures on later scans without starving subsequent accounts', async () => {
    const h = harness()
    h.prisma.sr_user.findMany.mockResolvedValue([
      { id: 1, deleted_at: h.deleted_at },
      { id: 2, deleted_at: h.deleted_at }
    ])
    h.cleanupUserData.mockRejectedValueOnce(new Error('temporary database failure'))
    await h.job.recoverDeletedUsers(h.ctx)
    expect(h.cleanupUserData).toHaveBeenCalledWith(2, (h.ctx as { env: unknown }).env)
    expect(h.values.has(`user-deletion-recovery:done:1:${h.deleted_at.getTime()}`)).toBe(false)
    expect(h.values.get(`user-deletion-recovery:done:2:${h.deleted_at.getTime()}`)).toBe('1')
    await h.job.recoverDeletedUsers(h.ctx)
    expect(h.cleanupUserData).toHaveBeenCalledTimes(3)
    expect(h.values.get(`user-deletion-recovery:done:1:${h.deleted_at.getTime()}`)).toBe('1')
  })

  test.each(['missing-env', 'rejected'] as const)('vector cleanup %s aborts before any destructive delete', async failure => {
    const { UserDeletionService } = await import('@/domain/userDeletion')
    let deleted = false
    const deletes = vi.fn(async () => {
      deleted = true
      return { count: 1 }
    })
    const prisma = new Proxy(
      {
        sr_user_report: { findMany: vi.fn().mockResolvedValue([]) },
        sr_user_collection: { findMany: vi.fn().mockResolvedValue([{ id: 3 }]), deleteMany: deletes },
        $executeRaw: vi.fn().mockResolvedValue(1),
        $queryRaw: vi.fn().mockResolvedValue([])
      } as any,
      { get: (target, key) => target[key] ?? { deleteMany: deletes } }
    )
    const vectorRepo = {
      listUserBookmarkIds: vi.fn(async (_userId: number, after: number, limit: number) =>
        Array.from({ length: Math.min(limit, 51 - after) }, (_, index) => ({ id: after + index + 1, bookmark_id: after + index + 100 }))
      ),
      listOwnerCollections: vi.fn(async () => [{ id: 3 }]),
      listSubscriberUsers: vi.fn(async () => [{ id: 1, user_id: 200 }])
    }
    const createBatch = vi.fn().mockRejectedValue(new Error('vector admission unavailable'))
    const env = failure === 'missing-env' ? undefined : ({ VECTOR_V5_MAINTENANCE_WORKFLOW: { createBatch } } as any)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const service = new UserDeletionService(() => prisma, { deleteNewsletterBatch: vi.fn().mockResolvedValue([]) } as any, {} as any, vectorRepo as any)
      await expect(service.cleanupUserData(7, env)).rejects.toThrow(failure === 'missing-env' ? 'missing_vector_maintenance_workflow' : 'vector admission unavailable')
      expect(deleted).toBe(false)
      expect(vectorRepo.listUserBookmarkIds).toHaveBeenCalledExactlyOnceWith(7, 0, 50)
      expect(vectorRepo.listOwnerCollections).not.toHaveBeenCalled()
      expect(vectorRepo.listSubscriberUsers).not.toHaveBeenCalled()
      expect(createBatch).toHaveBeenCalledTimes(failure === 'missing-env' ? 0 : 1)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Error during data cleanup for user 7'), expect.anything())
    } finally {
      log.mockRestore()
    }
  })

  test('account cleanup retains own legacy key retirement without enumerating subscribers', async () => {
    const { UserDeletionService } = await import('@/domain/userDeletion')
    const deletes = vi.fn().mockResolvedValue({ count: 1 })
    const prisma = new Proxy(
      {
        sr_user_report: { findMany: vi.fn().mockResolvedValue([]) },
        sr_user_collection: { findMany: vi.fn().mockResolvedValue([{ id: 3 }]), deleteMany: deletes },
        $executeRaw: vi.fn().mockResolvedValue(1),
        $queryRaw: vi.fn().mockResolvedValue([])
      } as any,
      { get: (target, key) => target[key] ?? { deleteMany: deletes } }
    )
    const vectorRepo = {
      listUserBookmarkIds: vi.fn().mockResolvedValue([{ id: 1, bookmark_id: 99 }]),
      listOwnerCollections: vi.fn().mockResolvedValue([{ id: 3 }]),
      listSubscriberUsers: vi.fn().mockRejectedValue(new Error('subscriber_fanout_forbidden'))
    }
    const createBatch = vi.fn().mockResolvedValue([])
    const service = new UserDeletionService(() => prisma, { deleteNewsletterBatch: vi.fn().mockResolvedValue([]) } as any, {} as any, vectorRepo as any)
    await service.cleanupUserData(7, { VECTOR_V5_MAINTENANCE_WORKFLOW: { createBatch } } as any)
    expect(vectorRepo.listSubscriberUsers).not.toHaveBeenCalled()
    expect(createBatch.mock.calls.flatMap(([items]) => items.map((item: any) => item.params.target))).toEqual([
      { kind: 'article', userId: 7, id: 99 },
      { kind: 'collection', id: 3 },
      { kind: 'user', id: 7, preference: 'article' },
      { kind: 'user', id: 7, preference: 'collection' }
    ])
    expect(deletes).toHaveBeenCalled()
  })
})
