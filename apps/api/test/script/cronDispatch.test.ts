import { describe, expect, test, vi } from 'vitest'
vi.mock('@/handler/cron/bookmarkJob', () => ({ BookmarkJob: class {} }))
vi.mock('@/handler/cron/collectionJob', () => ({ CollectionJob: class {} }))
vi.mock('@/handler/cron/subscriptionJob', () => ({ SubscriptionJob: class {} }))
vi.mock('@/handler/cron/userDeletionJob', () => ({ UserDeletionJob: class {} }))
import { handleCronjob } from '@/di/generated/cronjob'

describe('scheduled job fanout', () => {
  test('all same-expression jobs run even when one fails', async () => {
    const controller = {
      checkImportProgress: vi.fn().mockRejectedValue(new Error('import error')),
      recoverPayments: vi.fn().mockResolvedValue(undefined),
      recoverDeletedUsers: vi.fn().mockResolvedValue(undefined)
    }
    const pending: Promise<unknown>[] = []
    const execution = { waitUntil: (task: Promise<unknown>) => pending.push(task.catch(() => {})) }
    await handleCronjob({ resolve: () => controller } as never, { cron: '*/5 * * * *' }, {} as Env, execution as never)
    for (let index = 0; index < pending.length; index++) await pending[index]
    expect(controller.checkImportProgress).toHaveBeenCalledOnce()
    expect(controller.recoverPayments).toHaveBeenCalledOnce()
    expect(controller.recoverDeletedUsers).toHaveBeenCalledOnce()
  })
})
