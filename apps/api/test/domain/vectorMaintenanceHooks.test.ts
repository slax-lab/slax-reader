import { describe, expect, it, vi } from 'vitest'
import { dispatchVectorMaintenance, enqueueVectorMaintenance, vectorMaintenanceKey } from '@/domain/vectorMaintenanceHooks'
import { CollectionController } from '@/handler/http/collectionController'

const context = (create = vi.fn().mockResolvedValue({ id: 'instance' })) => {
  const pending: Promise<unknown>[] = []
  const createBatch = vi.fn(async (items: unknown[]) => Promise.all(items.map(item => create(item))))
  const ctx = {
    env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create, createBatch } },
    execution: { waitUntil: (work: Promise<unknown>) => pending.push(work) },
    getUserId: () => 7
  }
  return { ctx: ctx as any, create, createBatch, flush: () => Promise.all(pending) }
}

describe('private vector maintenance dispatch', () => {
  it('keeps the same historical bookmark isolated across saving users', async () => {
    const { ctx, create, createBatch, flush } = context()
    dispatchVectorMaintenance(ctx, { kind: 'article', userId: 7, id: 99 }, { kind: 'article', userId: 8, id: 99 }, { kind: 'article', userId: 7, id: 99 })
    await flush()
    expect(createBatch).toHaveBeenCalledTimes(1)
    expect(createBatch.mock.calls[0][0]).toHaveLength(2)
    expect(create.mock.calls.map(([args]) => args.params.target)).toEqual([
      { kind: 'article', userId: 7, id: 99 },
      { kind: 'article', userId: 8, id: 99 }
    ])
    expect(vectorMaintenanceKey({ kind: 'article', userId: 7, id: 99 })).not.toBe(vectorMaintenanceKey({ kind: 'article', userId: 8, id: 99 }))
  })

  it('uses a new event identity for each operation on the same target', async () => {
    const { ctx, create } = context()
    await enqueueVectorMaintenance(ctx.env, { kind: 'user', id: 7, preference: 'article' })
    await enqueueVectorMaintenance(ctx.env, { kind: 'user', id: 7, preference: 'article' })
    expect(create.mock.calls[0][0].id).not.toBe(create.mock.calls[1][0].id)
    expect(create.mock.calls[0][0].params.eventId).not.toBe(create.mock.calls[1][0].params.eventId)
  })

  it('does not let dispatch failure reject an already committed business mutation', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { ctx, flush } = context(vi.fn().mockRejectedValue(new Error('binding unavailable')))
      expect(() => dispatchVectorMaintenance(ctx, { kind: 'article', userId: 7, id: 99 })).not.toThrow()
      await expect(flush()).resolves.toBeDefined()
      expect(log).toHaveBeenCalled()
      await expect(enqueueVectorMaintenance({} as any, { kind: 'article', userId: 7, id: 99 })).rejects.toThrow('missing_vector_maintenance_workflow')
    } finally {
      log.mockRestore()
    }
  })

  it('new dispatch failure does not stop the original legacy semantic write', async () => {
    const { SearchService } = await import('@/domain/search')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { ctx, flush } = context(vi.fn().mockRejectedValue(new Error('dispatch unavailable')))
      const upsertVector = vi.fn().mockResolvedValue({ mutationId: 'legacy' })
      const service = new SearchService(
        { upsertVectorShard: vi.fn().mockResolvedValue({ bucket_idx: 0 }) } as any,
        {} as any,
        {} as any,
        { deleteVector: vi.fn(), upsertVector } as any
      )
      await expect(service.semanticNormalize(ctx, { processSemantic: vi.fn().mockResolvedValue([{ id: 'legacy', embedding: [1] }]) } as any, 99, 'Title', 'Body')).resolves.toEqual(
        { mutationId: 'legacy' }
      )
      await flush()
      expect(upsertVector).toHaveBeenCalledTimes(1)
    } finally {
      error.mockRestore()
    }
  })

  it('legacy provider failure never causes hidden maintenance admission from search normalization', async () => {
    const { SearchService } = await import('@/domain/search')
    const { ctx, create, flush } = context()
    const service = new SearchService({} as any, {} as any, {} as any, {} as any)
    await expect(service.semanticNormalize(ctx, { processSemantic: vi.fn().mockRejectedValue(new Error('legacy unavailable')) } as any, 99, 'Title', 'Body')).rejects.toThrow(
      'legacy unavailable'
    )
    await flush()
    expect(create).not.toHaveBeenCalled()
  })

  it('a committed Fork indexes stored content without issuing a duplicate body event', async () => {
    const { BookmarkForkService } = await import('@/domain/bookmarkFork')
    const { SearchService } = await import('@/domain/search')
    const { ctx, create, flush } = context()
    ctx.hashIds = { encodeId: (id: number) => id }
    const search = new SearchService(
      { upsertVectorShard: vi.fn().mockResolvedValue({ bucket_idx: 0 }) } as any,
      {} as any,
      {} as any,
      { deleteVector: vi.fn(), upsertVector: vi.fn().mockResolvedValue({ mutationId: 'legacy' }) } as any
    )
    const service = Object.assign(Object.create(BookmarkForkService.prototype), {
      bookmarks: { deleteBookmarkSummary: vi.fn(), createBookmarkChangeLog: vi.fn() },
      media: { indexSnapshot: () => search.semanticNormalize(ctx, { processSemantic: vi.fn().mockResolvedValue([{ id: 'old', embedding: [1] }]) } as any, 99, 'Title', 'Stored') },
      search: { clearSearchCache: vi.fn() },
      notifications: { sendBookmarkChange: vi.fn() }
    })
    await service.afterCommit(ctx, { user_id: 7, bookmark: { id: 99, target_url: 'https://reader.test/saved' } })
    await flush()
    expect(create).not.toHaveBeenCalled()
  })

  it.each(['star', 'unstar'] as const)('%s enqueues one completed article after the relation commits', async status => {
    const { BookmarkOrchestrator } = await import('@/domain/orchestrator/bookmark')
    const { ctx, create, flush } = context()
    const updateBookmarkStarStatus = vi.fn().mockResolvedValue({ id: 20 })
    const service = Object.assign(Object.create(BookmarkOrchestrator.prototype), {
      bookmarkService: { updateBookmarkStarStatus, getBookmarkById: vi.fn().mockResolvedValue({ status: 'success' }) },
      collectSvc: { userHasCollection: vi.fn().mockResolvedValue(null) }
    })
    await service.bookmarkStar(ctx, 99, status)
    await flush()
    expect(create.mock.calls.map(([args]) => args.params.target)).toEqual([{ kind: 'article', userId: 7, id: 99 }])
    expect(updateBookmarkStarStatus.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0])
  })

  it.each(['archive', 'inbox'])('archive action %s never refreshes preference vectors', async status => {
    const { BookmarkService } = await import('@/domain/bookmark')
    const { ctx, create, flush } = context()
    const updateBookmarkArchiveStatus = vi.fn().mockResolvedValue(undefined)
    const service = Object.assign(Object.create(BookmarkService.prototype), { bookmarkRepo: { updateBookmarkArchiveStatus } })
    await service.bookmarkArchive(ctx, 99, status)
    await flush()
    expect(updateBookmarkArchiveStatus).toHaveBeenCalledExactlyOnceWith(99, 7, status === 'archive' ? 1 : 0)
    expect(create).not.toHaveBeenCalled()
  })

  it.each(['trashBookmark', 'trashRevertBookmark'] as const)('%s enqueues a single article after business writes', async method => {
    const { BookmarkService } = await import('@/domain/bookmark')
    const { ctx, create, flush } = context()
    const repo = {
      updateBookmarkDeleteAt: vi.fn(),
      updateBookmarkShareIsEnable: vi.fn(),
      updateBookmarkArchiveStatus: vi.fn(),
      getBookmarkById: vi.fn().mockResolvedValue({ status: 'success' })
    }
    const service = Object.assign(Object.create(BookmarkService.prototype), { bookmarkRepo: repo, searchService: { clearSearchCache: vi.fn() } })
    await service[method](ctx, 99)
    await flush()
    expect(create.mock.calls.map(([args]) => args.params.target)).toEqual([{ kind: 'article', userId: 7, id: 99 }])
    expect(repo.updateBookmarkDeleteAt.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0])
  })

  it('subscription cancellation refreshes only the actor collection preference', async () => {
    const { ctx, create, flush } = context()
    const services = { getUserCollectionSubscribed: vi.fn().mockResolvedValue({ subscribed: true, deleted: false }) }
    const orchestrator = { unsubscribeUserCollection: vi.fn().mockResolvedValue(undefined) }
    const controller = new CollectionController(services as any, orchestrator as any)
    await controller.handleUserCollectionUnsubscribeRequest(
      ctx,
      new Request('https://reader.test/v1/collection/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collect_code: 'collection7' })
      })
    )
    await flush()
    expect(orchestrator.unsubscribeUserCollection).toHaveBeenCalledWith(ctx, 'collection7')
    expect(create.mock.calls.map(([args]) => args.params.target)).toEqual([{ kind: 'user', id: 7, preference: 'collection' }])
  })

  it.each(['bookmark', 'fork'] as const)('%s rebind cleans only the displaced identity until capture completes', async kind => {
    const { BookmarkService } = await import('@/domain/bookmark')
    const { BookmarkForkService } = await import('@/domain/bookmarkFork')
    const { ctx, create, flush } = context()
    const service = Object.create(kind === 'bookmark' ? BookmarkService.prototype : BookmarkForkService.prototype)
    service.maintainReboundArticles(ctx, { rebindings: [{ userId: 7, previousBookmarkId: 99, bookmarkId: 100 }] })
    await flush()
    expect(create.mock.calls.map(([args]) => args.params.target)).toEqual([{ kind: 'article', userId: 7, id: 99 }])
  })

  it.each(['success', 'pending', 'failed'] as const)('Twitter mention dispatches old 99 only and admits %s via skipParse', async status => {
    const { MonitoringOrchestrator } = await import('@/domain/orchestrator/monitor')
    const { ctx, create, flush } = context()
    ctx.getlang = () => 'en'
    ctx.hashIds = {}
    const updatedAt = new Date('2026-11-06T10:00:00Z')
    const createWorkflow = vi.fn().mockResolvedValue(undefined)
    const createBookmarkBase = vi.fn().mockResolvedValue({
      id: 100,
      status,
      updated_at: updatedAt,
      rebindings: [{ userId: 7, previousBookmarkId: 99, bookmarkId: 100 }]
    })
    const service = Object.assign(Object.create(MonitoringOrchestrator.prototype), {
      bookmarkData: { getBookmark: vi.fn().mockResolvedValue(null) },
      bookmarkService: { createBookmarkBase },
      crawlService: { createWorkflow }
    })
    await service.createBookmarkFromMention(ctx, 7, 'https://x.com/author/status/123', { tweet_id: '123' })
    await flush()
    expect(create.mock.calls.map(([args]) => args.params.target)).toEqual([{ kind: 'article', userId: 7, id: 99 }])
    expect(createWorkflow).toHaveBeenCalledOnce()
    expect(createWorkflow.mock.calls[0][1]).toMatchObject({
      url: 'https://x.com/author/status/123',
      bookmarkId: 100,
      captureRevision: updatedAt.toISOString(),
      userId: 7,
      enUserId: 7,
      userLang: 'en',
      ignoreGenerateTag: true,
      skipParse: status === 'success'
    })
    expect(createBookmarkBase.mock.calls[0][0].ctx.getUserId()).toBe(7)
  })

  it('dispatches committed old identities even when the new capture is not admitted', async () => {
    const { MonitoringOrchestrator } = await import('@/domain/orchestrator/monitor')
    const { ctx, create, flush } = context()
    ctx.getlang = () => 'en'
    ctx.hashIds = {}
    const createWorkflow = vi.fn()
    const service = Object.assign(Object.create(MonitoringOrchestrator.prototype), {
      bookmarkData: { getBookmark: vi.fn().mockResolvedValue(null) },
      bookmarkService: {
        createBookmarkBase: vi.fn().mockResolvedValue({
          id: 100,
          status: 'pending',
          admitted: false,
          updated_at: new Date(),
          rebindings: [{ userId: 7, previousBookmarkId: 99, bookmarkId: 100 }]
        })
      },
      crawlService: { createWorkflow }
    })
    await service.createBookmarkFromMention(ctx, 7, 'https://x.com/author/status/123', { tweet_id: '123' })
    await flush()
    expect(create.mock.calls.map(([args]) => args.params.target)).toEqual([{ kind: 'article', userId: 7, id: 99 }])
    expect(createWorkflow).not.toHaveBeenCalled()
  })

  it('the real CrawlService gate refuses a cached success admission when the stored source is not successful', async () => {
    const { MonitoringOrchestrator } = await import('@/domain/orchestrator/monitor')
    const { CrawlService } = await import('@/domain/crawl')
    const { ctx, create, flush } = context()
    ctx.getlang = () => 'en'
    ctx.hashIds = {}
    const revision = new Date('2026-11-06T10:00:00Z')
    const crawlService = Object.assign(Object.create(CrawlService.prototype), {
      snapshotRepo: { snapshot: vi.fn(async () => ({ status: 'pending', updated_at: revision })), failDispatch: vi.fn() },
      logsService: { track: vi.fn().mockResolvedValue(undefined) },
      bookmarkRepo: {},
      alertBot: { crawl: { pushMessage: vi.fn() } }
    })
    ctx.env.CRAWL_WORKFLOW = { create: vi.fn().mockResolvedValue(undefined) } as never
    ctx.env.FRONT_END_URL = 'https://reader.test'
    const service = Object.assign(Object.create(MonitoringOrchestrator.prototype), {
      bookmarkData: { getBookmark: vi.fn().mockResolvedValue(null) },
      bookmarkService: {
        createBookmarkBase: vi.fn().mockResolvedValue({
          id: 100,
          status: 'success',
          updated_at: revision,
          rebindings: [{ userId: 7, previousBookmarkId: 99, bookmarkId: 100 }]
        })
      },
      crawlService
    })
    await service.createBookmarkFromMention(ctx, 7, 'https://x.com/author/status/123', { tweet_id: '123' })
    await flush()
    expect(create).toHaveBeenCalledOnce()
    expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
  })

  it('keeps a null creation result and creation errors inert without new maintenance or workflow', async () => {
    const { MonitoringOrchestrator } = await import('@/domain/orchestrator/monitor')
    const { ctx, create, flush } = context()
    const createWorkflow = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const createBookmarkBase of [vi.fn().mockResolvedValue(null), vi.fn().mockRejectedValue(new Error('create failed'))]) {
        const service = Object.assign(Object.create(MonitoringOrchestrator.prototype), {
          bookmarkData: { getBookmark: vi.fn().mockResolvedValue(null) },
          bookmarkService: { createBookmarkBase },
          crawlService: { createWorkflow }
        })
        await expect(service.createBookmarkFromMention(ctx, 7, 'https://x.com/author/status/123', { tweet_id: '123' })).resolves.toBeUndefined()
      }
    } finally {
      error.mockRestore()
    }
    await flush()
    expect(create).not.toHaveBeenCalled()
    expect(createWorkflow).not.toHaveBeenCalled()
  })

  it('uses the mention owner for workflow admission and dispatches rebindings for their owner only', async () => {
    const { MonitoringOrchestrator } = await import('@/domain/orchestrator/monitor')
    const { ctx, create, flush } = context()
    ctx.getlang = () => 'en'
    ctx.hashIds = {}
    const createWorkflow = vi.fn().mockResolvedValue(undefined)
    const createBookmarkBase = vi.fn().mockResolvedValue({ id: 200, status: 'pending', updated_at: new Date(), rebindings: [] })
    const service = Object.assign(Object.create(MonitoringOrchestrator.prototype), {
      bookmarkData: { getBookmark: vi.fn().mockResolvedValue(null) },
      bookmarkService: { createBookmarkBase },
      crawlService: { createWorkflow }
    })
    await service.createBookmarkFromMention(ctx, 8, 'https://x.com/other/status/456', { tweet_id: '456' })
    await flush()
    expect(createBookmarkBase.mock.calls[0][0].ctx.getUserId()).toBe(8)
    expect(create).not.toHaveBeenCalled()
    expect(createWorkflow.mock.calls[0][1]).toMatchObject({ userId: 8, enUserId: 8, bookmarkId: 200, skipParse: false })
  })

  it('composes the real CrawlService cached gate for a successful re-save without external fetch', async () => {
    const { MonitoringOrchestrator } = await import('@/domain/orchestrator/monitor')
    const { CrawlService } = await import('@/domain/crawl')
    const { ctx, create, flush } = context()
    ctx.getlang = () => 'en'
    ctx.hashIds = {}
    const revision = new Date('2026-11-06T10:00:00Z')
    const snapshot = vi.fn(async () => ({ status: 'success', updated_at: revision }))
    const track = vi.fn().mockResolvedValue(undefined)
    const crawlService = Object.assign(Object.create(CrawlService.prototype), {
      snapshotRepo: { snapshot, failDispatch: vi.fn() },
      logsService: { track },
      bookmarkRepo: {},
      alertBot: { crawl: { pushMessage: vi.fn() } }
    })
    ctx.env.CRAWL_WORKFLOW = { create: vi.fn().mockResolvedValue(undefined) } as never
    ctx.env.FRONT_END_URL = 'https://reader.test'
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const service = Object.assign(Object.create(MonitoringOrchestrator.prototype), {
        bookmarkData: { getBookmark: vi.fn().mockResolvedValue(null) },
        bookmarkService: {
          createBookmarkBase: vi.fn().mockResolvedValue({
            id: 100,
            status: 'success',
            updated_at: revision,
            rebindings: [{ userId: 7, previousBookmarkId: 99, bookmarkId: 100 }]
          })
        },
        crawlService
      })
      await service.createBookmarkFromMention(ctx, 7, 'https://x.com/author/status/123', { tweet_id: '123' })
      await flush()
      expect(create.mock.calls.map(([args]) => args.params.target)).toEqual([{ kind: 'article', userId: 7, id: 99 }])
      expect(snapshot).toHaveBeenCalledWith(100)
      expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledExactlyOnceWith({
        params: expect.objectContaining({
          bookmarkId: 100,
          userId: 7,
          captureRevision: revision.toISOString(),
          skipParse: true,
          ignoreGenerateTag: true
        })
      })
      expect(track).toHaveBeenCalledWith(7, 'bookmark_add_step', expect.objectContaining({ step_name: 'workflow_creation', status: 'success' }))
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
