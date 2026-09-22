/**
 * PowerSync path: the client already wrote the bookmark row, so a gated URL is marked
 * failed instead of crawled.
 * 来源: src/domain/orchestrator/sync.ts sendRetryParseEvent
 */
import { describe, expect, test, vi } from 'vitest'
import { SyncOrchestrator } from '@/domain/orchestrator/sync'
import { LabService } from '@/domain/lab'
import { queueStatus } from '@/infra/repository/dbBookmark'
import { createMockCtx } from '@test/helpers/mockFactory'

function wire(enabled: boolean) {
  const labRepo = { listByUser: vi.fn(), isEnabled: vi.fn().mockResolvedValue(enabled), upsert: vi.fn() }
  const labService = new (LabService as any)(labRepo) as LabService
  const crawlService = { createWorkflow: vi.fn().mockResolvedValue(undefined) }
  const bookmarkRepo = { updateBookmarkStatus: vi.fn().mockResolvedValue(undefined) }
  const logsService = { track: vi.fn().mockResolvedValue(undefined) }
  const ga4Client = { trackEvent: vi.fn().mockResolvedValue(undefined) }
  const bookmarkSearchRepo = { upsertUserBookmark: vi.fn().mockResolvedValue(undefined) }
  const orchestrator = Object.create(SyncOrchestrator.prototype) as SyncOrchestrator
  Object.assign(orchestrator, { labService, crawlService, bookmarkRepo, logsService, ga4Client, bookmarkSearchRepo, searchService: { clearSearchCache: vi.fn().mockResolvedValue(undefined) } })
  const ctx = createMockCtx({ userId: 7 })
  ctx.env.KV = { delete: vi.fn().mockResolvedValue(undefined) }
  return { orchestrator, ctx, crawlService, bookmarkRepo, logsService }
}

const newBookmark = { bookmarkId: 11, targetUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', userId: 7 }

describe('sendRetryParseEvent', () => {
  test('switch off → no workflow, bookmark marked FAILED', async () => {
    const { orchestrator, ctx, crawlService, bookmarkRepo, logsService } = wire(false)
    await orchestrator.sendRetryParseEvent(ctx, newBookmark)
    expect(crawlService.createWorkflow).not.toHaveBeenCalled()
    expect(bookmarkRepo.updateBookmarkStatus).toHaveBeenCalledWith(11, queueStatus.FAILED)
    expect(logsService.track).toHaveBeenCalledWith(7, 'bookmark_add', expect.objectContaining({ status: 'lab_disabled' }))
  })

  test('switch on → workflow starts as before', async () => {
    const { orchestrator, ctx, crawlService, bookmarkRepo } = wire(true)
    await orchestrator.sendRetryParseEvent(ctx, newBookmark)
    expect(crawlService.createWorkflow).toHaveBeenCalledWith(ctx.env, expect.objectContaining({ bookmarkId: 11, url: newBookmark.targetUrl }), 3, ctx)
    expect(bookmarkRepo.updateBookmarkStatus).not.toHaveBeenCalled()
  })

  test('ordinary article is never gated', async () => {
    const { orchestrator, ctx, crawlService } = wire(false)
    await orchestrator.sendRetryParseEvent(ctx, { ...newBookmark, targetUrl: 'https://example.com/post' })
    expect(crawlService.createWorkflow).toHaveBeenCalled()
  })
})
