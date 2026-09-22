import { describe, it, expect, vi } from 'vitest'
import { ImportService } from '@/domain/import'
import { BookmarkService } from '@/domain/bookmark'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { BookmarkService as PublicBookmarkService } from '@/domain/bookmark'
import { BookmarkController } from '@/handler/http/bookmarkController'
import { ImportOrchestrator } from '@/domain/orchestrator/import'
import { createMockCtx, createMockBookmarkService, createMockCrawlService, createMockImportService } from '@test/helpers/mockFactory'

const blob = JSON.stringify([{ href: 'https://example.com/a', description: 'A', tags: 'one', time: '2020-01-02T03:04:05Z', toread: 'no' }])

function wireImport() {
  const service = Object.create(ImportService.prototype) as ImportService
  const repo = { createBookmarkImportTask: vi.fn().mockResolvedValue({ id: 42 }), updateBookmarkImportTask: vi.fn(), getUserProcessingImportTasks: vi.fn().mockResolvedValue([]) }
  const put = vi.fn().mockResolvedValue(undefined)
  Object.assign(service, { bookmarkData: repo, bucketData: () => ({ R2Bucket: { put } }) })
  const ctx = createMockCtx()
  ctx.env.IMPORT_OTHER = { sendBatch: vi.fn().mockResolvedValue(undefined) }
  ctx.env.IMPORT_OTHER_SLOW = { sendBatch: vi.fn().mockResolvedValue(undefined) }
  return { service, repo, put, ctx }
}

describe('import acceptance', () => {
  it('accepts versioned records and retains legacy Pocket and retry message formats', async () => {
    const { service, ctx } = wireImport()
    ctx.setUserInfo = vi.fn()
    ctx.setHashIds = vi.fn()
    const envelope = {
      id: 1,
      info: {
        id: 42,
        userId: 1,
        idx: 0,
        type: 'pinboard',
        version: 1 as const,
        data: [{ target_url: 'https://example.com/a', tags: [], saved_at: '2020-01-02T03:04:05Z', import_only: true }]
      }
    }
    expect(await service.processImportBookmark(ctx, envelope)).toEqual([expect.objectContaining({ import_only: true, saved_at: '2020-01-02T03:04:05Z' })])
    await expect(service.processImportBookmark(ctx, { ...envelope, info: { ...envelope.info, version: undefined } })).rejects.toThrow()
    const pocket = await service.processImportBookmark(ctx, {
      id: 1,
      info: { id: 42, userId: 1, idx: 0, type: 'pocket', data: [{ url: 'https://example.com/a', title: 'A', tags: 'one|two', status: 'archive' }] }
    })
    expect(pocket[0]).toMatchObject({ target_url: 'https://example.com/a', tags: ['one', 'two'], is_archive: true })
    expect(pocket[0]).not.toHaveProperty('import_only')
    const retry = await service.processImportBookmark(ctx, {
      id: 1,
      info: { id: 42, userId: 1, idx: 0, type: 'fetch_retry', data: [{ target_url: 'https://example.com/a', tags: [] }] }
    })
    expect(retry[0]).toMatchObject({ target_url: 'https://example.com/a', is_archive: false })
  })

  it('increments terminal progress by the number of completed records', async () => {
    const { service, ctx } = wireImport()
    const process = vi.fn().mockResolvedValue(3),
      success = vi.fn(),
      failed = vi.fn()
    Object.assign(service, {
      redisClient: () => ({ userImportProcess: () => ({ incrBy: process }), userImportSuccess: () => ({ incrBy: success }), userImportFailed: () => ({ incrBy: failed }) })
    })
    expect(await service.incrImportTask(ctx, 1, 42, 2, 1)).toBe(3)
    expect(process).toHaveBeenCalledWith(3)
    expect(success).toHaveBeenCalledWith(2)
    expect(failed).toHaveBeenCalledWith(1)
  })
  it('previews without storage, tasks or queues', () => {
    const { service, repo, put, ctx } = wireImport()
    expect(service.previewImport('pinboard', blob)).toMatchObject({ eligible_count: 1 })
    expect(put).not.toHaveBeenCalled()
    expect(repo.createBookmarkImportTask).not.toHaveBeenCalled()
    expect(ctx.env.IMPORT_OTHER.sendBatch).not.toHaveBeenCalled()
  })

  it('rejects invalid input before any writes', async () => {
    const { service, repo, put, ctx } = wireImport()
    await expect(service.importBookmark(ctx, 'pinboard', 'application/json', '{bad')).rejects.toThrow()
    expect(put).not.toHaveBeenCalled()
    expect(repo.createBookmarkImportTask).not.toHaveBeenCalled()
  })

  it('stores input before task creation and dispatches versioned metadata', async () => {
    const { service, repo, put, ctx } = wireImport()
    expect(await service.importBookmark(ctx, 'pinboard', 'application/json', blob)).toBe(42)
    expect(put.mock.invocationCallOrder[0]).toBeLessThan(repo.createBookmarkImportTask.mock.invocationCallOrder[0])
    expect(ctx.env.IMPORT_OTHER.sendBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        body: expect.objectContaining({ version: 1, type: 'pinboard', id: 42, data: [expect.objectContaining({ saved_at: '2020-01-02T03:04:05.000Z', is_archive: true })] })
      })
    ])
  })

  it('does not create a task when storage fails', async () => {
    const { service, repo, put, ctx } = wireImport()
    put.mockRejectedValue(new Error('storage unavailable'))
    await expect(service.importBookmark(ctx, 'pinboard', 'application/json', blob)).rejects.toThrow('storage unavailable')
    expect(repo.createBookmarkImportTask).not.toHaveBeenCalled()
    expect(ctx.env.IMPORT_OTHER.sendBatch).not.toHaveBeenCalled()
  })

  it('records queue dispatch failure on the accepted task', async () => {
    const { service, repo, ctx } = wireImport()
    ctx.env.IMPORT_OTHER.sendBatch.mockRejectedValue(new Error('queue unavailable'))
    await service.importBookmark(ctx, 'pinboard', 'application/json', blob)
    await Promise.all(ctx.execution.waitUntil.mock.calls.map((call: any[]) => call[0]))
    expect(repo.updateBookmarkImportTask).toHaveBeenCalledWith(42, 2, 'Queue dispatch failed')
  })

  it('routes the first 200 records to the fast queue and remaining records to slow', async () => {
    const { service, ctx } = wireImport()
    const many = JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ href: `https://example.com/${i}`, tags: '', toread: 'yes' })))
    await service.importBookmark(ctx, 'pinboard', 'application/json', many)
    await Promise.all(ctx.execution.waitUntil.mock.calls.map((call: any[]) => call[0]))
    expect(ctx.env.IMPORT_OTHER.sendBatch.mock.calls.map((c: any[]) => c[0].length)).toEqual([100, 100])
    expect(ctx.env.IMPORT_OTHER_SLOW.sendBatch.mock.calls[0][0]).toHaveLength(1)
  })

  it('returns the actual encoded task ID and supports preview through the controller', async () => {
    const { service, ctx, repo } = wireImport()
    const controller = Object.create(BookmarkController.prototype) as BookmarkController
    Object.assign(controller, { importService: service })
    const request = () => new Request('https://example.com/v1/bookmark/import?type=pinboard&file_type=application/json', { method: 'POST', body: blob })
    const preview = await controller.handleUserImportPreviewRequest(ctx, request())
    expect(await preview.json()).toMatchObject({ code: 200, data: { eligible_count: 1 } })
    expect(repo.createBookmarkImportTask).not.toHaveBeenCalled()
    const response = await controller.handleUserImportBookmarkRequest(ctx, request())
    expect(await response.json()).toMatchObject({ code: 200, data: { id: 'enc_42' } })
  })
})

describe('bookmark metadata persistence', () => {
  const labService = { assertUrlAllowed: vi.fn().mockResolvedValue(undefined) }

  it('uses current change-log time while preserving the original saved date', async () => {
    const service = Object.create(PublicBookmarkService.prototype) as PublicBookmarkService
    const oldDate = new Date('2020-01-02T03:04:05Z')
    const createBookmarkChangeLog = vi.fn()
    Object.assign(service, {
      bookmarkRepo: {
        createBookmark: vi.fn().mockResolvedValue({ id: 42, status: 'SUCCESS' }),
        createBookmarkRelation: vi.fn().mockResolvedValue({ bookmark_id: 42, created_at: oldDate, deleted_at: null }),
        createBookmarkChangeLog
      },
      bookmarkSearchRepo: { upsertUserBookmark: vi.fn() },
      notifyMessage: { sendBookmarkChange: vi.fn().mockResolvedValue(undefined) },
      searchService: { clearSearchCache: vi.fn() }
    })
    const before = Date.now()
    await service.createBookmarkBase({
      ctx: createMockCtx(),
      targetUrl: 'https://example.com',
      hostUrl: 'example.com',
      title: 'A',
      type: 0,
      importMetadata: { savedAt: oldDate, starred: false }
    })
    expect(createBookmarkChangeLog.mock.calls[0][4].getTime()).toBeGreaterThanOrEqual(before)
  })
  it('uses saved time and stars for new relations without changing an existing relation', async () => {
    const repo = Object.create(BookmarkRepo.prototype) as BookmarkRepo
    const upsert = vi.fn().mockResolvedValue({})
    Object.assign(repo, { prismaPg: () => ({ sr_user_bookmark: { upsert } }) })
    const savedAt = new Date('2020-01-02T03:04:05Z')
    await repo.createBookmarkRelation(1, 42, 0, true, { savedAt, starred: true })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ created_at: savedAt, is_starred: true, archive_status: 1 }), update: {} }))
    await repo.createBookmarkRelation(1, 42, 0, false)
    expect(upsert.mock.calls[1][0].update.created_at).toBeInstanceOf(Date)
  })

  it.each([null, new Date('2024-01-01')])('skips an existing bookmark, including trashed entries (%s)', async deletedAt => {
    const service = Object.create(BookmarkService.prototype) as BookmarkService
    const getUserBookmark = vi.fn().mockResolvedValue({ bookmark_id: 42, deleted_at: deletedAt })
    const createBookmarkBase = vi.fn()
    Object.assign(service, { bookmarkData: { getBookmark: vi.fn().mockResolvedValue({ bookmark_id: 42 }), getUserBookmark }, createBookmarkBase, labService })
    expect(await service.addUrlBookmarkItem(createMockCtx(), { target_url: 'https://example.com/a', tags: [], import_only: true })).toBeNull()
    expect(createBookmarkBase).not.toHaveBeenCalled()
  })

  it('passes new import metadata into creation and crawls archived articles', async () => {
    const service = Object.create(BookmarkService.prototype) as BookmarkService
    const createBookmarkBase = vi.fn().mockResolvedValue({ id: 42, private_user: 1 })
    Object.assign(service, { bookmarkData: { getBookmark: vi.fn().mockResolvedValue(null) }, createBookmarkBase, labService })
    const result = await service.addUrlBookmarkItem(createMockCtx(), {
      target_url: 'https://example.com/a',
      tags: [],
      import_only: true,
      saved_at: '2020-01-02T03:04:05Z',
      is_starred: true,
      is_archive: true
    })
    expect(createBookmarkBase).toHaveBeenCalledWith(expect.objectContaining({ importMetadata: { savedAt: new Date('2020-01-02T03:04:05Z'), starred: true }, isArchive: true }))
    expect(result?.skipParse).toBe(false)
  })

  it.each(['processImportBookmark', 'processImportBookmarkSlow'] as const)('%s completes an existing-bookmark skip without a crawl or rollback relation', async method => {
    const orchestrator = Object.create(ImportOrchestrator.prototype) as ImportOrchestrator
    const is = createMockImportService(),
      bs = createMockBookmarkService(),
      cs = createMockCrawlService()
    is.processImportBookmark.mockResolvedValue([{ target_url: 'https://example.com/a', tags: [], import_only: true }])
    bs.batchAddUrlBookmark.mockResolvedValue([])
    Object.assign(orchestrator, { importService: is, bookmarkService: bs, crawlService: cs })
    await orchestrator[method](createMockCtx(), { id: 1, info: { id: 42, type: 'pinboard', version: 1, data: [{}], idx: 0, userId: 1 } })
    expect(is.incrImportTask).toHaveBeenCalledWith(expect.anything(), 1, 42, 1, 0)
    expect(bs.createBookmarkImportRelation).not.toHaveBeenCalled()
    expect(cs.createWorkflow).not.toHaveBeenCalled()
  })
})
