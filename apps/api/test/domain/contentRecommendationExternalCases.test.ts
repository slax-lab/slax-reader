// External reference cases adapted from recommenders-team/recommenders (MIT, commit 51c7f64b4b8ed90e7f734bca21f3f8c55f035430,
// tests/unit/recommenders/evaluation/test_python_evaluation.py SHA256 a31a6f8f2d4061bec11eeace1c4cb773a760fe2f230e4c26ffd3443f04d1d6f1)
// and MIND evaluate.py (commit 57536bbdbc9b421060e46d74cd191eacc32b7fb0 SHA256 c6195008ed19ba7e68145069cffbdbcc0582ff0e983e2a5966095274043cc2ca; no declared repo license, metric reference only).
// The former production-ranker cases are superseded by the paused article feed; the pure ranking
// algorithms remain covered by test/utils/recommendationAlgorithms.test.ts and its reference helper.

import { describe, expect, test, vi } from 'vitest'
import { ContentRecommendationService } from '../../src/domain/contentRecommendation'
import type { ContentRecommendationRepo } from '../../src/infra/repository/dbContentRecommendation'
import type { VectorMaintenanceService } from '../../src/domain/vectorMaintenance'

function dependencies() {
  const repository = {
    getArticleCandidates: vi.fn(),
    getLatestCandidates: vi.fn(),
    getPopularCandidates: vi.fn(),
    getCollectionCandidates: vi.fn(),
    getRecentMembers: vi.fn()
  }
  const vectors = {
    readArticleProfile: vi.fn(),
    queryArticles: vi.fn(),
    readArticles: vi.fn(),
    readUser: vi.fn(),
    queryCollections: vi.fn(),
    readCollections: vi.fn(),
    refreshArticles: vi.fn(),
    refreshCollection: vi.fn(),
    refreshUser: vi.fn(),
    verifyRefresh: vi.fn()
  }
  return { repository, vectors }
}

describe('paused article feed', () => {
  test.each([1, 10, 50])('returns the same explicit empty feed for limit %i', async limit => {
    const { repository, vectors } = dependencies()
    const service = new ContentRecommendationService(repository as unknown as ContentRecommendationRepo, vectors as unknown as VectorMaintenanceService)
    await expect(service.articles(1, 'article', limit)).resolves.toEqual({ items: [], preferenceKind: 'article', reason: 'no_public_candidates' })
  })

  test('does not consult preferences, ANN, SQL channels, hydration or model dependencies', async () => {
    const { repository, vectors } = dependencies()
    const service = new ContentRecommendationService(repository as unknown as ContentRecommendationRepo, vectors as unknown as VectorMaintenanceService)
    await service.articles(7)
    for (const call of Object.values(vectors)) expect(call).not.toHaveBeenCalled()
    for (const call of Object.values(repository)) expect(call).not.toHaveBeenCalled()
  })

  test('rejects a mismatched preference kind before touching any dependency', async () => {
    const { repository, vectors } = dependencies()
    const service = new ContentRecommendationService(repository as unknown as ContentRecommendationRepo, vectors as unknown as VectorMaintenanceService)
    await expect(service.articles(1, 'collection')).rejects.toThrow('invalid_preference_kind')
    for (const call of Object.values(vectors)) expect(call).not.toHaveBeenCalled()
    for (const call of Object.values(repository)) expect(call).not.toHaveBeenCalled()
  })
})
