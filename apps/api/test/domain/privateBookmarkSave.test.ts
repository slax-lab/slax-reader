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
    $executeRaw: vi.fn(),
    sr_bookmark_save_receipt: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn()
    },
    sr_bookmark: {
      upsert: vi.fn().mockResolvedValue({ id: 11, target_url: targetUrl, private_user: privateUser }),
      update: vi.fn()
    },
    sr_user_bookmark: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ uuid: 'bookmark-uuid' })
    },
    sr_user_delete_bookmark: { deleteMany: vi.fn() }
  }
}

describe('bookmark save privacy', () => {
  beforeEach(() => vi.clearAllMocks())

  test.each([
    'https://x.com/a?a=1&b=2',
    'https://twitter.com/a?a=1&b=2#section',
    'https://mp.weixin.qq.com/s?__biz=article&poc_token=token&mid=123'
  ])('retains the complete identity URL across inline, URL, import and PowerSync saves: %s', async url => {
    const { service, createBookmarkBase, bookmarkRepo } = createService()
    await service.addBookmark(createCtx(), { target_url: url, target_title: 'Article', target_icon: '', taget_cover: '', content: '<article>body</article>', description: '', tag: [] })
    await service.addUrlBookmark(createCtx(), { target_url: url, target_title: 'Article', tags: [] }, callbackType.NOT_CALLBACK)
    await service.addUrlBookmarkItem(createCtx(), { target_url: url, target_title: 'Article', tags: [] })

    expect(bookmarkRepo.getBookmark.mock.calls).toEqual([[url, userId], [url, userId], [url, userId]])
    expect(createBookmarkBase.mock.calls.map(([input]) => input.targetUrl)).toEqual([url, url, url])

    const tx = syncTx()
    const repo = new DBSyncBatchOperation((() => undefined) as never)
    const result = await repo.executeCreateBookmark(tx as never, { ...operation, data: { ...operation.data, targetUrl: url } })
    expect(tx.sr_bookmark.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { target_url_private_user: { target_url: url, private_user: userId } },
      create: expect.objectContaining({ target_url: url })
    }))
    expect(result?.targetUrl).toBe(url)
  })

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

  test.each(['https://example.com/paper.pdf', 'https://arxiv.org/pdf/2608.00046'])('PowerSync accepts %s without a Labs lookup', async url => {
    const tx = syncTx()
    const repo = new DBSyncBatchOperation((() => undefined) as never)
    expect(await repo.executeCreateBookmark(tx as never, { ...operation, data: { ...operation.data, targetUrl: url } })).toMatchObject({ bookmarkId: 11, userId })
    expect(tx.sr_user_bookmark.upsert).toHaveBeenCalled()
  })

  test('a cached extensionless PDF does not block unrelated pending mutations', async () => {
    const tx = syncTx()
    tx.sr_bookmark.upsert.mockResolvedValue({ id: 11, private_user: userId, content_key: 'pdf/body/saved.pdf' } as never)
    const transaction = vi.fn(async callback => callback(tx))
    const repo = new DBSyncBatchOperation((() => ({ $transaction: transaction })) as never)
    const result = await repo.executeOrderedOperations([
      operation,
      { type: 'update_bookmark', bookmarkUuid: 'other-article', userId, data: { is_starred: true } }
    ])
    expect(result).toMatchObject([{ bookmarkId: 11, userId }])
    expect(tx.sr_user_bookmark.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ type: 2 }) }))
    expect(tx.sr_user_bookmark.update).toHaveBeenCalledWith(expect.objectContaining({ where: { uuid: 'other-article', user_id: userId }, data: expect.objectContaining({ is_starred: true }) }))
    expect(tx.sr_user_delete_bookmark.deleteMany).toHaveBeenCalled()
  })
})
