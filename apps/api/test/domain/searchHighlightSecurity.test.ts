import { beforeEach, describe, expect, test, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { FULLTEXT_HIGHLIGHT_LIMIT, SEMANTIC_FALLBACK_TEXT_LENGTH, SearchService, type hybridSearchItem } from '@/domain/search'
import { escapeHtml } from '@/utils/escape'
import { rerank } from '@/utils/hybridSearch/rerank'

vi.mock('@/utils/hybridSearch/normalizer', () => ({
  Normalizer: class {
    async processSearchKeyword(keyword: string) {
      return { full: keyword, title: `title:${keyword}`, content: `content:${keyword}` }
    }
  }
}))
vi.mock('@/utils/hybridSearch/vectorize', () => ({ embedding: vi.fn().mockResolvedValue([{ embedding: [0.1] }]) }))
vi.mock('@/utils/hybridSearch/rerank', () => ({ rerank: vi.fn() }))

function expectSafeMarkup(html: string) {
  const { document } = parseHTML('<html><body></body></html>')
  document.body.innerHTML = html
  for (const element of document.body.querySelectorAll('*')) {
    expect(element.tagName).toBe('MARK')
    expect(element.attributes.length).toBe(0)
  }
  return document.body.textContent
}

function makeItem(type: hybridSearchItem['type']): hybridSearchItem {
  const title = '<mark>saved</mark> & title'
  const content = '<img src=x onerror="void(0)"> body'
  return {
    bookmark_id: 11,
    vs_score: 0.8,
    fts_score: -2,
    type,
    title,
    content,
    highlight_title: type === 'vector' ? title : '[highlight]saved[/highlight]',
    highlight_content: type === 'vector' ? content : '[highlight]body[/highlight]'
  }
}

describe('search highlight rendering boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test.each(['fts', 'hybrid', 'vector'] as const)('renders only generated attribute-free marks for %s results', type => {
    const service = new SearchService({} as never, {} as never, {} as never)
    const item = makeItem(type)
    const [result] = service.processHybridSearchList({ 11: item }, new Map([[11, 'bookmark-uuid']]))

    expect(expectSafeMarkup(result.highlight_title)).toBe(item.title)
    expect(expectSafeMarkup(result.highlight_content)).toBe(item.content)
    expect(result.bookmark_user_uuid).toBe('bookmark-uuid')
    expect(result.title).toBeUndefined()
    expect(result.content).toBeUndefined()
    if (type === 'vector') {
      expect(result.highlight_title).toBe(escapeHtml(item.highlight_title))
      expect(result.highlight_content).toBe(escapeHtml(item.highlight_content))
    } else {
      expect(result.highlight_title).toBe('&lt;mark&gt;<mark>saved</mark>&lt;/mark&gt; &amp; title')
      expect(result.highlight_content).toBe('&lt;img src=x onerror=&quot;void(0)&quot;&gt; <mark>body</mark>')
    }
  })

  test.each(['fts', 'hybrid', 'vector'] as const)('also escapes the rerank output for %s results', async type => {
    vi.mocked(rerank).mockResolvedValue([{ index: 0, score: 0.9 }])
    const service = new SearchService({} as never, {} as never, {} as never)
    const item = makeItem(type)
    const [result] = await service.processHybridSearchRerank({ env: {} } as never, 'saved', { 11: item })

    expect(result).not.toBeNull()
    expect(expectSafeMarkup(result!.highlight_title)).toBe(item.title)
    expect(expectSafeMarkup(result!.highlight_content)).toBe(item.content)
    expect(result!.final_score).toBe(0.9)
    expect(result!.title).toBeUndefined()
    expect(result!.content).toBeUndefined()
  })

  test('ranks every candidate row in one query and highlights only the best-ranked rows', async () => {
    const items = Array.from({ length: 125 }, (_, index) => ({ bmId: index + 1, shardIdx: 0, rowIds: [1000 + index] }))
    const ranked = items.map((item, index) => ({ row_id: item.rowIds[0], bookmark_id: item.bmId, score: -100 + index }))
    const searchRepo = {
      rankFulltextRows: vi.fn().mockResolvedValue(ranked),
      getFulltextHighlights: vi.fn(async (ids: number[]) =>
        ids.map(id => ({
          row_id: id,
          raw_title: `title ${id}`,
          raw_content: `body ${id}`,
          title_snippet: `[highlight]title[/highlight] ${id}`,
          content_snippet: `[highlight]body[/highlight] ${id}`
        }))
      ),
      getFulltextRawPrefixes: vi.fn(async (ids: number[]) => ids.map(id => ({ row_id: id, raw_title: `prefix title ${id}`, raw_content: `prefix body ${id}` })))
    }
    const service = new SearchService({} as never, searchRepo as never, {} as never)
    const expressions = { full: 'full', title: 'title:x', content: 'content:x' }

    const results = await service.fulltextSearch({} as never, expressions, items)

    expect(searchRepo.rankFulltextRows).toHaveBeenCalledTimes(1)
    expect(searchRepo.rankFulltextRows).toHaveBeenCalledWith(
      items.flatMap(item => item.rowIds),
      'full'
    )
    expect(searchRepo.getFulltextHighlights).toHaveBeenCalledWith(
      ranked.slice(0, FULLTEXT_HIGHLIGHT_LIMIT).map(row => row.row_id),
      expressions
    )
    expect(searchRepo.getFulltextRawPrefixes).toHaveBeenCalledWith(
      ranked.slice(FULLTEXT_HIGHLIGHT_LIMIT).map(row => row.row_id),
      60
    )
    expect(results.map(row => row.bookmark_id)).toEqual(ranked.map(row => row.bookmark_id))
    expect(results.map(row => row.score)).toEqual(ranked.map(row => row.score))
    expect(results[0]).toMatchObject({ title_snippet: '[highlight]title[/highlight] 1000', raw_content: 'body 1000' })
    expect(results[FULLTEXT_HIGHLIGHT_LIMIT]).toMatchObject({ title_snippet: '', content_snippet: '', raw_content: `prefix body ${1000 + FULLTEXT_HIGHLIGHT_LIMIT}` })
  })

  test('ranks every shard of a long article and keeps only its best-scoring shard', async () => {
    const searchRepo = {
      rankFulltextRows: vi.fn().mockResolvedValue([
        { row_id: 32, bookmark_id: 3, score: -9 },
        { row_id: 41, bookmark_id: 4, score: -5 },
        { row_id: 31, bookmark_id: 3, score: -1 }
      ]),
      getFulltextHighlights: vi.fn(async (ids: number[]) =>
        ids.map(id => ({ row_id: id, raw_title: `t${id}`, raw_content: `b${id}`, title_snippet: '', content_snippet: `[highlight]${id}[/highlight]` }))
      ),
      getFulltextRawPrefixes: vi.fn().mockResolvedValue([])
    }
    const service = new SearchService({} as never, searchRepo as never, {} as never, {} as never, {} as never)

    const results = await service.fulltextSearch({} as never, { full: 'f', title: 't', content: 'c' }, [
      { bmId: 3, shardIdx: 0, rowIds: [31, 32] },
      { bmId: 4, shardIdx: 0, rowIds: [41] }
    ])

    expect(searchRepo.rankFulltextRows).toHaveBeenCalledWith([31, 32, 41], 'f')
    expect(results.map(row => [row.bookmark_id, row.score])).toEqual([
      [3, -9],
      [4, -5]
    ])
    expect(searchRepo.getFulltextHighlights).toHaveBeenCalledWith([32, 41], { full: 'f', title: 't', content: 'c' })
  })

  test('drops a ranked row whose text disappeared before the highlight queries', async () => {
    const searchRepo = {
      rankFulltextRows: vi.fn().mockResolvedValue([
        { row_id: 1, bookmark_id: 10, score: -3 },
        { row_id: 2, bookmark_id: 20, score: -2 }
      ]),
      getFulltextHighlights: vi.fn().mockResolvedValue([{ row_id: 1, raw_title: 'T', raw_content: 'B', title_snippet: '', content_snippet: '' }]),
      getFulltextRawPrefixes: vi.fn().mockResolvedValue([])
    }
    const service = new SearchService({} as never, searchRepo as never, {} as never, {} as never, {} as never)
    const results = await service.fulltextSearch({} as never, { full: 'f', title: 't', content: 'c' }, [
      { bmId: 10, shardIdx: 0, rowIds: [1] },
      { bmId: 20, shardIdx: 0, rowIds: [2] }
    ])
    expect(results.map(row => row.bookmark_id)).toEqual([10])
  })

  test('fails the fulltext branch instead of returning a partial result', async () => {
    const searchRepo = { rankFulltextRows: vi.fn().mockRejectedValue(new Error('D1 DB is overloaded')), getFulltextHighlights: vi.fn(), getFulltextRawPrefixes: vi.fn() }
    const service = new SearchService({} as never, searchRepo as never, {} as never)

    await expect(service.fulltextSearch({} as never, { full: 'f', title: 't', content: 'c' }, [{ bmId: 1, shardIdx: 0, rowIds: [2] }])).rejects.toThrow('D1 DB is overloaded')
    expect(searchRepo.getFulltextHighlights).not.toHaveBeenCalled()
  })

  test('keeps vector results when the fulltext branch fails', async () => {
    const repo = {
      getSearchEligibleBookmarks: vi
        .fn()
        .mockResolvedValueOnce([{ bookmark_id: 12, uuid: 'vector-uuid' }])
        .mockResolvedValueOnce([{ bookmark_id: 12, uuid: 'vector-uuid', created_at: new Date('2026-10-21T00:00:00Z'), bookmark: { target_url: 'https://vector.example/article' } }])
    }
    const searchRepo = { getBookmarkRaw: vi.fn().mockResolvedValue([{ bookmark_id: 12, raw_title: 'Vector title', raw_content: 'Vector body' }]) }
    const service = new SearchService(repo as never, searchRepo as never, {} as never)
    vi.spyOn(service, 'getUserBookmarkItem').mockResolvedValue([{ bmId: 12, shardIdx: 0, rowIds: [22] }])
    vi.spyOn(service, 'fulltextSearch').mockRejectedValue(new Error('D1 DB is overloaded'))
    vi.spyOn(service, 'semanticSearchV5').mockResolvedValue([{ id: '12_0', score: 0.9 }])

    const results = await service.hybridSearch({ getUserId: () => 7, env: {} } as never, 'body')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ bookmark_id: 12, type: 'vector' })
  })

  test('escapes stored FTS and vector rows through hybridSearch with existing ID-only cache entries', async () => {
    const fts = makeItem('fts')
    const vector = makeItem('vector')
    const cached = new Map([
      [
        'search:bm_shard:7',
        JSON.stringify([
          { bookmark_id: 11, bucket_idx: 0 },
          { bookmark_id: 12, bucket_idx: 0 }
        ])
      ],
      [
        'search:bm_rows:7',
        JSON.stringify([
          { bookmark_id: 11, id: 21 },
          { bookmark_id: 12, id: 22 }
        ])
      ],
      ['search:valid_bm_ids:7', JSON.stringify([11, 12])]
    ])
    const kv = {
      get: vi.fn(async (key: string) => cached.get(key) ?? null),
      put: vi.fn(),
      delete: vi.fn()
    }
    const repo = {
      getUserBookmarkUuidsByBmIds: vi.fn().mockResolvedValue(
        new Map([
          [11, 'fts-uuid'],
          [12, 'vector-uuid']
        ])
      ),
      getSearchEligibleBookmarks: vi.fn().mockResolvedValue([
        { bookmark_id: 11, uuid: 'fts-uuid', created_at: new Date('2026-10-16T12:02:00Z'), bookmark: { target_url: 'https://fts.example/article' } },
        { bookmark_id: 12, uuid: 'vector-uuid', created_at: new Date('2026-09-22T14:33:00Z'), bookmark: { target_url: 'https://vector.example/article' } }
      ])
    }
    const searchRepo = {
      rankFulltextRows: vi.fn().mockResolvedValue([{ row_id: 21, bookmark_id: 11, score: -2 }]),
      getFulltextHighlights: vi.fn().mockResolvedValue([
        {
          row_id: 21,
          raw_title: fts.title,
          raw_content: fts.content,
          title_snippet: fts.highlight_title,
          content_snippet: fts.highlight_content
        }
      ]),
      getFulltextRawPrefixes: vi.fn().mockResolvedValue([]),
      getBookmarkRaw: vi.fn().mockResolvedValue([{ bookmark_id: 12, raw_title: vector.title, raw_content: vector.content }])
    }
    const service = new SearchService(repo as never, searchRepo as never, {} as never, {} as never, {} as never)
    vi.spyOn(service, 'semanticSearchV5').mockResolvedValue([{ id: '12_0', score: 0.9 }])

    const results = await service.hybridSearch({ getUserId: () => 7, env: { KV: kv } } as never, 'saved')

    expect(results).toHaveLength(2)
    expect(searchRepo.rankFulltextRows).toHaveBeenCalledWith([21, 22], 'saved')
    expect(searchRepo.getFulltextHighlights).toHaveBeenCalledWith([21], { full: 'saved', title: 'title:saved', content: 'content:saved' })
    expect(searchRepo.getBookmarkRaw).toHaveBeenCalledWith([12])
    expect(results.map(item => item.type).sort()).toEqual(['fts', 'vector'])
    for (const result of results) {
      expect(expectSafeMarkup(result.highlight_title)).toBe(fts.title)
      expect(expectSafeMarkup(result.highlight_content)).toBe(fts.content)
    }
    expect(results.find(item => item.bookmark_id === 11)).toMatchObject({ target_url: 'https://fts.example/article', created_at: '2026-10-16T12:02:00.000Z' })
    expect(results.find(item => item.bookmark_id === 12)).toMatchObject({ target_url: 'https://vector.example/article', created_at: '2026-09-22T14:33:00.000Z' })
    expect(repo.getSearchEligibleBookmarks).toHaveBeenLastCalledWith(7, [], [11, 12])
    expect(kv.get.mock.calls.map(([key]) => key).sort()).toEqual([...cached.keys()].sort())
    expect(kv.put).not.toHaveBeenCalled()
    expect(kv.delete).not.toHaveBeenCalled()
  })

  test('does not expose result metadata after current ownership admission rejects a hit', async () => {
    const repo = {
      getSearchEligibleBookmarks: vi
        .fn()
        .mockResolvedValueOnce([
          { bookmark_id: 11, uuid: 'owned' },
          { bookmark_id: 99, uuid: 'removed' }
        ])
        .mockResolvedValueOnce([{ bookmark_id: 11, uuid: 'owned', created_at: new Date('2026-10-21T00:00:00Z'), bookmark: { target_url: 'https://owned.example/article' } }])
    }
    const service = new SearchService(repo as never, {} as never, {} as never)
    vi.spyOn(service, 'getUserBookmarkItem').mockResolvedValue([
      { bmId: 11, shardIdx: 0, rowIds: [1] },
      { bmId: 99, shardIdx: 0, rowIds: [2] }
    ])
    vi.spyOn(service, 'fulltextSearch').mockResolvedValue(
      [11, 99].map(bookmark_id => ({ bookmark_id, score: -2, raw_title: 'Title', raw_content: 'Body', title_snippet: 'Title', content_snippet: 'Body' }))
    )
    vi.spyOn(service, 'semanticSearchV5').mockResolvedValue([])
    const results = await service.hybridSearch({ getUserId: () => 7, env: {} } as never, 'body')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ bookmark_id: 11, bookmark_user_uuid: 'owned', target_url: 'https://owned.example/article', created_at: '2026-10-21T00:00:00.000Z' })
  })

  test('shows the PostgreSQL title and description for a semantic hit without fulltext rows', async () => {
    const repo = {
      getSearchEligibleBookmarks: vi
        .fn()
        .mockResolvedValueOnce([{ bookmark_id: 12, uuid: 'vector-uuid' }])
        .mockResolvedValueOnce([
          {
            bookmark_id: 12,
            uuid: 'vector-uuid',
            created_at: new Date('2026-09-22T14:33:00Z'),
            alias_title: '',
            bookmark: { target_url: 'https://vector.example/article', title: '<b>Title</b>' + 'x'.repeat(80), description: 'Summary <img src=x onerror=alert(1)>' }
          }
        ])
    }
    const searchRepo = { getBookmarkRaw: vi.fn().mockResolvedValue([]) }
    const service = new SearchService(repo as never, searchRepo as never, {} as never)
    vi.spyOn(service, 'getUserBookmarkItem').mockResolvedValue([])
    vi.spyOn(service, 'fulltextSearch').mockResolvedValue([])
    vi.spyOn(service, 'semanticSearchV5').mockResolvedValue([{ id: '12_0', score: 0.5 }])

    const [result] = await service.hybridSearch({ getUserId: () => 7, env: {} } as never, 'topic')

    expect(searchRepo.getBookmarkRaw).toHaveBeenCalledWith([12])
    expect(expectSafeMarkup(result.highlight_title)).toBe(('<b>Title</b>' + 'x'.repeat(80)).slice(0, SEMANTIC_FALLBACK_TEXT_LENGTH))
    expect(expectSafeMarkup(result.highlight_content)).toBe('Summary <img src=x onerror=alert(1)>')
    expect(result.highlight_content).not.toContain('<img')
  })

  test('rejects unknown or foreign requested tags before consulting cached FTS or vector candidates', async () => {
    const kv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() }
    const repo = { getSearchEligibleBookmarks: vi.fn().mockResolvedValue([]) }
    const searchRepo = { rankFulltextRows: vi.fn(), getBookmarkRaw: vi.fn() }
    const vectorRepo = { seachVector: vi.fn() }
    const service = new SearchService(repo as never, searchRepo as never, vectorRepo as never)

    const results = await service.hybridSearch({ getUserId: () => 7, env: { KV: kv } } as never, 'private term', [], ['foreign-tag'])

    expect(results).toEqual([])
    expect(repo.getSearchEligibleBookmarks).toHaveBeenCalledWith(7, ['foreign-tag'])
    expect(kv.get).not.toHaveBeenCalled()
    expect(searchRepo.rankFulltextRows).not.toHaveBeenCalled()
    expect(vectorRepo.seachVector).not.toHaveBeenCalled()
  })

  test('V5 semantic search reranks native candidates by mean-centered cosine and keeps only strong hits', async () => {
    const { center } = await import('@/utils/recommendationAlgorithms')
    const { EMBEDDING_MEAN } = await import('@/utils/embeddingMean')
    const unit = (values: number[]) => {
      const norm = Math.hypot(...values)
      return values.map(value => value / norm)
    }
    // Vectors placed relative to the platform mean, so their centered directions are controlled by the test.
    const mean = EMBEDDING_MEAN.values
    const direction = (index: number) => mean.map((_, dimension) => (dimension === index ? 1 : 0))
    const around = (offset: number[]) => unit(mean.map((value, dimension) => value + offset[dimension]))
    const query = around(direction(0))
    const strong = around(direction(0))
    const weak = around(unit(direction(0).map((value, dimension) => value * 0.5 + (dimension === 1 ? 0.866 : 0))))
    const unrelated = around(direction(2))
    const vectors = {
      queryArticleVectors: vi.fn().mockResolvedValue([
        { userId: 7, id: 1, score: 0.9, values: strong },
        { userId: 7, id: 2, score: 0.8, values: weak },
        { userId: 7, id: 3, score: 0.85, values: unrelated },
        { userId: 8, id: 4, score: 0.99, values: strong },
        { userId: 7, id: 5, score: 0.95, values: strong }
      ]),
      readArticles: vi.fn()
    }
    const embedding = { cachedQuery: vi.fn().mockResolvedValue(query) }
    const service = new SearchService({} as never, {} as never, {} as never, vectors as never, embedding as never)

    const hits = await service.semanticSearchV5({ getUserId: () => 7 } as never, 'term', new Set([1, 2, 3]))

    expect(embedding.cachedQuery).toHaveBeenCalledWith('term')
    expect(vectors.queryArticleVectors).toHaveBeenCalledExactlyOnceWith(query, { userId: 7, limit: 50 })
    expect(vectors.readArticles).not.toHaveBeenCalled()
    expect(hits.map(hit => hit.id)).toEqual(['1_0'])
    expect(hits[0].score).toBeCloseTo(1, 5)
    expect(center(weak)[1]).toBeGreaterThan(0)
  })

  test('V5 semantic search returns nothing when even the best centered score is weak', async () => {
    const { EMBEDDING_MEAN } = await import('@/utils/embeddingMean')
    const mean = EMBEDDING_MEAN.values
    const at = (index: number) => {
      const values = mean.map((value, dimension) => value + (dimension === index ? 1 : 0))
      const norm = Math.hypot(...values)
      return values.map(value => value / norm)
    }
    const vectors = { queryArticleVectors: vi.fn().mockResolvedValue([{ userId: 7, id: 1, score: 0.8, values: at(1) }]) }
    const service = new SearchService({} as never, {} as never, {} as never, vectors as never, { cachedQuery: vi.fn().mockResolvedValue(at(0)) } as never)
    expect(await service.semanticSearchV5({ getUserId: () => 7 } as never, 'noise', new Set([1]))).toEqual([])
  })

  test('tag-filtered searches keep the legacy encoder and buckets; untagged searches use V5', async () => {
    const repo = { getSearchEligibleBookmarks: vi.fn().mockResolvedValue([{ bookmark_id: 11, uuid: 'u' }]) }
    const service = new SearchService(repo as never, {} as never, {} as never, {} as never, {} as never)
    vi.spyOn(service, 'getUserBookmarkItem').mockResolvedValue([{ bmId: 11, shardIdx: 0, rowIds: [1] }])
    vi.spyOn(service, 'fulltextSearch').mockResolvedValue([])
    const legacy = vi.spyOn(service, 'semanticSearch').mockResolvedValue([])
    const v5 = vi.spyOn(service, 'semanticSearchV5').mockResolvedValue([])

    await service.hybridSearch({ getUserId: () => 7, env: {} } as never, 'body', [], ['tag-uuid'])
    expect(legacy).toHaveBeenCalledOnce()
    expect(v5).not.toHaveBeenCalled()

    await service.hybridSearch({ getUserId: () => 7, env: {} } as never, 'body')
    expect(v5).toHaveBeenCalledWith(expect.anything(), 'body', new Set([11]))
    expect(legacy).toHaveBeenCalledOnce()
  })
})
