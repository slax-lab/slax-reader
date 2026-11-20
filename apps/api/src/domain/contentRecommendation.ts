import { compareDiscoveryMembers, rankDiscoveryMembers, TRACE_MEMBER_WINDOW } from '../utils/discoveryRankTrace'
import { discoveryPublicationWindow, discoveryPublishedAt, rankDiscoveryCards, type DiscoveryMember } from '../utils/discoveryCards'
import type { RecommendedCollection } from '@slax-reader/contracts/collections'
import { inject, injectable } from '../decorators/di'
import { ContentRecommendationRepo, type CollectionMemberRow, type CollectionRecommendationRow } from '../infra/repository/dbContentRecommendation'
import { VectorMaintenanceService } from './vectorMaintenance'
import { articleVectorId, type PreferenceKind } from '../utils/vectorMaintenanceTypes'
import { cosineSimilarity, MMR_CANDIDATES, MMR_LAMBDA, mmrSelect, NATIVE_TOP_K, PREVIEW_MEMBERS } from '../utils/recommendationAlgorithms'

export interface ArticleRecommendationPreview {
  id: number
  sourceUserId: number
  bookmarkUuid: string
  title: string
  url: string
  collectionId: number
  selectionReason?: RecommendedCollection['articles'][number]['selectionReason']
}

export interface ArticleRecommendation extends ArticleRecommendationPreview {
  score: number
}

export interface CollectionRecommendation extends RecommendedCollection {
  id: number
  score: number
  articles: Array<ArticleRecommendationPreview & { siteName: string; description: string }>
}

export interface RecommendationResult<T> {
  items: T[]
  preferenceKind: PreferenceKind
  reason?: 'cold_start' | 'no_public_candidates'
}

function articlePreview(row: CollectionMemberRow) {
  return {
    id: row.id,
    sourceUserId: row.user_id,
    bookmarkUuid: row.uuid,
    title: row.title,
    url: row.target_url,
    collectionId: row.collection_id,
    siteName: row.site_name,
    description: row.description
  }
}

function readingPicks(rows: CollectionMemberRow[], vectors: Map<string, number[]>, preference: number[], reason: 'saved_interest' | 'interest', now: number) {
  const window = discoveryPublicationWindow(now)
  const pool = rows
    .map(row => ({
      row,
      uuid: row.uuid,
      url: row.target_url,
      publishedAt: discoveryPublishedAt(row.target_url, row.description, row.published_at),
      vector: vectors.get(articleVectorId({ userId: row.user_id, id: row.id }))
    }))
    .filter(member => {
      const time = new Date(member.publishedAt).getTime()
      return time >= window.from.getTime() && time <= now
    })
  return rankDiscoveryMembers(pool, preference, now)
    .filter(({ member, relevance }) => !member.vector || relevance > 0)
    .map(
      ({ member: { row, publishedAt }, relevance }): DiscoveryMember<CollectionRecommendation['articles'][number]> => ({
        article: { ...articlePreview(row), selectionReason: relevance > 0 ? reason : 'recent' },
        relevance,
        sourceTitle: row.source_title,
        publishedAt,
        wordCount: row.content_word_count
      })
    )
}

type RankedCollection = { item: CollectionRecommendation; sim1: number; vector: number[] }
type TraceCollection = {
  collection: string
  collection_score: number
  baseline_position: number | null
  ranked_position: number | null
  baseline: string[]
  comparison: ReturnType<typeof compareDiscoveryMembers> | null
}
export type RankTrace = { preference: 'saved_articles' | 'subscriptions'; scored_at: string; collections: TraceCollection[] }

function collectionsWithPreviews(collections: { row: CollectionRecommendationRow; vector: number[]; score: number }[], members: CollectionMemberRow[]) {
  const ranked: RankedCollection[] = []
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
        articles: recent.slice(0, PREVIEW_MEMBERS).map(articlePreview)
      }
    })
  }
  return ranked
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

  async collections(
    userId: number,
    preferenceKind: PreferenceKind = 'collection',
    limit = 10,
    observe?: (evaluate: () => Promise<RankTrace>) => void,
    discovery = false
  ): Promise<RecommendationResult<CollectionRecommendation>> {
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
    const now = Date.now()
    const publicationWindow = discovery ? discoveryPublicationWindow(now) : undefined
    const members = await this.repo.getRecentMembers(
      collections.map(collection => collection.row.id),
      discovery ? TRACE_MEMBER_WINDOW : PREVIEW_MEMBERS,
      discovery ? userId : undefined,
      publicationWindow
    )
    const ranked = collectionsWithPreviews(collections, members)
    let items = mmrSelect(ranked, discovery ? ranked.length : limit, MMR_LAMBDA)
    if (observe && items.length) {
      const served = items
      observe(async () => {
        if (!discovery) return this.compareCollections(userId, preference, ranked, served, limit)
        const recent = await this.repo.getRecentMembers(
          collections.map(({ row }) => row.id),
          PREVIEW_MEMBERS
        )
        const legacy = collectionsWithPreviews(collections, recent)
        return this.compareCollections(userId, preference, legacy, mmrSelect(legacy, limit, MMR_LAMBDA), limit)
      })
    }
    if (discovery && items.length) {
      const selectedIds = new Set(items.map(item => item.id))
      const [articlePreference, articleVectors] = await Promise.all([
        this.vectors.readUser(userId, 'article'),
        this.vectors.readArticles(members.map(member => ({ userId: member.user_id, id: member.id })))
      ])
      const visible = await this.repo.getRecentMembers([...selectedIds], TRACE_MEMBER_WINDOW, userId, publicationWindow)
      const cards = items.map(item => {
        const members = readingPicks(
          visible.filter(member => member.collection_id === item.id),
          articleVectors,
          articlePreference ?? preference,
          articlePreference ? 'saved_interest' : 'interest',
          now
        )
        return { collection: item, members }
      })
      items = rankDiscoveryCards(cards, limit, now)
    }
    return { items, preferenceKind, ...(!items.length ? { reason: 'no_public_candidates' as const } : {}) }
  }

  private async compareCollections(userId: number, preference: number[], ranked: RankedCollection[], baseline: CollectionRecommendation[], limit: number): Promise<RankTrace> {
    const pool = await this.repo.getRecentMembers(
      ranked.map(({ item }) => item.id),
      TRACE_MEMBER_WINDOW,
      userId
    )
    const eligible = new Set(pool.map(member => member.collection_id))
    const chosen = mmrSelect(
      ranked.filter(({ item }) => eligible.has(item.id)),
      limit,
      MMR_LAMBDA
    )
    const ids = new Set(chosen.map(item => item.id))
    const pairs = pool.filter(member => ids.has(member.collection_id)).map(member => ({ userId: member.user_id, id: member.id }))
    const [saved, vectors] = await Promise.all([this.vectors.readUser(userId, 'article'), this.vectors.readArticles(pairs)])
    const visible = await this.repo.getRecentMembers([...ids], TRACE_MEMBER_WINDOW, userId)
    const now = Date.now()
    const collections: TraceCollection[] = baseline.map((item, i) => ({
      collection: item.code,
      collection_score: item.score,
      baseline_position: i,
      ranked_position: null,
      baseline: item.articles.map(member => member.bookmarkUuid),
      comparison: null
    }))
    let position = 0
    for (const item of chosen) {
      const members = visible
        .filter(row => row.collection_id === item.id)
        .map(row => ({
          uuid: row.uuid,
          url: row.target_url,
          publishedAt: row.published_at,
          vector: vectors.get(articleVectorId({ userId: row.user_id, id: row.id }))
        }))
      if (!members.length) continue
      const existing = collections.find(row => row.collection === item.code)
      const trace = existing ?? { collection: item.code, collection_score: item.score, baseline_position: null, ranked_position: null, baseline: [], comparison: null }
      trace.ranked_position = position++
      trace.comparison = compareDiscoveryMembers(members, saved ?? preference, preference, now)
      if (!existing) collections.push(trace)
    }
    return { preference: saved ? 'saved_articles' : 'subscriptions', scored_at: new Date(now).toISOString(), collections }
  }
}
