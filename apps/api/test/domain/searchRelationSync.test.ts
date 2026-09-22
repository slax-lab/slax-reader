import { describe, expect, test, vi } from 'vitest'
import { SyncOrchestrator } from '@/domain/orchestrator/sync'
import { VectorizeRepo } from '@/infra/repository/dbVectorize'

function createCtx(userId = 7) {
  return {
    getUserId: () => userId,
    getEncodeUserId: () => 123,
    getlang: () => 'en',
    execution: { waitUntil: vi.fn() },
    env: { KV: { delete: vi.fn().mockResolvedValue(undefined) } }
  }
}

describe('search relation sync', () => {
  test('PowerSync bookmark creation writes the search relation and clears caches', async () => {
    const bookmarkSearchRepo = { upsertUserBookmark: vi.fn().mockResolvedValue(undefined) }
    const searchService = { clearSearchCache: vi.fn().mockResolvedValue(undefined) }
    const orchestrator = Object.create(SyncOrchestrator.prototype) as SyncOrchestrator
    Object.assign(orchestrator, {
      bookmarkSearchRepo,
      searchService,
      labService: { assertUrlAllowed: vi.fn().mockResolvedValue(undefined) },
      crawlService: { createWorkflow: vi.fn().mockResolvedValue(undefined) },
      ga4Client: { trackEvent: vi.fn().mockResolvedValue(undefined) },
      logsService: { track: vi.fn().mockResolvedValue(undefined) }
    })
    const ctx = createCtx()

    await orchestrator.sendRetryParseEvent(ctx as never, { bookmarkId: 11, targetUrl: 'https://example.com', userId: 7 })

    expect(bookmarkSearchRepo.upsertUserBookmark).toHaveBeenCalledWith(7, 11)
    expect(searchService.clearSearchCache).toHaveBeenCalledWith(ctx, 7)
  })

})

describe('vector search filters', () => {
  test('splits Vectorize $in filters into batches of at most 100 ids', async () => {
    const query = vi.fn().mockResolvedValue({ matches: [] })
    const repo = new VectorizeRepo((() => [{ query }]) as never)

    await repo.seachVector([0.1], Array.from({ length: 205 }, (_, index) => index + 1), 0)

    expect(query).toHaveBeenCalledTimes(3)
    for (const [, options] of query.mock.calls) {
      expect(options.filter.bookmark_id.$in.length).toBeLessThanOrEqual(100)
    }
  })
})
