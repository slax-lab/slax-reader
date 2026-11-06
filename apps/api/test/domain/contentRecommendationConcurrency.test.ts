import { describe, expect, test, vi } from 'vitest'
import { ContentRecommendationService } from '../../src/domain/contentRecommendation'
import type { ContentRecommendationRepo } from '../../src/infra/repository/dbContentRecommendation'
import type { VectorMaintenanceService } from '../../src/domain/vectorMaintenance'

// Article ranking is paused: the previous deferred-promise concurrency proof is superseded by
// the requirement that no retrieval wave, hydration or model work starts at all.

function never<T>() {
  return vi.fn(() => new Promise<T>(() => undefined))
}

function dependencies() {
  const repository = {
    getArticleCandidates: never(),
    getLatestCandidates: never(),
    getPopularCandidates: never(),
    getCollectionCandidates: never(),
    getRecentMembers: never()
  }
  const vectors = {
    readArticleProfile: never(),
    queryArticles: never(),
    readArticles: never(),
    readUser: never(),
    queryCollections: never(),
    readCollections: never(),
    refreshArticles: vi.fn(),
    refreshCollection: vi.fn(),
    refreshUser: vi.fn(),
    verifyRefresh: vi.fn()
  }
  return { repository, vectors }
}

describe('paused article feed', () => {
  test('settles immediately without starting any pending retrieval or hydration channel', async () => {
    const { repository, vectors } = dependencies()
    const service = new ContentRecommendationService(repository as unknown as ContentRecommendationRepo, vectors as unknown as VectorMaintenanceService)
    const result = await service.articles(1, 'article', 10)
    expect(result).toEqual({ items: [], preferenceKind: 'article', reason: 'no_public_candidates' })
    for (const call of Object.values(repository)) expect(call).not.toHaveBeenCalled()
    for (const call of Object.values(vectors)) expect(call).not.toHaveBeenCalled()
  })

  test('a mismatched preference kind fails before any deferred dependency is touched', async () => {
    const { repository, vectors } = dependencies()
    const service = new ContentRecommendationService(repository as unknown as ContentRecommendationRepo, vectors as unknown as VectorMaintenanceService)
    await expect(service.articles(1, 'collection', 10)).rejects.toThrow('invalid_preference_kind')
    for (const call of Object.values(repository)) expect(call).not.toHaveBeenCalled()
    for (const call of Object.values(vectors)) expect(call).not.toHaveBeenCalled()
  })
})
