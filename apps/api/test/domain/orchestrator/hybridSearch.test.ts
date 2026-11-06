import { describe, expect, test, vi } from 'vitest'
import {
  HybridSearchOrchestrator,
  SEARCH_CHANNELS,
  SEARCH_RRF_K,
  fuseSearchResults
} from '../../../src/domain/orchestrator/hybridSearch'
import { HybridSearchError, type SearchChannelResult, type SearchMatch } from '../../../src/domain/hybridSearch'
import type { HybridSearchService } from '../../../src/domain/hybridSearch'
import type { ContextManager } from '../../../src/utils/context'
import type { HybridSearchEntity, HybridSearchEvent, HybridSearchChannel } from '@slax-reader/contracts'

const USER = 7

function article(id: number, overrides: Partial<Extract<HybridSearchEntity, { type: 'article' }>> = {}): SearchMatch {
  return {
    entity: {
      type: 'article',
      id: `article:${id}`,
      bookmark_id: id,
      title: `Article ${id}`,
      target_url: `https://example.com/${id}`,
      origins: [{ kind: 'own', bookmark_user_uuid: `uuid-${id}`, title: `Article ${id}` }],
      ...overrides
    }
  }
}

function collection(id: number): SearchMatch {
  return { entity: { type: 'collection', id: `collection:${id}`, collection_id: id, collection_code: `code-${id}`, owner_id: 8, title: `Collection ${id}` }, nativeScore: 1 }
}

const coverage = (overrides: Partial<SearchChannelResult['coverage']> = {}) => ({ exhausted: true, truncated: false, reasons: [], ...overrides })
const result = (matches: SearchMatch[], overrides: Partial<SearchChannelResult['coverage']> = {}): SearchChannelResult => ({ matches, coverage: coverage(overrides) })

function service(overrides: Partial<Record<keyof HybridSearchService, unknown>> = {}) {
  const fake = {
    titles: vi.fn(async () => result([])),
    fulltext: vi.fn(async () => result([])),
    queryEmbedding: vi.fn(async () => new Array(1024).fill(0)),
    articleVector: vi.fn(async () => result([])),
    collectionVector: vi.fn(async () => result([])),
    revalidate: vi.fn(async (_userId: number, _channel: HybridSearchChannel, matches: SearchMatch[]) => matches),
    revalidateAll: vi.fn(async (_userId: number, channels: Partial<Record<HybridSearchChannel, SearchChannelResult>>) =>
      Object.entries(channels).map(([channel, result]) => ({ channel: channel as HybridSearchChannel, result }))
    ),
    ...overrides
  }
  return fake
}

function defer<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(inner => (resolve = inner))
  return { promise, resolve }
}

const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve()
}

const ctx = () => ({ getUserId: () => USER }) as unknown as ContextManager

describe('RRF fusion', () => {
  test('single-channel one-based rank contributes exactly one over sixty-one', () => {
    const [hit] = fuseSearchResults({ titles: [article(10)] })
    expect(hit.rrf_score).toBeCloseTo(1 / (SEARCH_RRF_K + 1), 12)
    expect(hit.evidence).toEqual([{ channel: 'titles', rank: 1 }])
    expect(hit.matched_channels).toEqual(['titles'])
  })

  test('three channels at rank one contribute exactly three over sixty-one', () => {
    const match = article(10)
    const [hit] = fuseSearchResults({ titles: [match], fulltext: [{ ...match, nativeScore: -2 }], article_vector: [{ ...match, nativeScore: 0.9 }] })
    expect(hit.rrf_score).toBeCloseTo(3 / (SEARCH_RRF_K + 1), 12)
    expect(hit.matched_channels).toEqual(['titles', 'fulltext', 'article_vector'])
    expect(hit.evidence).toEqual([
      { channel: 'titles', rank: 1 },
      { channel: 'fulltext', rank: 1, native_score: -2, normalized_score: 2 },
      { channel: 'article_vector', rank: 1, native_score: 0.9 }
    ])
  })

  test('absent channels add no fake rank', () => {
    const [hit] = fuseSearchResults({ titles: [article(10)], collection_vector: [{ ...article(10), nativeScore: 1 }] })
    expect(hit.rrf_score).toBeCloseTo(2 / (SEARCH_RRF_K + 1), 12)
    expect(hit.evidence.map(evidence => evidence.channel)).toEqual(['titles', 'collection_vector'])
  })

  test('dedupes within one channel before assigning ranks and keeps one evidence per channel', () => {
    const match = article(10)
    const [hit] = fuseSearchResults({ titles: [match, match, article(11)] })
    expect(hit.evidence).toEqual([{ channel: 'titles', rank: 1 }])
    expect(hit.rrf_score).toBeCloseTo(1 / (SEARCH_RRF_K + 1), 12)
  })

  test('ties use a stable typed identity order, not arrival order', () => {
    const forward = fuseSearchResults({ titles: [article(10), article(9)], collection_vector: [{ ...article(9), nativeScore: 1 }, { ...article(10), nativeScore: 1 }] })
    const reverse = fuseSearchResults({
      collection_vector: [{ ...article(10), nativeScore: 1 }, { ...article(9), nativeScore: 1 }],
      titles: [article(9), article(10)]
    })
    expect(forward.map(hit => hit.id)).toEqual(['article:10', 'article:9'])
    expect(reverse.map(hit => hit.id)).toEqual(['article:10', 'article:9'])
    expect(forward.map(hit => hit.rrf_score)).toEqual(reverse.map(hit => hit.rrf_score))
  })

  test('does not merge distinct articles merely because URLs match', () => {
    const hits = fuseSearchResults({ titles: [article(10, { target_url: 'https://example.com/shared' }), article(11, { target_url: 'https://example.com/shared' })] })
    expect(hits.map(hit => hit.id)).toEqual(['article:10', 'article:11'])
  })

  test('merges one article across channels while preserving both origins and the excerpt', () => {
    const own = article(10)
    const shared = article(10, {
      title: 'Shared title',
      origins: [{ kind: 'collection', collection_id: 30, collection_code: 'code', owner_id: 8, cb_id: 88, bookmark_uuid: 'owner-uuid', title: 'Shared title' }],
      excerpt: { text: 'indexed excerpt', source: 'indexed_text' }
    })
    const [hit] = fuseSearchResults({ titles: [own], fulltext: [{ ...shared, nativeScore: -1 }] })
    expect(hit.type === 'article' && hit.origins).toEqual([
      { kind: 'own', bookmark_user_uuid: 'uuid-10', title: 'Article 10' },
      { kind: 'collection', collection_id: 30, collection_code: 'code', owner_id: 8, cb_id: 88, bookmark_uuid: 'owner-uuid', title: 'Shared title' }
    ])
    expect(hit.type === 'article' && hit.excerpt).toEqual({ text: 'indexed excerpt', source: 'indexed_text' })
  })

  test('a native score is required for every non-title evidence entry', () => {
    expect(() => fuseSearchResults({ fulltext: [article(10)] })).toThrowError(HybridSearchError)
    expect(() => fuseSearchResults({ article_vector: [article(10)] })).toThrowError(HybridSearchError)
  })
})

describe('orchestrator stream', () => {
  const request = { keyword: 'reader' }
  const signal = () => new AbortController()

  test('starts four channels, shares one embedding, and emits text partials before releasing the vector gate', async () => {
    const gate = defer<number[]>()
    const fake = service({
      titles: vi.fn(async () => result([article(10)])),
      fulltext: vi.fn(async () => result([{ ...article(11), nativeScore: -1 }], { exhausted: true })),
      queryEmbedding: vi.fn(() => gate.promise),
      articleVector: vi.fn(async () => result([article(12)])),
      collectionVector: vi.fn(async () => result([collection(30)]))
    })
    const events: HybridSearchEvent[] = []
    const run = new HybridSearchOrchestrator(fake as unknown as HybridSearchService).stream(ctx(), request, signal().signal, event => events.push(event))
    await flush()
    expect(fake.queryEmbedding).toHaveBeenCalledOnce()
    expect(fake.titles).toHaveBeenCalledOnce()
    expect(fake.fulltext).toHaveBeenCalledOnce()
    expect(events.filter(event => event.type === 'partial').map(event => event.channel)).toEqual(['titles', 'fulltext'])
    gate.resolve(new Array(1024).fill(0))
    await run
    expect(fake.articleVector).toHaveBeenCalledOnce()
    expect(fake.collectionVector).toHaveBeenCalledOnce()
    expect(events.at(-1)?.type).toBe('complete')
  })

  test('a failed channel is reported without suppressing successful results', async () => {
    const fake = service({
      titles: vi.fn(async () => result([article(10)])),
      fulltext: vi.fn(async () => {
        throw new HybridSearchError('retrieval_failed')
      }),
      articleVector: vi.fn(async () => {
        throw new HybridSearchError('embedding_failed')
      }),
      collectionVector: vi.fn(async () => result([collection(30)]))
    })
    const events: HybridSearchEvent[] = []
    await new HybridSearchOrchestrator(fake as unknown as HybridSearchService).stream(ctx(), request, new AbortController().signal, event => events.push(event))
    const complete = events.at(-1)
    expect(complete?.type).toBe('complete')
    if (complete?.type !== 'complete') return
    expect(complete.channels.titles.status).toBe('ok')
    expect(complete.channels.fulltext).toEqual({ status: 'error', code: 'retrieval_failed' })
    expect(complete.channels.article_vector).toEqual({ status: 'error', code: 'embedding_failed' })
    expect(complete.channels.collection_vector.status).toBe('ok')
    expect(complete.results.map(hit => hit.id).sort()).toEqual(['article:10', 'collection:30'])
    expect(complete.incomplete).toBe(true)
  })

  test('a shared embedding failure errors both vector channels without starting either vector query', async () => {
    const embeddingError = new HybridSearchError('embedding_failed')
    const fake = service({
      titles: vi.fn(async () => result([article(10)])),
      fulltext: vi.fn(async () => result([])),
      queryEmbedding: vi.fn(async () => {
        throw embeddingError
      }),
      articleVector: vi.fn(async () => result([article(11)])),
      collectionVector: vi.fn(async () => result([collection(30)]))
    })
    const events: HybridSearchEvent[] = []
    await new HybridSearchOrchestrator(fake as unknown as HybridSearchService).stream(ctx(), request, new AbortController().signal, event => events.push(event))

    expect(fake.queryEmbedding).toHaveBeenCalledOnce()
    expect(fake.articleVector).not.toHaveBeenCalled()
    expect(fake.collectionVector).not.toHaveBeenCalled()
    const vectorErrors = events.filter(event => event.type === 'channel_error').map(event => [event.channel, event.outcome.code])
    expect(vectorErrors).toEqual([
      ['article_vector', 'embedding_failed'],
      ['collection_vector', 'embedding_failed']
    ])
    const completes = events.filter(event => event.type === 'complete')
    expect(completes).toHaveLength(1)
    const complete = completes[0]
    if (complete.type !== 'complete') throw new Error('expected complete')
    expect(complete.channels.titles.status).toBe('ok')
    expect(complete.channels.fulltext.status).toBe('empty')
    expect(complete.channels.article_vector).toEqual({ status: 'error', code: 'embedding_failed' })
    expect(complete.channels.collection_vector).toEqual({ status: 'error', code: 'embedding_failed' })
    expect(complete.results.map(hit => hit.id)).toEqual(['article:10'])
    expect(complete.incomplete).toBe(true)
  })

  test('all four channels failing produces exactly one empty complete with all error statuses', async () => {
    const fake = service({
      titles: vi.fn(async () => {
        throw new HybridSearchError('retrieval_failed')
      }),
      fulltext: vi.fn(async () => {
        throw new HybridSearchError('retrieval_failed')
      }),
      queryEmbedding: vi.fn(async () => {
        throw new HybridSearchError('embedding_failed')
      }),
      articleVector: vi.fn(),
      collectionVector: vi.fn()
    })
    const events: HybridSearchEvent[] = []
    await new HybridSearchOrchestrator(fake as unknown as HybridSearchService).stream(ctx(), request, new AbortController().signal, event => events.push(event))

    const errors = events.filter(event => event.type === 'channel_error')
    expect(errors.map(event => [event.channel, event.outcome.code])).toEqual([
      ['titles', 'retrieval_failed'],
      ['fulltext', 'retrieval_failed'],
      ['article_vector', 'embedding_failed'],
      ['collection_vector', 'embedding_failed']
    ])
    expect(events.filter(event => event.type === 'partial')).toEqual([])
    const completes = events.filter(event => event.type === 'complete')
    expect(completes).toHaveLength(1)
    const complete = completes[0]
    if (complete.type !== 'complete') throw new Error('expected complete')
    expect(complete.results).toEqual([])
    expect(complete.incomplete).toBe(true)
    expect(Object.values(complete.channels).every(outcome => outcome.status === 'error')).toBe(true)
  })

  test('four empty channels still emit four empty partials and one clean complete', async () => {
    const fake = service()
    const events: HybridSearchEvent[] = []
    await new HybridSearchOrchestrator(fake as unknown as HybridSearchService).stream(ctx(), request, new AbortController().signal, event => events.push(event))

    const partials = events.filter(event => event.type === 'partial')
    expect(partials.map(event => [event.channel, event.outcome.status, event.results])).toEqual([
      ['titles', 'empty', []],
      ['fulltext', 'empty', []],
      ['article_vector', 'empty', []],
      ['collection_vector', 'empty', []]
    ])
    expect(events.filter(event => event.type === 'channel_error')).toEqual([])
    const completes = events.filter(event => event.type === 'complete')
    expect(completes).toHaveLength(1)
    const complete = completes[0]
    if (complete.type !== 'complete') throw new Error('expected complete')
    expect(complete.results).toEqual([])
    expect(complete.incomplete).toBe(false)
    expect(Object.values(complete.channels).every(outcome => outcome.status === 'empty' && outcome.code === undefined)).toBe(true)
    expect(fake.queryEmbedding).toHaveBeenCalledOnce()
  })

  test('revalidation failure removes the channel result and reports it explicitly', async () => {
    const fake = service({
      titles: vi.fn(async () => result([article(10)])),
      revalidateAll: vi.fn(async (_userId: number, channels: Partial<Record<HybridSearchChannel, SearchChannelResult>>) => [
        ...Object.entries(channels).map(([channel, result]) => ({ channel: channel as HybridSearchChannel, result })),
        { channel: 'titles' as HybridSearchChannel, error: new HybridSearchError('admission_failed') }
      ])
    })
    const events: HybridSearchEvent[] = []
    await new HybridSearchOrchestrator(fake as unknown as HybridSearchService).stream(ctx(), request, new AbortController().signal, event => events.push(event))
    const complete = events.at(-1)
    expect(complete?.type).toBe('complete')
    if (complete?.type !== 'complete') return
    expect(complete.channels.titles).toEqual({ status: 'error', code: 'admission_failed' })
    expect(complete.results).toEqual([])
    expect(complete.incomplete).toBe(true)
  })

  test('completion order does not change the final fused result', async () => {
    const run = async (order: Array<'titles' | 'fulltext' | 'article_vector' | 'collection_vector'>) => {
      const gates = new Map(order.map((channel, index) => [channel, defer<void>()]))
      const fake = service({
        titles: vi.fn(async () => {
          await gates.get('titles')!.promise
          return result([article(10), article(11)])
        }),
        fulltext: vi.fn(async () => {
          await gates.get('fulltext')!.promise
          return result([{ ...article(11, { excerpt: { text: 'x', source: 'indexed_text' } }), nativeScore: -1 }])
        }),
        queryEmbedding: vi.fn(async () => new Array(1024).fill(0)),
        articleVector: vi.fn(async () => {
          await gates.get('article_vector')!.promise
          return result([{ ...article(10), nativeScore: 1 }])
        }),
        collectionVector: vi.fn(async () => {
          await gates.get('collection_vector')!.promise
          return result([collection(30)])
        })
      })
      const events: HybridSearchEvent[] = []
      const stream = new HybridSearchOrchestrator(fake as unknown as HybridSearchService).stream(ctx(), request, new AbortController().signal, event => events.push(event))
      await flush()
      for (const channel of order) gates.get(channel)!.resolve()
      await stream
      return events.at(-1)
    }
    const first = await run(['titles', 'fulltext', 'article_vector', 'collection_vector'])
    const second = await run(['collection_vector', 'article_vector', 'fulltext', 'titles'])
    expect(second).toEqual(first)
    expect(first?.type).toBe('complete')
  })

  test('returns every fused result above one hundred after per-channel dedup, with no result limit field', async () => {
    const titleMatches = Array.from({ length: 70 }, (_, index) => article(index + 1))
    const vectorMatches = Array.from({ length: 70 }, (_, index) => ({ ...article(index + 41), nativeScore: 1 }))
    const fake = service({
      titles: vi.fn(async () => result(titleMatches)),
      articleVector: vi.fn(async () => result(vectorMatches))
    })
    const events: HybridSearchEvent[] = []
    await new HybridSearchOrchestrator(fake as unknown as HybridSearchService).stream(ctx(), request, new AbortController().signal, event => events.push(event))
    const complete = events.at(-1)
    expect(complete?.type).toBe('complete')
    if (complete?.type !== 'complete') return
    expect(complete.results).toHaveLength(110)
    expect(new Set(complete.results.map(hit => hit.id)).size).toBe(110)
    expect(complete.results.some(hit => hit.matched_channels.includes('titles') && hit.matched_channels.includes('article_vector'))).toBe(true)
    expect('result_limit_reached' in complete).toBe(false)
    expect(complete.replaces_partials).toBe(true)
    expect(complete.channels.titles).toMatchObject({ status: 'ok', count: 70 })
    expect(complete.channels.article_vector).toMatchObject({ status: 'ok', count: 70 })
    expect(Object.keys(complete.channels).sort()).toEqual([...SEARCH_CHANNELS].sort())
  })

  test('incomplete reflects coverage reasons even when the channel is exhausted', async () => {
    const fake = service({ titles: vi.fn(async () => result([article(10)], { exhausted: true, truncated: true, reasons: ['index_only'] })) })
    const events: HybridSearchEvent[] = []
    await new HybridSearchOrchestrator(fake as unknown as HybridSearchService).stream(ctx(), request, new AbortController().signal, event => events.push(event))
    const complete = events.at(-1)
    expect(complete?.type === 'complete' && complete.incomplete).toBe(true)
  })

  test('abort stops delivery and returns without a complete event', async () => {
    const gate = defer<number[]>()
    const fake = service({
      titles: vi.fn(async () => result([article(10)])),
      queryEmbedding: vi.fn(() => gate.promise),
      articleVector: vi.fn(async () => result([article(11)])),
      collectionVector: vi.fn(async () => result([collection(30)]))
    })
    const controller = new AbortController()
    const events: HybridSearchEvent[] = []
    const run = new HybridSearchOrchestrator(fake as unknown as HybridSearchService).stream(ctx(), request, controller.signal, event => events.push(event))
    await flush()
    expect(events.some(event => event.type === 'partial' && event.channel === 'titles')).toBe(true)
    controller.abort()
    gate.resolve(new Array(1024).fill(0))
    await run
    expect(events.some(event => event.type === 'complete')).toBe(false)
    expect(events.some(event => event.channel === 'article_vector')).toBe(false)
  })
})
