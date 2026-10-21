import { describe, expect, test, vi } from 'vitest'
import { SearchService, SEARCH_RESULT_LIMIT } from '@/domain/search'
import { BookmarkSearchRepo } from '@/infra/repository/dbBookmarkSearch'
import { VectorizeRepo } from '@/infra/repository/dbVectorize'
import { CandidateCollector } from '@/utils/hybridSearch/topCandidates'

vi.mock('@/utils/hybridSearch/normalizer', () => ({
  Normalizer: class {
    async processSearchKeyword(keyword: string) {
      return keyword
    }
  }
}))
vi.mock('@/utils/hybridSearch/vectorize', () => ({ embedding: vi.fn().mockResolvedValue([]) }))

function createKV() {
  const store = new Map<string, string>()
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    })
  }
}

describe('search optimization bounds', () => {
  test('groups 120 rows into three 50-row statements', async () => {
    const groups: number[][] = []
    const searchRepo = {
      seachBM25Batch: vi.fn(async (_ctx: unknown, rowIdGroups: number[][], _keyword: string, onRows?: (rows: unknown[]) => void) => {
        groups.push(...rowIdGroups)
        onRows?.([])
        return { rows: [], complete: true }
      })
    }
    const service = new SearchService({} as never, searchRepo as never, {} as never)
    const items = Array.from({ length: 120 }, (_, index) => ({ bmId: index + 1, shardIdx: 0, rowId: index + 1 }))

    await service.fulltextSearch({ getUserId: () => 7 } as never, 'keyword', items)

    expect(searchRepo.seachBM25Batch).toHaveBeenCalledTimes(1)
    expect(groups).toHaveLength(3)
    expect(groups.map(group => group.length)).toEqual([50, 50, 20])
    expect(groups[0][0]).toBe(120)
  })

  test('caps fulltext rows at 30,000 and groups at 600', async () => {
    const groups: number[][] = []
    const searchRepo = {
      seachBM25Batch: vi.fn(async (_ctx: unknown, rowIdGroups: number[][], _keyword: string, onRows?: (rows: unknown[]) => void) => {
        groups.push(...rowIdGroups)
        onRows?.([])
        return { rows: [], complete: true }
      })
    }
    const service = new SearchService({} as never, searchRepo as never, {} as never)
    const items = Array.from({ length: 30010 }, (_, index) => ({ bmId: index + 1, shardIdx: 0, rowId: index + 1 }))

    await service.fulltextSearch({ getUserId: () => 7 } as never, 'keyword', items)

    expect(groups).toHaveLength(600)
    expect(groups[0][0]).toBe(30010)
    expect(groups[groups.length - 1]).toHaveLength(50)
  })

  test('publishes at most 100 ranked results', () => {
    const service = new SearchService({} as never, {} as never, {} as never)
    const map: Record<number, ReturnType<typeof makeItem>> = {}
    for (let id = 1; id <= 150; id++) map[id] = makeItem(id)
    const uuidMap = new Map(Array.from({ length: 150 }, (_, index) => [index + 1, `uuid-${index + 1}`]))

    const results = service.processHybridSearchList(map, uuidMap)

    expect(results).toHaveLength(SEARCH_RESULT_LIMIT)
    expect(results[0].final_score).toBeGreaterThanOrEqual(results[results.length - 1].final_score)
  })

  test('clears row/shard caches without writing', async () => {
    const kv = createKV()
    const service = new SearchService({} as never, {} as never, {} as never)

    await service.clearSearchCache({ env: { KV: kv } } as never, 7)

    expect(kv.put).not.toHaveBeenCalled()
    expect(kv.delete).toHaveBeenCalledWith('search:bm_rows:7')
    expect(kv.delete).toHaveBeenCalledWith('search:bm_shard:7')
  })
})

describe('fulltext candidate collection', () => {
  test('keeps the same top 300 as a full sort', () => {
    let seed = 3
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const items = Array.from({ length: 2000 }, (_, index) => ({ bookmark_id: index + 1, score: -random() }))
    const expected = [...items].sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || a.bookmark_id - b.bookmark_id).slice(0, 300)
    const collector = new CandidateCollector<(typeof items)[number]>(300, 500, item => item.bookmark_id, (a, b) => Math.abs(b.score) - Math.abs(a.score) || a.bookmark_id - b.bookmark_id)

    for (const item of items) collector.push(item)

    expect(collector.values().map(item => item.bookmark_id)).toEqual(expected.map(item => item.bookmark_id))
  })
})

describe('raw index write batching', () => {
  test('splits 17 shards into 16-row inserts inside one batch', async () => {
    const prepared: Array<{ sql: string; params: unknown[] }> = []
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => {
        const statement = { sql, params }
        prepared.push(statement)
        return statement
      })
    }))
    const batch = vi.fn(async (statements: unknown[]) => statements.map(() => ({ results: [] })))
    const repo = new BookmarkSearchRepo((() => ({})) as never)
    const ctx = { env: { DB_FULLTEXT: { prepare, batch } } } as never
    const shards = Array.from({ length: 17 }, (_, index) => ({
      shard_idx: index,
      bookmark_id: 11,
      content: `content-${index}`,
      rawContent: `raw-${index}`,
      title: 'title',
      rawTitle: 'raw title'
    }))

    await repo.createBookmarkRaw(ctx, shards)

    expect(batch).toHaveBeenCalledTimes(1)
    expect(prepared).toHaveLength(3)
    expect(prepared[0].sql).toContain('DELETE FROM slax_bookmark_raw')
    expect(prepared[1].params).toHaveLength(96)
    expect(prepared[2].params).toHaveLength(6)
  })
})

describe('external query timeouts', () => {
  test('drops a vector query that exceeds 500ms', async () => {
    vi.useFakeTimers()
    const query = vi.fn(() => new Promise(() => {}))
    const repo = new VectorizeRepo((() => [{ query }]) as never)
    const pending = repo.seachVector([0.1], [1], 0)
    await vi.advanceTimersByTimeAsync(500)
    await expect(pending).resolves.toEqual({ count: 0, matches: [] })
    vi.useRealTimers()
  })
})

function makeItem(id: number) {
  return {
    bookmark_id: id,
    vs_score: 0,
    fts_score: -id,
    type: 'fts' as const,
    title: 'title',
    content: 'body',
    highlight_title: '[highlight]title[/highlight]',
    highlight_content: '[highlight]body[/highlight]'
  }
}
