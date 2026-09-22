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
      getUserBookmarkUuidsByBmIds: vi.fn().mockResolvedValue(new Map([[11, 'fts-uuid'], [12, 'vector-uuid']]))
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
    expect(kv.get.mock.calls.map(([key]) => key).sort()).toEqual([...cached.keys()].sort())
    expect(kv.put).not.toHaveBeenCalled()
    expect(kv.delete).not.toHaveBeenCalled()
  })
})
