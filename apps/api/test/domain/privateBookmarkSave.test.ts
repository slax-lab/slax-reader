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
  const createBookmarkBase = vi.fn().mockResolvedValue({ id: 11, private_user: userId, updated_at: new Date() })
  const bookmarkRepo = { getBookmark: vi.fn().mockResolvedValue(null) }
  const labService = { assertUrlAllowed: vi.fn().mockResolvedValue(undefined) }
  const crawlService = { createWorkflow: vi.fn().mockResolvedValue(undefined) }
  const service = Object.create(BookmarkService.prototype) as BookmarkService
  Object.assign(service, { createBookmarkBase, bookmarkRepo, bookmarkData: bookmarkRepo, labService, crawlService })
  return { service, createBookmarkBase, bookmarkRepo, labService, crawlService }
}

function createCtx() {
  return { getUserId: () => userId, env: { RUN_ENV: 'prod' } } as never
}

function syncTx(privateUser = userId) {
  return {
    sr_bookmark: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(async ({ create }) => ({ ...create, id: 11, private_user: privateUser })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn()
    },
    sr_user_bookmark: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => (where.user_id_bookmark_id ? { id: 12, user_id: userId, bookmark_id: 11 } : null)),
      findFirst: vi.fn().mockResolvedValue(null),
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

  test.each([
    ['7', userId, 'article', '.html', true],
    ['17', userId, 'article', '.html', false],
    ['7', 0, 'article', '.html', false],
    ['7', userId, 'other', '.html', false],
    ['7', userId, 'article', '.pdf', false]
  ] as const)('cached inline metadata admission %s/%i/%s/%s', async (allowed, owner, marker, ext, admitted) => {
    const { service, createBookmarkBase, bookmarkRepo } = createService()
    createBookmarkBase.mockResolvedValue({ id: 11, private_user: owner, status: 'success', content_key: 'snapshot' + ext, title: '', site_name: '', byline: '' })
    const fill = vi.fn()
    Object.assign(bookmarkRepo, { fillPublisherMetadata: fill })
    const ctx = { getUserId: () => userId, env: { PUBLISHER_USER_IDS: allowed }, hashIds: { encodeId: String }, getlang: () => 'en' } as never
    const content = `<html data-slax-publisher="${marker}"><head><meta name="author" content="Author"></head><body><p>Body</p></body></html>`
    await service.addBookmark(ctx, { target_url: targetUrl, target_title: 'Source title', content, target_icon: '', taget_cover: '', description: '', tag: [] })
    if (admitted) expect(fill).toHaveBeenCalledExactlyOnceWith(11, userId, { title: 'Source title', siteName: '', byline: 'Author' })
    else expect(fill).not.toHaveBeenCalled()
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

  test.each(['url', 'inline', 'import'] as const)('%s resave returns a completed result and dispatches the cached workflow without recapture', async entry => {
    const { service, createBookmarkBase, crawlService } = createService()
    createBookmarkBase.mockResolvedValue({ id: 11, private_user: userId, status: 'success', updated_at: new Date(), target_url: targetUrl, title: 'Article', byline: '', content_key: 'html/body/article.html' })
    const create = vi.fn()
    const ctx = {
      getUserId: () => userId,
      env: { RUN_ENV: 'prod', VECTOR_V5_MAINTENANCE_WORKFLOW: { createBatch: vi.fn() } },
      hashIds: { encodeId: (id: number) => `encoded-${id}` },
      getlang: () => 'en',
      execution: { waitUntil: vi.fn() }
    } as any
    const result =
      entry === 'url'
        ? await service.addUrlBookmark(ctx, { target_url: targetUrl, tags: [] }, callbackType.NOT_CALLBACK)
        : entry === 'inline'
          ? await service.addBookmark(ctx, { target_url: targetUrl, target_title: 'Title', target_icon: '', taget_cover: '', content: '', description: '', tag: [] })
          : await service.addUrlBookmarkItem(ctx, { target_url: targetUrl, tags: [] })
    expect(result).toEqual(
      entry === 'import'
        ? { kind: 'completed', bookmarkId: 11, targetUrl, userId, skipParse: true, ignoreGenerateTag: true }
        : { kind: 'completed', bookmark_id: 11 }
    )
    expect(crawlService.createWorkflow).toHaveBeenCalledExactlyOnceWith(
      ctx.env,
      expect.objectContaining({ url: targetUrl, bookmarkId: 11, userId, skipParse: true, ignoreGenerateTag: entry === 'import' }),
      3,
      ctx
    )
    expect(ctx.env.VECTOR_V5_MAINTENANCE_WORKFLOW.createBatch).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  test.each(['url', 'inline', 'import'] as const)('%s resave still returns the committed save when cached-workflow admission is exhausted', async entry => {
    const { service, createBookmarkBase, crawlService } = createService()
    createBookmarkBase.mockResolvedValue({ id: 11, private_user: userId, status: 'success', updated_at: new Date(), target_url: targetUrl, title: 'Article', byline: '', content_key: 'html/body/article.html' })
    crawlService.createWorkflow.mockRejectedValue(new Error('admission unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const ctx = {
        getUserId: () => userId,
        env: { RUN_ENV: 'prod' },
        hashIds: { encodeId: (id: number) => `encoded-${id}` },
        getlang: () => 'en',
        execution: { waitUntil: vi.fn() }
      } as any
      const result =
        entry === 'url'
          ? await service.addUrlBookmark(ctx, { target_url: targetUrl, tags: [] }, callbackType.NOT_CALLBACK)
          : entry === 'inline'
            ? await service.addBookmark(ctx, { target_url: targetUrl, target_title: 'Title', target_icon: '', taget_cover: '', content: '', description: '', tag: [] })
            : await service.addUrlBookmarkItem(ctx, { target_url: targetUrl, tags: [] })
      expect(result).toEqual(
        entry === 'import'
          ? { kind: 'completed', bookmarkId: 11, targetUrl, userId, skipParse: true, ignoreGenerateTag: true }
          : { kind: 'completed', bookmark_id: 11 }
      )
      expect(crawlService.createWorkflow).toHaveBeenCalledOnce()
      expect(log).toHaveBeenCalledWith('Cached bookmark post-processing admission failed', { bookmarkId: 11 }, expect.any(Error))
    } finally {
      log.mockRestore()
    }
  })

  test('a cached PDF re-save schedules the stored-original repair but an upload with bytes repairs title directly', async () => {
    const { service, crawlService } = createService()
    const booked = { id: 11, private_user: userId, status: 'success', updated_at: new Date(), title: 'Old', byline: '', content_key: 'pdf/body/cached.pdf', target_url: targetUrl }
    const getBookmark = vi.fn().mockResolvedValue(booked)
    const updatePdfMetadata = vi.fn().mockResolvedValue(undefined)
    const clearSearchCache = vi.fn().mockResolvedValue(undefined)
    Object.assign(service, { bookmarkRepo: { getBookmark, updatePdfMetadata }, searchService: { clearSearchCache } })
    const repair = vi.spyOn(service as any, 'repairCachedPdfMetadata').mockResolvedValue('Repaired')
    const ctx = { getUserId: () => userId, env: { RUN_ENV: 'prod' }, hashIds: { encodeId: (id: number) => `encoded-${id}` }, getlang: () => 'en', execution: { waitUntil: vi.fn() } } as any
    await (service as any).processCachedBookmark(ctx, booked)
    expect(crawlService.createWorkflow).toHaveBeenLastCalledWith(
      ctx.env,
      expect.objectContaining({ skipParse: true, repairPdfMetadata: true }),
      3,
      ctx
    )
    repair.mockClear()
    crawlService.createWorkflow.mockClear()
    await (service as any).processCachedBookmark(ctx, booked, false, new Uint8Array([1, 2, 3]))
    expect(repair).toHaveBeenCalledOnce()
    expect(crawlService.createWorkflow).toHaveBeenLastCalledWith(ctx.env, expect.objectContaining({ skipParse: true }), 3, ctx)
    expect(crawlService.createWorkflow.mock.calls[0][1]).not.toHaveProperty('repairPdfMetadata')
  })

  test('fresh pending source returns a capture task without any vector admission', async () => {
    const { service } = createService()
    const create = vi.fn()
    const ctx = { getUserId: () => userId, env: { RUN_ENV: 'prod', VECTOR_V5_MAINTENANCE_WORKFLOW: { create } } } as any
    expect(await service.addUrlBookmark(ctx, { target_url: targetUrl, tags: [] }, callbackType.NOT_CALLBACK)).toMatchObject({ info: { bookmarkId: 11 } })
    expect(create).not.toHaveBeenCalled()
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
    tx.sr_bookmark.upsert.mockResolvedValue({ id: 11, private_user: userId, content_key: 'pdf/body/saved.pdf', updated_at: new Date(), status: 'success' } as never)
    const transaction = vi.fn(async callback => callback(tx))
    const repo = new DBSyncBatchOperation((() => ({ $transaction: transaction })) as never)
    const result = await repo.executeOrderedOperations([operation, { type: 'update_bookmark', bookmarkUuid: 'other-article', userId, data: { is_starred: true } }])
    expect(result).toEqual([])
    expect(tx.sr_bookmark.updateMany).not.toHaveBeenCalled()
    expect(tx.sr_user_bookmark.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ type: 2 }) }))
    expect(tx.sr_user_bookmark.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { uuid: 'other-article', user_id: userId }, data: expect.objectContaining({ is_starred: true }) })
    )
    expect(tx.sr_user_delete_bookmark.deleteMany).toHaveBeenCalled()
  })
})

describe('publisher original publication time', () => {
  const original = '2023-10-19T12:01:36.000Z'
  const article = `<html data-slax-publisher="article"><head><title>T</title><meta property="article:published_time" content="2023-10-19T12:01:36+00:00"></head><body><p>Body</p></body></html>`
  const publisherCtx = (allowed = String(userId)) =>
    ({
      getUserId: () => userId,
      env: { RUN_ENV: 'prod', PUBLISHER_USER_IDS: allowed },
      hashIds: { encodeId: (id: number) => `encoded-${id}` },
      getlang: () => 'en',
      execution: { waitUntil: vi.fn() }
    }) as any

  function cached(privateUser = userId) {
    const value = createService()
    value.createBookmarkBase.mockResolvedValue({
      id: 11,
      private_user: privateUser,
      status: 'success',
      updated_at: new Date(),
      target_url: targetUrl,
      title: 'Article',
      byline: 'A',
      site_name: 'S',
      content_key: 'html/body/article.html'
    })
    const setOwnerPublishedAt = vi.fn().mockResolvedValue(1)
    Object.assign(value.bookmarkRepo, { setOwnerPublishedAt, fillPublisherMetadata: vi.fn() })
    Object.assign(value.service, { searchService: { clearSearchCache: vi.fn() } })
    return { ...value, setOwnerPublishedAt }
  }

  test('a cached add_url resave applies the supplied time to the publisher bookmark', async () => {
    const { service, setOwnerPublishedAt } = cached()
    await service.addUrlBookmark(publisherCtx(), { target_url: targetUrl, tags: [], published_at: original }, callbackType.NOT_CALLBACK)
    expect(setOwnerPublishedAt).toHaveBeenCalledExactlyOnceWith(11, userId, new Date(original))
  })

  test('a cached add resave applies the time from the supplied article HTML', async () => {
    const { service, setOwnerPublishedAt } = cached()
    await service.addBookmark(publisherCtx(), { target_url: targetUrl, target_title: 'T', content: article, target_icon: '', taget_cover: '', description: '', tag: [] })
    expect(setOwnerPublishedAt).toHaveBeenCalledExactlyOnceWith(11, userId, new Date(original))
  })

  test.each([
    ['a non-publisher', '99', original],
    ['an unzoned time', String(userId), '2023-10-19'],
    ['a future time', String(userId), '2999-01-01T00:00:00Z']
  ])('a cached resave from %s keeps the stored time', async (_name, allowed, value) => {
    const { service, setOwnerPublishedAt } = cached()
    await service.addUrlBookmark(publisherCtx(allowed), { target_url: targetUrl, tags: [], published_at: value }, callbackType.NOT_CALLBACK)
    expect(setOwnerPublishedAt).not.toHaveBeenCalled()
  })

  test('a cached resave never writes another owner bookmark', async () => {
    const { service, setOwnerPublishedAt } = cached(0)
    await service.addUrlBookmark(publisherCtx(), { target_url: targetUrl, tags: [], published_at: original }, callbackType.NOT_CALLBACK)
    expect(setOwnerPublishedAt).not.toHaveBeenCalled()
  })

  test.each(['url', 'inline'] as const)('a fresh %s capture carries the time to the workflow message', async entry => {
    const { service, createBookmarkBase } = createService()
    createBookmarkBase.mockResolvedValue({ id: 11, private_user: userId, status: 'pending', updated_at: new Date() })
    const result: any =
      entry === 'url'
        ? await service.addUrlBookmark(publisherCtx(), { target_url: targetUrl, tags: [], published_at: original }, callbackType.NOT_CALLBACK)
        : await service.addBookmark(publisherCtx(), { target_url: targetUrl, target_title: 'T', content: article, target_icon: '', taget_cover: '', description: '', tag: [] })
    expect(result.info.publishedAt).toBe(original)
  })

  test('a fresh capture by a non-publisher carries no time', async () => {
    const { service, createBookmarkBase } = createService()
    createBookmarkBase.mockResolvedValue({ id: 11, private_user: userId, status: 'pending', updated_at: new Date() })
    const result: any = await service.addUrlBookmark(publisherCtx('99'), { target_url: targetUrl, tags: [], published_at: original }, callbackType.NOT_CALLBACK)
    expect(result.info).not.toHaveProperty('publishedAt')
  })
})
