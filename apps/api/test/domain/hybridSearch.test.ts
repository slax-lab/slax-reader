import { describe, expect, test, vi } from 'vitest'
import {
  HybridSearchError,
  HybridSearchService,
  compareSearchIdentity,
  searchOriginKey,
  type SearchChannelResult,
  type SearchMatch
} from '../../src/domain/hybridSearch'
import type { HybridSearchRepo, SearchArticleRow } from '../../src/infra/repository/dbHybridSearch'
import type { BookmarkSearchRepo } from '../../src/infra/repository/dbBookmarkSearch'
import type { VectorEmbeddingClient } from '../../src/infra/external/vectorEmbedding'
import type { VectorMaintenanceService } from '../../src/domain/vectorMaintenance'
import type { ContextManager } from '../../src/utils/context'
import type { HybridSearchArticleOrigin, HybridSearchEntity } from '@slax-reader/contracts'

const USER = 7
const unit = (axis = 0) => Array.from({ length: 1024 }, (_, index) => (index === axis ? 1 : 0))

function articleRow(overrides: Partial<SearchArticleRow> = {}): SearchArticleRow {
  return {
    bookmark_id: 10,
    user_id: USER,
    bookmark_user_uuid: 'own-uuid',
    cb_id: 77,
    title: 'Own title',
    target_url: 'https://example.com/10',
    collection_id: null,
    collection_code: null,
    collection_readable: false,
    ...overrides
  }
}

function dependencies() {
  const repo = {
    titleCandidates: vi.fn(async () => [] as Array<{ type: 'article' | 'collection' | 'rss_feed' | 'rss_entry'; entity_id: string }>),
    articles: vi.fn(async () => [] as SearchArticleRow[]),
    collections: vi.fn(async () => [] as Array<{ collection_id: number; collection_code: string; owner_id: number; title: string }>),
    rssFeeds: vi.fn(async () => [] as Array<{ feed_id: string; subscription_id: string; title: string }>),
    rssEntries: vi.fn(async () => [] as Array<{ entry_id: string; feed_id: string; subscription_id: string; title: string; source_title: string; article_url: string | null }>)
  }
  const fulltextRepo = { searchCandidatePage: vi.fn(async () => [] as Array<{ row_id: number; bookmark_id: number; score: number; excerpt: string }>) }
  const embedding = { query: vi.fn(async () => unit()) }
  const vectors = {
    queryArticles: vi.fn(async () => [] as Array<{ userId: number; id: number; score: number }>),
    queryCollections: vi.fn(async () => [] as Array<{ id: number; score: number }>)
  }
  const service = new HybridSearchService(repo as unknown as HybridSearchRepo, fulltextRepo as unknown as BookmarkSearchRepo, embedding as unknown as VectorEmbeddingClient, vectors as unknown as VectorMaintenanceService)
  return { repo, fulltextRepo, embedding, vectors, service }
}

function ctx(tokens: string[] = ['reader']) {
  const fetch = vi.fn(async () => Response.json({ data: tokens }))
  return {
    ctx: {
      env: { SLAX_JIEBA: { idFromName: vi.fn(() => 'jieba-id'), get: vi.fn(() => ({ fetch })) } },
      getUserId: () => USER
    } as unknown as ContextManager,
    fetch
  }
}

const articleCandidate = (id: number, title = `Article ${id}`) => ({ type: 'article' as const, entity_id: String(id), matched_title: title })
const collectionCandidate = (id: number, title = `Collection ${id}`) => ({ type: 'collection' as const, entity_id: String(id), matched_title: title })

describe('search identity helpers', () => {
  test('orders typed identities lexically and independently of arrival order', () => {
    expect(compareSearchIdentity('article:10', 'article:9')).toBe(-1)
    expect(compareSearchIdentity('collection:2', 'collection:2')).toBe(0)
    expect(compareSearchIdentity('rss_entry:10', 'rss_feed:9')).toBe(-1)
  })

  test('keeps own and Collection origins distinct, with own ordering first', () => {
    const own: HybridSearchArticleOrigin = { kind: 'own', bookmark_user_uuid: 'uuid-a', title: 'Own' }
    const collection: HybridSearchArticleOrigin = { kind: 'collection', collection_id: 30, collection_code: 'code', owner_id: 8, cb_id: 77, bookmark_uuid: 'owner-uuid', title: 'Shared' }
    expect(searchOriginKey(own)).toBe('0:uuid-a')
    expect(searchOriginKey(collection)).toBe('1:30:77')
    expect(searchOriginKey(own)).not.toBe(searchOriginKey({ ...own, bookmark_user_uuid: 'uuid-b' }))
  })
})

describe('queryEmbedding', () => {
  test('returns the embedding and forwards the abort signal', async () => {
    const { embedding, service } = dependencies()
    const controller = new AbortController()
    embedding.query.mockResolvedValueOnce(unit(2))
    await expect(service.queryEmbedding('reader', controller.signal)).resolves.toEqual(unit(2))
    expect(embedding.query).toHaveBeenCalledExactlyOnceWith('reader', controller.signal)
  })

  test('maps provider timeout and other failures to explicit channel codes', async () => {
    const { embedding, service } = dependencies()
    embedding.query.mockRejectedValueOnce(new Error('embedding_request_timeout'))
    await expect(service.queryEmbedding('reader', new AbortController().signal)).rejects.toMatchObject({ code: 'embedding_timeout' })
    embedding.query.mockRejectedValueOnce(new Error('transport down'))
    await expect(service.queryEmbedding('reader', new AbortController().signal)).rejects.toMatchObject({ code: 'embedding_failed' })
    expect(HybridSearchError.prototype).toBeInstanceOf(Error)
  })

  test('an aborted signal wins over a provider failure', async () => {
    const { embedding, service } = dependencies()
    const controller = new AbortController()
    controller.abort()
    embedding.query.mockRejectedValueOnce(new Error('embedding_request_timeout'))
    await expect(service.queryEmbedding('reader', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('titles channel', () => {
  test('bounds candidates to one hundred and reports candidate truncation', async () => {
    const { repo, service } = dependencies()
    repo.titleCandidates.mockResolvedValue(Array.from({ length: 101 }, (_, index) => articleCandidate(index + 1)))
    const { ctx: context } = ctx()
    const result = await service.titles(USER, 'reader', new AbortController().signal)
    expect(repo.titleCandidates).toHaveBeenNthCalledWith(1, USER, 'reader', 101)
    expect(repo.titleCandidates).toHaveBeenNthCalledWith(2, USER, 'reader', 100, expect.any(Array))
    expect(repo.titleCandidates.mock.calls[1][3]).toHaveLength(100)
    expect(repo.articles.mock.calls[0][1]).toHaveLength(100)
    expect(result.coverage).toEqual({ exhausted: false, truncated: true, reasons: ['candidate_limit'] })
    expect(context.getUserId()).toBe(USER)
  })

  test('builds own and readable Collection origins, with the Collection relation cb_id and alias title', async () => {
    const { repo, service } = dependencies()
    repo.titleCandidates.mockResolvedValue([articleCandidate(10, 'Own alias')])
    repo.articles.mockResolvedValue([
      articleRow({ user_id: USER, bookmark_user_uuid: 'own-uuid', title: 'Own alias', cb_id: 77 }),
      articleRow({ user_id: 8, bookmark_user_uuid: 'owner-uuid', title: 'Owner alias', cb_id: 88, collection_id: 30, collection_code: 'code', collection_readable: true })
    ])
    const result = await service.titles(USER, 'reader', new AbortController().signal)
    expect(result.matches).toHaveLength(1)
    const entity = result.matches[0].entity
    expect(entity.type).toBe('article')
    if (entity.type !== 'article') return
    expect(entity.origins).toEqual([
      { kind: 'own', bookmark_user_uuid: 'own-uuid', title: 'Own alias' },
      { kind: 'collection', collection_id: 30, collection_code: 'code', owner_id: 8, cb_id: 88, bookmark_uuid: 'owner-uuid', title: 'Owner alias' }
    ])
    expect(result.coverage).toEqual({ exhausted: true, truncated: false, reasons: [] })
  })

  test('keeps a readable Collection origin when the viewer has no own save', async () => {
    const { repo, service } = dependencies()
    repo.titleCandidates.mockResolvedValue([articleCandidate(10, 'Own alias')])
    repo.articles.mockResolvedValue([
      articleRow({ user_id: 8, bookmark_user_uuid: 'owner-uuid', title: 'Owner alias', cb_id: 88, collection_id: 30, collection_code: 'code', collection_readable: true })
    ])
    const result = await service.titles(USER, 'reader', new AbortController().signal)
    expect(result.matches.map(match => match.entity.id)).toEqual(['article:10'])
    const entity = result.matches[0].entity
    expect(entity.type === 'article' && entity.origins).toEqual([
      { kind: 'collection', collection_id: 30, collection_code: 'code', owner_id: 8, cb_id: 88, bookmark_uuid: 'owner-uuid', title: 'Owner alias' }
    ])
  })

  test('maps Collection, RSS feed and RSS entry candidates to typed entities and keeps feed/subscription ids distinct', async () => {
    const { repo, service } = dependencies()
    repo.titleCandidates.mockResolvedValue([
      collectionCandidate(30, 'Collection subject'),
      { type: 'rss_feed', entity_id: 'feed-1', matched_title: 'Feed alias' },
      { type: 'rss_entry', entity_id: 'entry-1', matched_title: 'Entry' }
    ])
    repo.collections.mockResolvedValue([{ collection_id: 30, collection_code: 'code', owner_id: 8, title: 'Collection subject' }])
    repo.rssFeeds.mockResolvedValue([{ feed_id: 'feed-1', subscription_id: 'sub-1', title: 'Feed alias' }])
    repo.rssEntries.mockResolvedValue([{ entry_id: 'entry-1', feed_id: 'feed-1', subscription_id: 'sub-1', title: 'Entry', source_title: 'Feed alias', article_url: 'https://example.com/e' }])
    const result = await service.titles(USER, 'reader', new AbortController().signal)
    expect(result.matches.map(match => match.entity)).toEqual([
      { type: 'collection', id: 'collection:30', collection_id: 30, collection_code: 'code', owner_id: 8, title: 'Collection subject' },
      { type: 'rss_feed', id: 'rss_feed:feed-1', feed_id: 'feed-1', subscription_id: 'sub-1', title: 'Feed alias' },
      { type: 'rss_entry', id: 'rss_entry:entry-1', entry_id: 'entry-1', feed_id: 'feed-1', subscription_id: 'sub-1', title: 'Entry', source_title: 'Feed alias', article_url: 'https://example.com/e' }
    ])
    expect(result.matches.some(match => match.entity.type === 'article')).toBe(false)
  })

  test('uses the matched alias title and drops a title hit when the alias no longer matches', async () => {
    const { repo, service } = dependencies()
    repo.articles.mockResolvedValue([articleRow({ title: 'Stored title' })])
    repo.titleCandidates.mockResolvedValueOnce([articleCandidate(10, 'Original alias')]).mockResolvedValueOnce([articleCandidate(10, 'Renamed alias')])
    const renamed = await service.titles(USER, 'reader', new AbortController().signal)
    expect(renamed.matches[0].entity.title).toBe('Renamed alias')

    repo.titleCandidates.mockResolvedValueOnce([articleCandidate(10, 'Stored title')]).mockResolvedValueOnce([])
    const removed = await service.titles(USER, 'reader', new AbortController().signal)
    expect(removed.matches).toEqual([])
  })

  test('the RSS lab boundary is enforced by the repository, so no rows means no RSS entities', async () => {
    const { repo, service } = dependencies()
    repo.titleCandidates.mockResolvedValue([{ type: 'rss_feed', entity_id: 'feed-1' }])
    repo.rssFeeds.mockResolvedValue([])
    const result = await service.titles(USER, 'reader', new AbortController().signal)
    expect(result.matches).toEqual([])
    expect(repo.rssFeeds).toHaveBeenCalledOnce()
  })

  test('a whole admission failure is explicit rather than an empty success', async () => {
    const { repo, service } = dependencies()
    repo.titleCandidates.mockResolvedValue([articleCandidate(10, 'Own alias')])
    repo.articles.mockRejectedValue(new Error('admission down'))
    await expect(service.titles(USER, 'reader', new AbortController().signal)).rejects.toMatchObject({ code: 'admission_failed' })
  })
})

describe('fulltext channel', () => {
  const pageRow = (bookmarkId: number, score = 0.5, excerpt = 'excerpt') => ({ row_id: bookmarkId * 10, bookmark_id: bookmarkId, score, excerpt })

  test('uses one page of 101 rows in the FTS expression and dedupes repeated bookmarks', async () => {
    const { repo, fulltextRepo, service } = dependencies()
    const { ctx: context } = ctx(['reader', 'search', 'reader'])
    fulltextRepo.searchCandidatePage.mockResolvedValue([pageRow(10), pageRow(10), pageRow(11)])
    repo.articles.mockImplementation(async (_userId: number, ids: number[]) => ids.map(id => articleRow({ bookmark_id: id, title: `Title ${id}` })))
    const result = await service.fulltext(context, 'reader search', new AbortController().signal)
    expect(fulltextRepo.searchCandidatePage).toHaveBeenCalledExactlyOnceWith('"reader" OR "search"', 0, 101)
    expect(result.matches.map(match => match.entity.id)).toEqual(['article:10', 'article:11'])
    expect(result.matches[0].entity.type === 'article' && result.matches[0].entity.excerpt).toEqual({ text: 'excerpt', source: 'indexed_text' })
    expect(result.coverage).toEqual({ exhausted: true, truncated: false, reasons: ['index_only'] })
  })

  test('continues past a full inaccessible page and admits an eligible bookmark on the next page', async () => {
    const { repo, fulltextRepo, service } = dependencies()
    const { ctx: context } = ctx()
    fulltextRepo.searchCandidatePage
      .mockResolvedValueOnce(Array.from({ length: 101 }, () => pageRow(10)))
      .mockResolvedValueOnce([pageRow(11)])
    repo.articles.mockImplementation(async (_userId: number, ids: number[]) =>
      ids.includes(11) ? [articleRow({ bookmark_id: 11 })] : []
    )
    const result = await service.fulltext(context, 'reader', new AbortController().signal)
    expect(fulltextRepo.searchCandidatePage).toHaveBeenCalledTimes(2)
    expect(result.matches.map(match => match.entity.id)).toEqual(['article:11'])
    expect(result.coverage).toEqual({ exhausted: true, truncated: false, reasons: ['index_only'] })
  })

  test('an admission failure on a page fails the whole channel explicitly', async () => {
    const { repo, fulltextRepo, service } = dependencies()
    const { ctx: context } = ctx()
    fulltextRepo.searchCandidatePage.mockResolvedValue([pageRow(10)])
    repo.articles.mockRejectedValue(new Error('admission unavailable'))
    await expect(service.fulltext(context, 'reader', new AbortController().signal)).rejects.toMatchObject({ code: 'admission_failed' })
  })

  test('stops at one hundred admitted matches as a candidate limit, not a scan budget', async () => {
    const { repo, fulltextRepo, service } = dependencies()
    const { ctx: context } = ctx()
    fulltextRepo.searchCandidatePage.mockResolvedValue(Array.from({ length: 101 }, (_, index) => pageRow(index + 1)))
    repo.articles.mockImplementation(async (_userId: number, ids: number[]) => ids.map(id => articleRow({ bookmark_id: id })))
    const result = await service.fulltext(context, 'reader', new AbortController().signal)
    expect(result.matches).toHaveLength(100)
    expect(fulltextRepo.searchCandidatePage).toHaveBeenCalledTimes(1)
    expect(result.coverage).toEqual({ exhausted: false, truncated: true, reasons: ['index_only', 'candidate_limit'] })
  })

  test('exhausts ten pages of unrepeatable candidates as an incomplete scan budget', async () => {
    const { repo, fulltextRepo, service } = dependencies()
    const { ctx: context } = ctx()
    fulltextRepo.searchCandidatePage.mockResolvedValue(Array.from({ length: 101 }, () => pageRow(10)))
    repo.articles.mockImplementation(async (_userId: number, ids: number[]) => ids.map(id => articleRow({ bookmark_id: id })))
    const result = await service.fulltext(context, 'reader', new AbortController().signal)
    expect(fulltextRepo.searchCandidatePage).toHaveBeenCalledTimes(10)
    expect(fulltextRepo.searchCandidatePage.mock.calls.map((call: unknown[]) => call[1])).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900])
    expect(result.matches).toHaveLength(1)
    expect(result.coverage).toEqual({ exhausted: false, truncated: true, reasons: ['index_only', 'scan_budget'] })
  })

  test('does not request another page after abort', async () => {
    const { repo, fulltextRepo, service } = dependencies()
    const { ctx: context } = ctx()
    const controller = new AbortController()
    fulltextRepo.searchCandidatePage.mockImplementation(async () => {
      controller.abort()
      return [pageRow(10)]
    })
    repo.articles.mockResolvedValue([articleRow()])
    await expect(service.fulltext(context, 'reader', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fulltextRepo.searchCandidatePage).toHaveBeenCalledTimes(1)
  })

  test('no searchable tokens is index-only, not an exhausted full-text scan', async () => {
    const { fulltextRepo, service } = dependencies()
    const { ctx: context } = ctx(['...', '   ', '"'])
    const result = await service.fulltext(context, '...', new AbortController().signal)
    expect(fulltextRepo.searchCandidatePage).not.toHaveBeenCalled()
    expect(result.coverage).toEqual({ exhausted: false, truncated: false, reasons: ['index_only', 'no_searchable_terms'] })
  })

  test('a non-finite native score fails the channel explicitly', async () => {
    const { repo, fulltextRepo, service } = dependencies()
    const { ctx: context } = ctx()
    fulltextRepo.searchCandidatePage.mockResolvedValue([pageRow(10, NaN)])
    repo.articles.mockResolvedValue([articleRow()])
    await expect(service.fulltext(context, 'reader', new AbortController().signal)).rejects.toMatchObject({ code: 'retrieval_failed' })
  })
})

describe('article vector channel', () => {
  test('queries the lower layer with owner and limit, checks candidate userId and sorts by score then identity', async () => {
    const { repo, vectors, service } = dependencies()
    vectors.queryArticles.mockResolvedValue([
      { userId: USER, id: 12, score: 0.9 },
      { userId: 8, id: 99, score: 1 },
      { userId: USER, id: 11, score: 0.9 }
    ])
    repo.articles.mockImplementation(async (_userId: number, ids: number[]) => ids.map(id => articleRow({ bookmark_id: id })))
    const result = await service.articleVector(USER, unit(3), new AbortController().signal)
    expect(vectors.queryArticles).toHaveBeenCalledExactlyOnceWith(unit(3), { userId: USER, limit: 100 })
    expect(result.matches.map(match => match.entity.id)).toEqual(['article:11', 'article:12'])
    expect(result.matches.every(match => match.nativeScore === 0.9)).toBe(true)
    expect(result.coverage).toEqual({ exhausted: true, truncated: false, reasons: ['index_only'] })
  })

  test('drops an own-vector candidate whose current admission has no own origin', async () => {
    const { repo, vectors, service } = dependencies()
    vectors.queryArticles.mockResolvedValue([{ userId: USER, id: 10, score: 0.9 }])
    repo.articles.mockResolvedValue([
      articleRow({ user_id: 8, collection_id: 30, collection_code: 'code', collection_readable: true })
    ])
    const result = await service.articleVector(USER, unit(), new AbortController().signal)
    expect(result.matches).toEqual([])
  })

  test('reports candidate-limit coverage when the native answer is full', async () => {
    const { repo, vectors, service } = dependencies()
    vectors.queryArticles.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({ userId: USER, id: index + 1, score: 1 })))
    repo.articles.mockResolvedValue([])
    const result = await service.articleVector(USER, unit(), new AbortController().signal)
    expect(result.coverage).toEqual({ exhausted: false, truncated: true, reasons: ['index_only', 'candidate_limit'] })
  })
})

describe('Collection vector channel', () => {
  test('returns only admitted Collections, never member articles', async () => {
    const { repo, vectors, service } = dependencies()
    vectors.queryCollections.mockResolvedValue([
      { id: 30, score: 0.9 },
      { id: 31, score: 0.8 }
    ])
    repo.collections.mockResolvedValue([{ collection_id: 30, collection_code: 'code', owner_id: 8, title: 'Followed Collection' }])
    const result = await service.collectionVector(USER, unit(), new AbortController().signal)
    expect(vectors.queryCollections).toHaveBeenCalledExactlyOnceWith(unit(), { limit: 100 })
    expect(result.matches.map(match => match.entity)).toEqual([
      { type: 'collection', id: 'collection:30', collection_id: 30, collection_code: 'code', owner_id: 8, title: 'Followed Collection' }
    ])
    expect(repo.collections).toHaveBeenCalledExactlyOnceWith(USER, [30, 31], true)
    expect(result.matches.some(match => match.entity.type === 'article')).toBe(false)
  })

  test('orders tied Collection identities deterministically and reports full coverage', async () => {
    const { repo, vectors, service } = dependencies()
    vectors.queryCollections.mockResolvedValue([
      { id: 30, score: 1 },
      { id: 29, score: 1 }
    ])
    repo.collections.mockImplementation(async (_userId: number, ids: number[]) => ids.map(id => ({ collection_id: id, collection_code: 'code', owner_id: 8, title: `C${id}` })))
    const result = await service.collectionVector(USER, unit(), new AbortController().signal)
    expect(result.matches.map(match => match.entity.id)).toEqual(['collection:29', 'collection:30'])
  })
})

describe('revalidate', () => {
  const vectorMatch: SearchMatch = {
    entity: {
      type: 'article',
      id: 'article:10',
      bookmark_id: 10,
      title: 'Old title',
      target_url: 'https://example.com/10',
      origins: [{ kind: 'own', bookmark_user_uuid: 'own-uuid', title: 'Old title' }]
    },
    nativeScore: 0.9
  }

  test('drops a result whose current admission is gone, including its excerpt', async () => {
    const { repo, service } = dependencies()
    repo.articles.mockResolvedValue([])
    const withExcerpt: SearchMatch = { ...vectorMatch, entity: { ...vectorMatch.entity, excerpt: { text: 'old excerpt', source: 'indexed_text' } } as HybridSearchEntity }
    await expect(service.revalidate(USER, 'fulltext', [withExcerpt], new AbortController().signal)).resolves.toEqual([])
  })

  test('keeps the earlier excerpt while replacing current identity fields', async () => {
    const { repo, service } = dependencies()
    repo.articles.mockResolvedValue([articleRow({ title: 'Current title', target_url: 'https://example.com/current' })])
    const withExcerpt: SearchMatch = { ...vectorMatch, entity: { ...vectorMatch.entity, excerpt: { text: 'old excerpt', source: 'indexed_text' } } as HybridSearchEntity }
    const [result] = await service.revalidate(USER, 'fulltext', [withExcerpt], new AbortController().signal)
    expect(result.entity).toMatchObject({ type: 'article', title: 'Current title', target_url: 'https://example.com/current', excerpt: { text: 'old excerpt', source: 'indexed_text' } })
  })

  test('article-vector revalidation requires a current own origin, not only Collection access', async () => {
    const { repo, service } = dependencies()
    repo.articles.mockResolvedValue([articleRow({ user_id: 8, collection_id: 30, collection_code: 'code', collection_readable: true })])
    await expect(service.revalidate(USER, 'article_vector', [vectorMatch], new AbortController().signal)).resolves.toEqual([])
    await expect(service.revalidate(USER, 'titles', [vectorMatch], new AbortController().signal)).resolves.toHaveLength(1)
  })

  test('dedupes repeated identities within one channel', async () => {
    const { repo, service } = dependencies()
    repo.articles.mockResolvedValue([articleRow()])
    const other: SearchMatch = { ...vectorMatch, nativeScore: 0.1 }
    const result = await service.revalidate(USER, 'fulltext', [vectorMatch, other], new AbortController().signal)
    expect(result).toHaveLength(1)
  })

  test('a whole admission failure fails the channel explicitly', async () => {
    const { repo, service } = dependencies()
    repo.articles.mockRejectedValue(new Error('admission unavailable'))
    await expect(service.revalidate(USER, 'fulltext', [vectorMatch], new AbortController().signal)).rejects.toMatchObject({ code: 'admission_failed' })
  })

  describe('revalidateAll final admission', () => {
    const channel = (matches: SearchMatch[]): SearchChannelResult => ({ matches, coverage: { exhausted: true, truncated: false, reasons: [] } })
    const articleMatch: SearchMatch = {
      entity: {
        type: 'article',
        id: 'article:10',
        bookmark_id: 10,
        title: 'Article',
        target_url: 'https://example.com/10',
        origins: [{ kind: 'own', bookmark_user_uuid: 'own-uuid', title: 'Article' }]
      }
    }
    const collectionMatch: SearchMatch = {
      entity: { type: 'collection', id: 'collection:30', collection_id: 30, collection_code: 'code', owner_id: 8, title: 'Collection' }
    }

    test('a removed title alias drops only the titles channel while the own-vector origin survives', async () => {
      const { repo, service } = dependencies()
      repo.articles.mockResolvedValue([articleRow()])
      repo.titleCandidates.mockResolvedValue([])
      const channels = { titles: channel([articleMatch]), article_vector: channel([articleMatch]) }
      const current = Object.fromEntries(
        (await service.revalidateAll(USER, channels, new AbortController().signal, 'reader')).map(item => [item.channel, item])
      )
      expect(repo.titleCandidates).toHaveBeenCalledExactlyOnceWith(USER, 'reader', 100, expect.any(Array))
      expect(current.titles.result?.matches).toEqual([])
      expect(current.article_vector.result?.matches.map(match => match.entity.id)).toEqual(['article:10'])
      expect(current.article_vector.result?.matches[0].entity.type === 'article' && current.article_vector.result?.matches[0].entity.origins).toEqual([
        { kind: 'own', bookmark_user_uuid: 'own-uuid', title: 'Own title' }
      ])
    })

    test('a renamed alias updates the titles channel without corrupting the surviving own origin', async () => {
      const { repo, service } = dependencies()
      repo.articles.mockResolvedValue([articleRow({ title: 'Stored title' })])
      repo.titleCandidates.mockResolvedValue([articleCandidate(10, 'New alias')])
      const channels = { titles: channel([articleMatch]), fulltext: channel([{ ...articleMatch, nativeScore: -1 }]) }
      const current = Object.fromEntries(
        (await service.revalidateAll(USER, channels, new AbortController().signal, 'reader')).map(item => [item.channel, item])
      )
      expect(current.titles.result?.matches[0].entity.title).toBe('New alias')
      expect(current.fulltext.result?.matches[0].entity.type === 'article' && current.fulltext.result?.matches[0].entity.origins).toEqual([
        { kind: 'own', bookmark_user_uuid: 'own-uuid', title: 'Stored title' }
      ])
    })

    test('an empty Collection aggregate drops collection_vector while its title hit remains', async () => {
      const { repo, service } = dependencies()
      repo.collections.mockImplementation(async (_userId: number, _ids: number[], aggregateOnly?: boolean) =>
        aggregateOnly ? [] : [{ collection_id: 30, collection_code: 'code', owner_id: 8, title: 'Collection' }]
      )
      repo.titleCandidates.mockResolvedValue([collectionCandidate(30, 'Collection title')])
      const channels = { titles: channel([collectionMatch]), collection_vector: channel([collectionMatch]) }
      const current = Object.fromEntries(
        (await service.revalidateAll(USER, channels, new AbortController().signal, 'reader')).map(item => [item.channel, item])
      )
      expect(current.titles.result?.matches.map(match => match.entity.id)).toEqual(['collection:30'])
      expect(current.titles.result?.matches[0].entity.title).toBe('Collection title')
      expect(current.collection_vector.result?.matches).toEqual([])
    })

    test('a whole type admission failure fails only the affected channels explicitly', async () => {
      const { repo, service } = dependencies()
      repo.articles.mockResolvedValue([articleRow()])
      repo.collections.mockImplementation(async (_userId: number, ids: number[]) => {
        if (ids.includes(30)) throw new Error('collection admission down')
        return []
      })
      const channels = { titles: channel([collectionMatch]), article_vector: channel([articleMatch]) }
      const current = Object.fromEntries(
        (await service.revalidateAll(USER, channels, new AbortController().signal, 'reader')).map(item => [item.channel, item])
      )
      expect(current.titles.error).toMatchObject({ code: 'admission_failed' })
      expect(current.article_vector.result?.matches.map(match => match.entity.id)).toEqual(['article:10'])
    })
  })

  test('an aborted final revalidation throws instead of returning a partial success', async () => {
    const { service } = dependencies()
    const controller = new AbortController()
    controller.abort()
    await expect(service.revalidate(USER, 'fulltext', [vectorMatch], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
