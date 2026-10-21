import { beforeEach, describe, expect, test, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { SearchService, type hybridSearchItem } from '@/domain/search'
import { escapeHtml } from '@/utils/escape'
import { rerank } from '@/utils/hybridSearch/rerank'

vi.mock('@/utils/hybridSearch/normalizer', () => ({
  Normalizer: class {
    async processSearchKeyword(keyword: string) {
      return keyword
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
    const service = new SearchService({} as never, {} as never, {} as never, {} as never)
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
    const service = new SearchService({} as never, {} as never, {} as never, {} as never)
    const item = makeItem(type)
    const [result] = await service.processHybridSearchRerank({ env: {} } as never, 'saved', { 11: item })

    expect(result).not.toBeNull()
    expect(expectSafeMarkup(result!.highlight_title)).toBe(item.title)
    expect(expectSafeMarkup(result!.highlight_content)).toBe(item.content)
    expect(result!.final_score).toBe(0.9)
    expect(result!.title).toBeUndefined()
    expect(result!.content).toBeUndefined()
  })

  test('escapes stored FTS and vector rows through hybridSearch with existing ID-only cache entries', async () => {
    const fts = makeItem('fts')
    const vector = makeItem('vector')
    const cached = new Map([
      ['search:bm_shard:7', JSON.stringify([{ bookmark_id: 11, bucket_idx: 0 }, { bookmark_id: 12, bucket_idx: 0 }])],
      ['search:bm_rows:7', JSON.stringify([{ bookmark_id: 11, id: 21 }, { bookmark_id: 12, id: 22 }])],
      ['search:valid_bm_ids:7', JSON.stringify([11, 12])]
    ])
    const kv = {
      get: vi.fn(async (key: string) => cached.get(key) ?? null),
      put: vi.fn(),
      delete: vi.fn()
    }
    const repo = {
      getUserBookmarkUuidsByBmIds: vi.fn().mockResolvedValue(new Map([[11, 'fts-uuid'], [12, 'vector-uuid']])),
      getSearchEligibleBookmarks: vi.fn().mockResolvedValue([
        {bookmark_id: 11, uuid: 'fts-uuid', created_at: new Date('2026-10-16T12:02:00Z'), bookmark: {target_url: 'https://fts.example/article'}},
        {bookmark_id: 12, uuid: 'vector-uuid', created_at: new Date('2026-09-22T14:33:00Z'), bookmark: {target_url: 'https://vector.example/article'}}
      ])
    }
    const searchRepo = {
      seachBM25: vi.fn().mockResolvedValue([{
        bookmark_id: 11,
        score: -2,
        raw_title: fts.title,
        raw_content: fts.content,
        title_snippet: fts.highlight_title,
        content_snippet: fts.highlight_content
      }]),
      getBookmarkRaw: vi.fn().mockResolvedValue([{ bookmark_id: 12, raw_title: vector.title, raw_content: vector.content }])
    }
    const service = new SearchService(
      repo as never,
      { getUserSubscriptionInfo: vi.fn().mockResolvedValue(null) } as never,
      searchRepo as never,
      { seachVector: vi.fn().mockResolvedValue({ count: 1, matches: [{ id: '12_0', score: 0.9 }] }) } as never
    )

    const results = await service.hybridSearch({ getUserId: () => 7, env: { KV: kv } } as never, 'saved')

    expect(results).toHaveLength(2)
    expect(searchRepo.seachBM25).toHaveBeenCalledWith([21, 22], 'saved')
    expect(searchRepo.getBookmarkRaw).toHaveBeenCalledWith([12])
    expect(results.map(item => item.type).sort()).toEqual(['fts', 'vector'])
    for (const result of results) {
      expect(expectSafeMarkup(result.highlight_title)).toBe(fts.title)
      expect(expectSafeMarkup(result.highlight_content)).toBe(fts.content)
    }
    expect(results.find(item => item.bookmark_id === 11)).toMatchObject({target_url: 'https://fts.example/article', created_at: '2026-10-16T12:02:00.000Z'});
    expect(results.find(item => item.bookmark_id === 12)).toMatchObject({target_url: 'https://vector.example/article', created_at: '2026-09-22T14:33:00.000Z'});
    expect(repo.getSearchEligibleBookmarks).toHaveBeenLastCalledWith(7, [], [11, 12]);
    expect(kv.get.mock.calls.map(([key]) => key).sort()).toEqual([...cached.keys()].sort())
    expect(kv.put).not.toHaveBeenCalled()
    expect(kv.delete).not.toHaveBeenCalled()
  })

  test('does not expose result metadata after current ownership admission rejects a hit', async () => {
    const repo = {getSearchEligibleBookmarks: vi.fn()
      .mockResolvedValueOnce([{bookmark_id: 11, uuid: 'owned'}, {bookmark_id: 99, uuid: 'removed'}])
      .mockResolvedValueOnce([{bookmark_id: 11, uuid: 'owned', created_at: new Date('2026-10-21T00:00:00Z'), bookmark: {target_url: 'https://owned.example/article'}}])};
    const service = new SearchService(repo as never, {getUserSubscriptionInfo: vi.fn().mockResolvedValue(null)} as never, {} as never, {} as never);
    vi.spyOn(service, 'getUserBookmarkItem').mockResolvedValue([{bmId: 11, shardIdx: 0, rowId: 1}, {bmId: 99, shardIdx: 0, rowId: 2}]);
    vi.spyOn(service, 'fulltextSearch').mockResolvedValue([11, 99].map(bookmark_id => ({bookmark_id, score: -2, raw_title: 'Title', raw_content: 'Body', title_snippet: 'Title', content_snippet: 'Body'})));
    vi.spyOn(service, 'semanticSearch').mockResolvedValue([]);
    const results = await service.hybridSearch({getUserId: () => 7, env: {}} as never, 'body');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({bookmark_id: 11, bookmark_user_uuid: 'owned', target_url: 'https://owned.example/article', created_at: '2026-10-21T00:00:00.000Z'});
  });

  test('rejects unknown or foreign requested tags before consulting cached FTS or vector candidates', async () => {
    const kv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() }
    const repo = {getSearchEligibleBookmarks: vi.fn().mockResolvedValue([])}
    const searchRepo = {seachBM25: vi.fn(), getBookmarkRaw: vi.fn()}
    const vectorRepo = {seachVector: vi.fn()}
    const service = new SearchService(
      repo as never,
      {getUserSubscriptionInfo: vi.fn().mockResolvedValue(null)} as never,
      searchRepo as never,
      vectorRepo as never
    )

    const results = await service.hybridSearch({getUserId: () => 7, env: {KV: kv}} as never, 'private term', [], ['foreign-tag'])

    expect(results).toEqual([])
    expect(repo.getSearchEligibleBookmarks).toHaveBeenCalledWith(7, ['foreign-tag'])
    expect(kv.get).not.toHaveBeenCalled()
    expect(searchRepo.seachBM25).not.toHaveBeenCalled()
    expect(vectorRepo.seachVector).not.toHaveBeenCalled()
  })
})
