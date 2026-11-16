import type { HybridSearchChannel, HybridSearchCoverage, HybridSearchEntity, HybridSearchErrorCode, HybridSearchArticleOrigin } from '@slax-reader/contracts'
import { inject, injectable } from '@/decorators/di'
import { HybridSearchRepo, type SearchTitleCandidate } from '@/infra/repository/dbHybridSearch'
import { BookmarkSearchRepo } from '@/infra/repository/dbBookmarkSearch'
import { VectorEmbeddingClient } from '@/infra/external/vectorEmbedding'
import { VectorMaintenanceService } from './vectorMaintenance'
import { ContextManager } from '@/utils/context'
import { Normalizer } from '@/utils/hybridSearch/normalizer'

export const SEARCH_CANDIDATE_LIMIT = 100
export const SEARCH_FULLTEXT_PAGE_SIZE = 100
export const SEARCH_FULLTEXT_MAX_PAGES = 10

export interface SearchMatch {
  entity: HybridSearchEntity
  nativeScore?: number
}

export interface SearchChannelResult {
  matches: SearchMatch[]
  coverage: HybridSearchCoverage
}

export class HybridSearchError extends Error {
  constructor(public readonly code: HybridSearchErrorCode) {
    super(code)
  }
}

export function compareSearchIdentity(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function searchOriginKey(origin: HybridSearchArticleOrigin): string {
  return origin.kind === 'own' ? `0:${origin.bookmark_user_uuid}` : `1:${origin.collection_id}:${origin.cb_id}`
}

function candidateId(candidate: SearchTitleCandidate): HybridSearchEntity['id'] {
  return `${candidate.type}:${candidate.entity_id}` as HybridSearchEntity['id']
}

function reference(entity: HybridSearchEntity): SearchTitleCandidate {
  switch (entity.type) {
    case 'article':
      return { type: entity.type, entity_id: String(entity.bookmark_id) }
    case 'collection':
      return { type: entity.type, entity_id: String(entity.collection_id) }
    case 'rss_feed':
      return { type: entity.type, entity_id: entity.feed_id }
    case 'rss_entry':
      return { type: entity.type, entity_id: entity.entry_id }
  }
}

@injectable()
export class HybridSearchService {
  constructor(
    @inject(HybridSearchRepo) private repo: HybridSearchRepo,
    @inject(BookmarkSearchRepo) private fulltextRepo: BookmarkSearchRepo,
    @inject(VectorEmbeddingClient) private embedding: VectorEmbeddingClient,
    @inject(VectorMaintenanceService) private vectors: VectorMaintenanceService
  ) {}

  async queryEmbedding(keyword: string, signal: AbortSignal): Promise<number[]> {
    signal.throwIfAborted()
    try {
      return await this.embedding.query(keyword, signal)
    } catch (error) {
      signal.throwIfAborted()
      throw new HybridSearchError(error instanceof Error && error.message === 'embedding_request_timeout' ? 'embedding_timeout' : 'embedding_failed')
    }
  }

  private async admit(userId: number, candidates: SearchTitleCandidate[], signal: AbortSignal): Promise<Map<string, HybridSearchEntity>> {
    signal.throwIfAborted()
    const ids = (type: SearchTitleCandidate['type']) => [...new Set(candidates.filter(candidate => candidate.type === type).map(candidate => candidate.entity_id))]
    const rows = await Promise.allSettled([
      this.repo.articles(userId, ids('article').map(Number)),
      this.repo.collections(userId, ids('collection').map(Number)),
      this.repo.rssFeeds(userId, ids('rss_feed')),
      this.repo.rssEntries(userId, ids('rss_entry'))
    ])
    signal.throwIfAborted()
    const [articles, collections, feeds, entries] = rows
    if (articles.status === 'rejected' || collections.status === 'rejected' || feeds.status === 'rejected' || entries.status === 'rejected')
      throw new HybridSearchError('admission_failed')
    const admitted = new Map<string, HybridSearchEntity>()
    for (const row of articles.value) {
      const id = `article:${row.bookmark_id}` as const
      let entity = admitted.get(id)
      if (!entity || entity.type !== 'article') {
        entity = { type: 'article', id, bookmark_id: row.bookmark_id, title: row.title, target_url: row.target_url, origins: [] }
        admitted.set(id, entity)
      }
      if (row.user_id === userId) {
        entity.origins.push({ kind: 'own', bookmark_user_uuid: row.bookmark_user_uuid, title: row.title })
        entity.title = row.title
      }
      if (row.collection_readable && row.collection_id && row.collection_code) {
        entity.origins.push({
          kind: 'collection',
          collection_id: row.collection_id,
          collection_code: row.collection_code,
          owner_id: row.user_id,
          cb_id: row.cb_id,
          bookmark_uuid: row.bookmark_user_uuid,
          title: row.title
        })
      }
      entity.origins = [...new Map(entity.origins.map(origin => [searchOriginKey(origin), origin])).values()].sort((left, right) =>
        compareSearchIdentity(searchOriginKey(left), searchOriginKey(right))
      )
    }
    for (const row of collections.value) {
      const entity: HybridSearchEntity = { type: 'collection', id: `collection:${row.collection_id}`, ...row }
      admitted.set(entity.id, entity)
    }
    for (const row of feeds.value) {
      const entity: HybridSearchEntity = { type: 'rss_feed', id: `rss_feed:${row.feed_id}`, ...row }
      admitted.set(entity.id, entity)
    }
    for (const row of entries.value) {
      const entity: HybridSearchEntity = { type: 'rss_entry', id: `rss_entry:${row.entry_id}`, ...row }
      admitted.set(entity.id, entity)
    }
    return admitted
  }

  private currentMatches(channel: HybridSearchChannel, matches: SearchMatch[], current: Map<string, HybridSearchEntity>): SearchMatch[] {
    const seen = new Set<string>()
    return matches.flatMap(match => {
      const entity = current.get(match.entity.id)
      if (!entity || seen.has(entity.id)) return []
      if (channel === 'article_vector' && (entity.type !== 'article' || !entity.origins.some(origin => origin.kind === 'own'))) return []
      seen.add(entity.id)
      return [{ ...match, entity: entity.type === 'article' && match.entity.type === 'article' && match.entity.excerpt ? { ...entity, excerpt: match.entity.excerpt } : entity }]
    })
  }

  async revalidate(userId: number, channel: HybridSearchChannel, matches: SearchMatch[], signal: AbortSignal): Promise<SearchMatch[]> {
    return this.currentMatches(
      channel,
      matches,
      await this.admit(
        userId,
        matches.map(match => reference(match.entity)),
        signal
      )
    )
  }

  async revalidateAll(userId: number, channels: Partial<Record<HybridSearchChannel, SearchChannelResult>>, signal: AbortSignal, keyword: string) {
    const candidates = Object.values(channels).flatMap(result => result.matches.map(match => reference(match.entity)))
    const types = ['article', 'collection', 'rss_feed', 'rss_entry'] as const
    const admissions = await Promise.allSettled(
      types.map(type =>
        this.admit(
          userId,
          candidates.filter(candidate => candidate.type === type),
          signal
        )
      )
    )
    signal.throwIfAborted()
    const titleReferences = channels.titles?.matches.map(match => reference(match.entity)) ?? []
    const collectionIds = channels.collection_vector?.matches.flatMap(match => (match.entity.type === 'collection' ? [match.entity.collection_id] : [])) ?? []
    const [titles, collections] = await Promise.allSettled([
      titleReferences.length ? this.repo.titleCandidates(userId, keyword, SEARCH_CANDIDATE_LIMIT, titleReferences) : Promise.resolve([]),
      this.repo.collections(userId, collectionIds, true)
    ])
    signal.throwIfAborted()
    const matchingTitles = new Map(titles.status === 'fulfilled' ? titles.value.map(candidate => [candidateId(candidate), candidate.matched_title]) : [])
    const aggregateIds = new Set(collections.status === 'fulfilled' ? collections.value.map(row => row.collection_id) : [])
    const current = new Map<string, HybridSearchEntity>()
    const failedTypes = new Set<SearchTitleCandidate['type']>()
    for (const [index, admission] of admissions.entries()) {
      if (admission.status === 'rejected') failedTypes.add(types[index])
      else for (const [id, entity] of admission.value) current.set(id, entity)
    }
    return Object.entries(channels).map(([name, result]) => {
      const channel = name as HybridSearchChannel
      if (
        result.matches.some(match => failedTypes.has(match.entity.type)) ||
        (channel === 'titles' && titles.status === 'rejected') ||
        (channel === 'collection_vector' && collections.status === 'rejected')
      )
        return { channel, error: new HybridSearchError('admission_failed') }
      let matches = this.currentMatches(channel, result.matches, current)
      if (channel === 'titles')
        matches = matches.flatMap(match => {
          const title = matchingTitles.get(match.entity.id)
          return title === undefined ? [] : [{ ...match, entity: { ...match.entity, title } }]
        })
      if (channel === 'collection_vector') matches = matches.filter(match => match.entity.type === 'collection' && aggregateIds.has(match.entity.collection_id))
      return { channel, result: { ...result, matches } }
    })
  }

  async titles(userId: number, keyword: string, signal: AbortSignal): Promise<SearchChannelResult> {
    signal.throwIfAborted()
    const candidates = await this.repo.titleCandidates(userId, keyword, SEARCH_CANDIDATE_LIMIT + 1)
    const bounded = candidates.slice(0, SEARCH_CANDIDATE_LIMIT)
    const admitted = await this.admit(userId, bounded, signal)
    signal.throwIfAborted()
    const current = bounded.length ? await this.repo.titleCandidates(userId, keyword, SEARCH_CANDIDATE_LIMIT, bounded) : []
    signal.throwIfAborted()
    const matchingTitles = new Map(current.map(candidate => [candidateId(candidate), candidate.matched_title]))
    const truncated = candidates.length > SEARCH_CANDIDATE_LIMIT
    return {
      matches: bounded.flatMap(candidate => {
        const entity = admitted.get(candidateId(candidate))
        const title = matchingTitles.get(candidateId(candidate))
        return entity && title !== undefined ? [{ entity: { ...entity, title } }] : []
      }),
      coverage: { exhausted: !truncated, truncated, reasons: truncated ? ['candidate_limit'] : [] }
    }
  }

  async fulltext(ctx: ContextManager, keyword: string, signal: AbortSignal): Promise<SearchChannelResult> {
    signal.throwIfAborted()
    const normalizer = new Normalizer(ctx.env)
    const tokens = (await normalizer.cut(keyword, true, { signal, strict: true })) as string[]
    signal.throwIfAborted()
    const terms = [...new Set(tokens.map(token => token.trim()).filter(token => /[\p{L}\p{N}]/u.test(token)))]
    if (!terms.length) return { matches: [], coverage: { exhausted: false, truncated: false, reasons: ['index_only', 'no_searchable_terms'] } }
    const expression = terms.map(term => `"${term.replace(/"/g, '""')}"`).join(' OR ')
    const matches = new Map<string, SearchMatch>()
    let exhausted = false
    let reason: 'candidate_limit' | 'scan_budget' | undefined
    let remainingRows: Awaited<ReturnType<BookmarkSearchRepo['searchCandidatePage']>> = []
    for (let page = 0; page < SEARCH_FULLTEXT_MAX_PAGES; page++) {
      signal.throwIfAborted()
      if (page === 1) {
        remainingRows = await this.fulltextRepo.searchCandidatePage(expression, SEARCH_FULLTEXT_PAGE_SIZE, (SEARCH_FULLTEXT_MAX_PAGES - 1) * SEARCH_FULLTEXT_PAGE_SIZE + 1)
      }
      const offset = (page - 1) * SEARCH_FULLTEXT_PAGE_SIZE
      const rows =
        page === 0 ? await this.fulltextRepo.searchCandidatePage(expression, 0, SEARCH_FULLTEXT_PAGE_SIZE + 1) : remainingRows.slice(offset, offset + SEARCH_FULLTEXT_PAGE_SIZE + 1)
      signal.throwIfAborted()
      exhausted = rows.length <= SEARCH_FULLTEXT_PAGE_SIZE
      const candidates = rows.slice(0, SEARCH_FULLTEXT_PAGE_SIZE)
      const admitted = await this.admit(
        ctx.getUserId(),
        candidates.map(row => ({ type: 'article', entity_id: String(row.bookmark_id) })),
        signal
      )
      for (const row of candidates) {
        if (!Number.isFinite(row.score)) throw new HybridSearchError('retrieval_failed')
        const entity = admitted.get(`article:${row.bookmark_id}`)
        if (!entity || entity.type !== 'article' || matches.has(entity.id)) continue
        matches.set(entity.id, { entity: { ...entity, excerpt: { text: row.excerpt, source: 'indexed_text' } }, nativeScore: row.score })
      }
      if (matches.size >= SEARCH_CANDIDATE_LIMIT) {
        if (!exhausted || matches.size > SEARCH_CANDIDATE_LIMIT) reason = 'candidate_limit'
        break
      }
      if (exhausted) break
      if (page + 1 === SEARCH_FULLTEXT_MAX_PAGES) reason = 'scan_budget'
    }
    return {
      matches: await this.revalidate(ctx.getUserId(), 'fulltext', [...matches.values()].slice(0, SEARCH_CANDIDATE_LIMIT), signal),
      coverage: { exhausted, truncated: !!reason, reasons: ['index_only', ...(reason ? [reason] : [])] }
    }
  }

  async articleVector(userId: number, vector: number[], signal: AbortSignal): Promise<SearchChannelResult> {
    signal.throwIfAborted()
    const candidates = await this.vectors.queryArticles(vector, { userId, limit: SEARCH_CANDIDATE_LIMIT })
    signal.throwIfAborted()
    const owned = candidates.filter(candidate => candidate.userId === userId)
    const admitted = await this.admit(
      userId,
      owned.map(candidate => ({ type: 'article', entity_id: String(candidate.id) })),
      signal
    )
    return {
      matches: owned
        .sort((a, b) => b.score - a.score || compareSearchIdentity(`article:${a.id}`, `article:${b.id}`))
        .flatMap(candidate => {
          const entity = admitted.get(`article:${candidate.id}`)
          return entity?.type === 'article' && entity.origins.some(origin => origin.kind === 'own') ? [{ entity, nativeScore: candidate.score }] : []
        }),
      coverage: this.vectorCoverage(candidates.length)
    }
  }

  async collectionVector(userId: number, vector: number[], signal: AbortSignal): Promise<SearchChannelResult> {
    signal.throwIfAborted()
    const candidates = await this.vectors.queryCollections(vector, { limit: SEARCH_CANDIDATE_LIMIT })
    signal.throwIfAborted()
    const rows = await this.repo.collections(
      userId,
      candidates.map(candidate => candidate.id),
      true
    )
    signal.throwIfAborted()
    const admitted = new Map<string, HybridSearchEntity>(
      rows.map(row => [`collection:${row.collection_id}`, { type: 'collection', id: `collection:${row.collection_id}`, ...row }])
    )
    return {
      matches: candidates
        .sort((a, b) => b.score - a.score || compareSearchIdentity(`collection:${a.id}`, `collection:${b.id}`))
        .flatMap(candidate => {
          const entity = admitted.get(`collection:${candidate.id}`)
          return entity ? [{ entity, nativeScore: candidate.score }] : []
        }),
      coverage: this.vectorCoverage(candidates.length)
    }
  }

  private vectorCoverage(count: number): HybridSearchCoverage {
    const truncated = count >= SEARCH_CANDIDATE_LIMIT
    return { exhausted: !truncated, truncated, reasons: ['index_only', ...(truncated ? ['candidate_limit' as const] : [])] }
  }
}
