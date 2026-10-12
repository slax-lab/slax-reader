import { describe, expect, it, vi } from 'vitest'

vi.mock('@prisma/client', () => ({
  Prisma: { join: vi.fn(), sql: vi.fn() },
  PrismaClient: class {}
}))

vi.mock('@prisma/hyperdrive-client', () => ({
  PrismaClient: class {}
}))

import { BookmarkService } from '@/domain/bookmark'
import { BookmarkRepo, queueStatus } from '@/infra/repository/dbBookmark'

describe('bookmark import metadata', () => {
  it('uses saved time and stars for new relations without changing an existing relation', async () => {
    const repo = Object.create(BookmarkRepo.prototype) as BookmarkRepo
    const upsert = vi.fn().mockResolvedValue({})
    Object.assign(repo, { prismaPg: () => ({ sr_user_bookmark: { upsert } }) })
    const savedAt = new Date('2020-01-02T03:04:05Z')

    await repo.createBookmarkRelation(1, 42, 0, true, { savedAt, starred: true })

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ created_at: savedAt, is_starred: true, archive_status: 1 }),
        update: {}
      })
    )

    await repo.createBookmarkRelation(1, 42, 0, false)
    expect(upsert.mock.calls[1][0].update.created_at).toBeInstanceOf(Date)
  })

  it('uses current change-log time while preserving the original saved date', async () => {
    const service = Object.create(BookmarkService.prototype) as BookmarkService
    const oldDate = new Date('2020-01-02T03:04:05Z')
    const createBookmarkRelation = vi.fn().mockResolvedValue({ bookmark_id: 42, created_at: oldDate, deleted_at: null })
    const createBookmarkChangeLog = vi.fn()
    const sendBookmarkChange = vi.fn().mockResolvedValue(undefined)
    const waitUntil = vi.fn()
    Object.assign(service, {
      bookmarkRepo: {
        createBookmark: vi.fn().mockResolvedValue({ id: 42, status: queueStatus.SUCCESS }),
        createBookmarkRelation,
        createBookmarkChangeLog
      },
      bookmarkSearchRepo: { upsertUserBookmark: vi.fn() },
      notifyMessage: { sendBookmarkChange },
      searchService: { clearSearchCache: vi.fn() }
    })
    const ctx = {
      env: {},
      execution: { waitUntil },
      getUserId: () => 1,
      hashIds: { encodeId: (id: number) => `encoded-${id}` }
    } as any
    const before = Date.now()

    await service.createBookmarkBase({
      ctx,
      targetUrl: 'https://example.com/article',
      hostUrl: 'example.com',
      title: 'Article',
      type: 0,
      importMetadata: { savedAt: oldDate, starred: false }
    })

    expect(createBookmarkRelation).toHaveBeenCalledWith(1, 42, 0, false, { savedAt: oldDate, starred: false })
    const changeTime = createBookmarkChangeLog.mock.calls[0][4] as Date
    expect(changeTime.getTime()).toBeGreaterThanOrEqual(before)
    expect(sendBookmarkChange).toHaveBeenCalledWith(ctx.env, expect.objectContaining({ created_at: changeTime, bookmark_id: 'encoded-42' }))
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })
})
