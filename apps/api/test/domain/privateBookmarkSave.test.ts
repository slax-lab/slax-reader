import { beforeEach, describe, expect, test, vi } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'
import { callbackType } from '@/infra/queue/queueClient'
import type { OrderedSyncOperation } from '@/domain/orchestrator/sync'

const userId = 7
const targetUrl = 'https://example.com/article'
const operation: OrderedSyncOperation = {
  type: 'create_bookmark',
  bookmarkUuid: 'bookmark-uuid',
  userId,
  data: {
    targetUrl,
    title: 'Article',
    description: '',
    isArchive: false,
    isNewBookmark: true
  }
}

function createService() {
  const createBookmarkBase = vi.fn().mockResolvedValue({ id: 11, private_user: userId })
  const bookmarkRepo = { getBookmark: vi.fn().mockResolvedValue(null) }
  const labService = { assertUrlAllowed: vi.fn().mockResolvedValue(undefined) }
  const service = Object.create(BookmarkService.prototype) as BookmarkService
  Object.assign(service, { createBookmarkBase, bookmarkRepo, bookmarkData: bookmarkRepo, labService })
  return { service, createBookmarkBase, bookmarkRepo, labService }
}

function createCtx() {
  return { getUserId: () => userId, env: { RUN_ENV: 'prod' } } as never
}

function syncTx(privateUser = userId) {
  return {
    sr_bookmark: {
      upsert: vi.fn().mockResolvedValue({ id: 11, target_url: targetUrl, private_user: privateUser }),
      update: vi.fn()
    },
    sr_user_bookmark: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      upsert: vi.fn()
    },
    sr_user_delete_bookmark: { deleteMany: vi.fn() }
  }
}

describe('bookmark save privacy', () => {
  beforeEach(() => vi.clearAllMocks())

  test('addBookmark creates the article for the current user', async () => {
    const { service, createBookmarkBase, bookmarkRepo } = createService()

    await service.addBookmark(createCtx(), {
      target_url: targetUrl,
      target_title: 'Article',
      target_icon: '',
      taget_cover: '',
      content: '',
      description: '',
      tag: []
    })

    expect(bookmarkRepo.getBookmark).toHaveBeenCalledWith(targetUrl, userId)
    expect(createBookmarkBase).toHaveBeenCalledWith(expect.objectContaining({ privateUser: userId }))
  })

  test('addUrlBookmarkItem creates the article for the current user', async () => {
    const { service, createBookmarkBase, bookmarkRepo } = createService()

    await service.addUrlBookmarkItem(createCtx(), {
      target_url: targetUrl,
      target_title: 'Article',
      tags: []
    })

    expect(bookmarkRepo.getBookmark).toHaveBeenCalledWith(targetUrl, userId)
    expect(createBookmarkBase).toHaveBeenCalledWith(expect.objectContaining({ privateUser: userId }))
  })

  test('addUrlBookmark creates the article for the current user', async () => {
    const { service, createBookmarkBase, bookmarkRepo } = createService()

    await service.addUrlBookmark(createCtx(), { target_url: targetUrl, target_title: 'Article', tags: [] }, callbackType.NOT_CALLBACK)

    expect(bookmarkRepo.getBookmark).toHaveBeenCalledWith(targetUrl, userId)
    expect(createBookmarkBase).toHaveBeenCalledWith(expect.objectContaining({ privateUser: userId }))
  })

  test('PowerSync creates or re-saves the current user private article', async () => {
    const tx = syncTx()
    const repo = new DBSyncBatchOperation((() => undefined) as never)

    const result = await repo.executeCreateBookmark(tx as never, operation)

    expect(tx.sr_bookmark.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { target_url_private_user: { target_url: targetUrl, private_user: userId } },
        create: expect.objectContaining({ private_user: userId })
      })
    )
    expect(tx.sr_user_delete_bookmark.deleteMany).toHaveBeenCalledWith({ where: { user_id: userId, bookmark_id: 11 } })
    expect(result).toMatchObject({ bookmarkId: 11, userId })
  })
})
