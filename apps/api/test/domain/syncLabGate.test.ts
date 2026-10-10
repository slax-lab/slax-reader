/** Sync acceptance and dispatch must not depend on Labs availability. */
import { describe, expect, test, vi } from 'vitest'
import { SyncOrchestrator } from '@/domain/orchestrator/sync'
import { createMockCtx } from '@test/helpers/mockFactory'

function wire() {
  const labService = { assertUrlAllowed: vi.fn().mockRejectedValue(new Error('Labs is unavailable')) }
  const crawlService = { createWorkflow: vi.fn().mockResolvedValue(undefined) }
  const bookmarkRepo = { updateBookmarkStatus: vi.fn().mockResolvedValue(undefined) }
  const logsService = { track: vi.fn().mockResolvedValue(undefined) }
  const ga4Client = { trackEvent: vi.fn().mockResolvedValue(undefined) }
  const bookmarkSearchRepo = { upsertUserBookmark: vi.fn().mockResolvedValue(undefined) }
  const orchestrator = Object.create(SyncOrchestrator.prototype) as SyncOrchestrator
  Object.assign(orchestrator, { labService, crawlService, bookmarkRepo, logsService, ga4Client, bookmarkSearchRepo, searchService: { clearSearchCache: vi.fn().mockResolvedValue(undefined) } })
  const ctx = createMockCtx({ userId: 7 })
  ctx.env.KV = { delete: vi.fn().mockResolvedValue(undefined) }
  return { orchestrator, ctx, crawlService, bookmarkRepo, logsService, labService }
}

const newBookmark = { bookmarkId: 11, targetUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', userId: 7 }

describe('sendRetryParseEvent without Labs checks', () => {
  test.each([
    'https://arxiv.org/pdf/2608.00046',
    'https://example.com/paper.pdf',
    'https://example.com/download',
    newBookmark.targetUrl,
    'https://example.com/post'
  ])('dispatches %s even when Labs is unavailable', async targetUrl => {
    const { orchestrator, ctx, crawlService, bookmarkRepo, labService } = wire()
    await orchestrator.sendRetryParseEvent(ctx, { ...newBookmark, targetUrl })
    expect(crawlService.createWorkflow).toHaveBeenCalledWith(ctx.env, expect.objectContaining({ bookmarkId: 11, url: targetUrl }), 3, ctx)
    expect(labService.assertUrlAllowed).not.toHaveBeenCalled()
    expect(bookmarkRepo.updateBookmarkStatus).not.toHaveBeenCalled()
  })
})
