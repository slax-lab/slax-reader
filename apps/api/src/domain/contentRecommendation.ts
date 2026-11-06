import { inject, injectable } from '../decorators/di'
import { ContentRecommendationRepo, type ArticleRecommendationRow } from '../infra/repository/dbContentRecommendation'
import { VectorMaintenanceService } from './vectorMaintenance'
import type { PreferenceKind } from '../utils/vectorMaintenanceTypes'
import { cosineSimilarity, MMR_CANDIDATES, MMR_LAMBDA, mmrSelect, NATIVE_TOP_K, PREVIEW_MEMBERS } from '../utils/recommendationAlgorithms'

export interface ArticleRecommendationPreview {
  id: number
  sourceUserId: number
  bookmarkUuid: string
  title: string
  url: string
  collectionId: number
}

export interface ArticleRecommendation extends ArticleRecommendationPreview {
  score: number
}

export interface CollectionRecommendation {
  id: number
  code: string
  name: string
  description: string
  score: number
  articles: ArticleRecommendationPreview[]
}

export interface RecommendationResult<T> {
  items: T[]
  preferenceKind: PreferenceKind
  reason?: 'cold_start' | 'no_public_candidates'
}

function articlePreview(row: ArticleRecommendationRow): ArticleRecommendationPreview {
  return { id: row.id, sourceUserId: row.user_id, bookmarkUuid: row.uuid, title: row.title, url: row.target_url, collectionId: row.collection_id }
}

@injectable()
export class ContentRecommendationService {
  constructor(
    @inject(ContentRecommendationRepo) private repo: ContentRecommendationRepo,
    @inject(VectorMaintenanceService) private vectors: VectorMaintenanceService
  ) {}

  async articles(_userId: number, preferenceKind: PreferenceKind = 'article', _limit = 10): Promise<RecommendationResult<ArticleRecommendation>> {
    if (preferenceKind !== 'article') throw new Error('invalid_preference_kind')
    return { items: [], preferenceKind, reason: 'no_public_candidates' }
  }

  async collections(userId: number, preferenceKind: PreferenceKind = 'collection', limit = 10): Promise<RecommendationResult<CollectionRecommendation>> {
    if (preferenceKind !== 'collection') throw new Error('invalid_preference_kind')
    const preference = await this.vectors.readUser(userId, preferenceKind)
    if (!preference?.some(value => value !== 0)) return { items: [], preferenceKind, reason: 'cold_start' }
    const candidates = await this.vectors.queryCollections(preference, { limit: NATIVE_TOP_K })
    const ids = [...new Set(candidates.map(candidate => candidate.id))]
    if (!ids.length) return { items: [], preferenceKind, reason: 'no_public_candidates' }
    const rows = await this.repo.getCollectionCandidates(ids, userId)
    const vectors = await this.vectors.readCollections(rows.map(row => row.id))
    const collections = rows
      .flatMap(row => {
        const vector = vectors.get(row.id)
        return vector ? [{ row, vector, score: cosineSimilarity(preference, vector) }] : []
      })
      .sort((a, b) => b.score - a.score || a.row.id - b.row.id)
      .slice(0, MMR_CANDIDATES)
    if (!collections.length) return { items: [], preferenceKind, reason: 'no_public_candidates' }
    const members = await this.repo.getRecentMembers(
      collections.map(collection => collection.row.id),
      PREVIEW_MEMBERS
    )
    const ranked: { item: CollectionRecommendation; sim1: number; vector: number[] }[] = []
    for (const { row, score, vector } of collections) {
      const recent = members.filter(member => member.collection_id === row.id)
      if (!recent.length) continue
      ranked.push({
        sim1: score,
        vector,
        item: {
          id: row.id,
          code: row.collection_code,
          name: row.display_name,
          description: row.description,
          score,
          articles: recent.map(articlePreview)
        }
      })
    }
    const items = mmrSelect(ranked, limit, MMR_LAMBDA)
    return { items, preferenceKind, ...(!items.length ? { reason: 'no_public_candidates' as const } : {}) }
  }
}
