import { describe, expect, test, vi } from 'vitest'
import { UserDeletionConsumer } from '@/handler/queue/userDeletionConsumer'
import { handleMessage } from '@/di/generated/consumer'

vi.mock('@/handler/queue/bookmarkConsumer', () => ({ BookmarkConsumer: class {} }))
vi.mock('@/handler/queue/subscriptionConsumer', () => ({ SubscriptionConsumer: class {} }))

describe('best-effort account cleanup', () => {
  test.each(['slax-reader-user-deletion', 'slax-reader-user-deletion-beta'])('%s consumes cleanup failure and continues the batch', async queue => {
    const failure = new Error('cleanup failed after dispatch')
    const cleanupUserData = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    const consumer = new UserDeletionConsumer({ cleanupUserData } as never)
    const messages = [1, 2].map(userId => ({ id: `delete-${userId}`, body: { userId }, ack: vi.fn(), retry: vi.fn() }))
    const env = {} as Env
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await handleMessage({ resolve: () => consumer } as never, { queue, messages } as never, env, {} as ExecutionContext)
      expect(cleanupUserData.mock.calls).toEqual([
        [1, env],
        [2, env]
      ])
      for (const message of messages) {
        expect(message.ack).toHaveBeenCalledOnce()
        expect(message.retry).not.toHaveBeenCalled()
      }
      expect(log).toHaveBeenCalledWith('User deletion failed for userId: 1', failure)
    } finally {
      log.mockRestore()
    }
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
      const service = new UserDeletionService(
        () => prisma,
        { deleteNewsletterBatch: vi.fn().mockResolvedValue([]) } as any,
        {} as any,
        vectorRepo as any,
        { deleteByUserId: async () => {} } as any
      )
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
    const service = new UserDeletionService(
      () => prisma,
      { deleteNewsletterBatch: vi.fn().mockResolvedValue([]) } as any,
      {} as any,
      vectorRepo as any,
      { deleteByUserId: async () => {} } as any
    )
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
