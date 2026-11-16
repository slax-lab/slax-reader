import { describe, expect, test, vi } from 'vitest'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import { ContentRecommendationService } from '@/domain/contentRecommendation'

const axis = (position: number, scale = 1) => Array.from({ length: 1024 }, (_, i) => (i === position ? scale : 0))

function fixture(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: i + 1 }))
  const stored = new Map<string, VectorizeVector>(rows.map(({ id }) => [`c:${id}`, { id: `c:${id}`, values: axis(id % 3, id + 1) }]))
  stored.set('u:7:collection', { id: 'u:7:collection', namespace: 'user-collection', values: axis(20) })
  let active = 0
  let peak = 0
  const repo = {
    listUserCollections: vi.fn(async (_id: number, after: number, limit: number) => rows.filter(row => row.id > after).slice(0, limit)),
    listUserArticles: vi.fn(),
    listRecentUserActions: vi.fn()
  }
  const index = {
    get: vi.fn(async (_kind: string, ids: string[]) => {
      active++
      peak = Math.max(active, peak)
      await new Promise(resolve => setTimeout(resolve, 1))
      active--
      return ids.flatMap(id => (stored.has(id) ? [structuredClone(stored.get(id)!)] : []))
    }),
    upsert: vi.fn(),
    delete: vi.fn(),
    query: vi.fn().mockResolvedValue([])
  }
  const embedding = { embed: vi.fn(), pdf: vi.fn() }
  const preferences = { apply: vi.fn(), rebuild: vi.fn() }
  const service = new VectorMaintenanceService(repo as never, {} as never, embedding as never, index as never, preferences as never)
  const noMaintenance = () => {
    for (const fn of [index.upsert, index.delete, embedding.embed, embedding.pdf, preferences.apply, preferences.rebuild, repo.listUserArticles, repo.listRecentUserActions])
      expect(fn).not.toHaveBeenCalled()
    expect(index.get.mock.calls.every(([kind]) => kind === 'collection')).toBe(true)
  }
  return { service, repo, index, stored, rows, peak: () => peak, noMaintenance }
}

describe('request-local Collection preference', () => {
  test.each([0, 1, 20, 21, 100, 205])('reads all %i subscriptions in bounded batches without materializing', async count => {
    const f = fixture(count)
    const output = await f.service.readCollectionPreference(7)
    expect(output.coverage).toEqual({ eligible: count, used: count, missing: 0 })
    expect(f.repo.listUserCollections.mock.calls.map(call => call[1])).toEqual(Array.from({ length: Math.floor(count / 100) + 1 }, (_, i) => i * 100))
    expect(f.index.get).toHaveBeenCalledTimes(Math.ceil(count / 20))
    expect(f.index.get.mock.calls.every(([, ids]) => ids.length <= 20)).toBe(true)
    expect(f.peak()).toBe(Math.min(4, Math.ceil(count / 20)))
    const sum = [0, 0, 0]
    for (let id = 1; id <= count; id++) sum[id % 3]++
    const norm = Math.hypot(...sum)
    if (count) output.vector!.forEach((value, i) => expect(value).toBeCloseTo((sum[i] ?? 0) / norm, 12))
    else expect(output.vector).toBeNull()
    f.noMaintenance()
  })

  test('an entirely missing first page does not hide later valid vectors', async () => {
    const f = fixture(205)
    for (let id = 1; id <= 200; id++) f.stored.delete(`c:${id}`)
    const result = await f.service.readCollectionPreference(7)
    expect(result.coverage).toEqual({ eligible: 205, used: 5, missing: 200 })
    expect(result.vector!.some(value => value !== 0)).toBe(true)
    expect(f.repo.listUserCollections.mock.calls.map(call => call[1])).toEqual([0, 100, 200])
    f.noMaintenance()
  })

  test.each([0, 3])('returns cold start for %i unavailable sources without the stale stored profile', async count => {
    const f = fixture(count)
    for (const row of f.rows) f.stored.delete(`c:${row.id}`)
    const recommendations = new ContentRecommendationService({} as never, f.service)
    expect(await f.service.readCollectionPreference(7)).toEqual({ vector: null, coverage: { eligible: count, used: 0, missing: count } })
    expect(await recommendations.collections(7)).toEqual({ items: [], preferenceKind: 'collection', reason: 'cold_start' })
    expect(f.index.query).not.toHaveBeenCalled()
    expect(f.stored.has('u:7:collection')).toBe(true)
    f.noMaintenance()
  })

  test('uses a newly visible Collection version on the next read, without subscription actions', async () => {
    const f = fixture(1)
    expect(await f.service.readUser(7, 'collection')).toEqual(axis(1))
    f.stored.set('c:1', { id: 'c:1', values: axis(2, 8) })
    expect(await f.service.readUser(7, 'collection')).toEqual(axis(2))
    expect(f.stored.get('u:7:collection')!.values).toEqual(axis(20))
    f.noMaintenance()
  })

  test.each([
    ['invalid_vector_dimensions', [1, 2]],
    ['invalid_vector_value', Array(1024).fill(NaN)],
    ['empty_vector', Array(1024).fill(0)]
  ] as const)('isolates %s from valid sources', async (_error, values) => {
    const f = fixture(2)
    f.stored.set('c:2', { id: 'c:2', values: Array.from(values) })
    expect(await f.service.readCollectionPreference(7)).toEqual({ vector: axis(1), coverage: { eligible: 2, used: 1, missing: 1 } })
    f.noMaintenance()
  })

  test('transport failure after one valid page is not successful partial aggregation', async () => {
    const f = fixture(101)
    const original = f.index.get.getMockImplementation()!
    f.index.get.mockImplementation(async (kind, ids) => {
      if (ids.includes('c:101')) throw new Error('vector_read_unavailable')
      return original(kind, ids)
    })
    await expect(f.service.readUser(7, 'collection')).rejects.toThrow('vector_read_unavailable')
    f.noMaintenance()
  })

  test('preserves exact native reads for article preferences', async () => {
    const f = fixture(1)
    f.stored.set('u:7:article', { id: 'u:7:article', namespace: 'user-article', values: axis(4) })
    expect(await f.service.readUser(7, 'article')).toEqual(axis(4))
    expect(f.index.get).toHaveBeenCalledExactlyOnceWith('user', ['u:7:article'])
    expect(f.repo.listUserCollections).not.toHaveBeenCalled()
  })
})

describe('retired subscription preference cleanup', () => {
  test('deletes only the legacy key, never aggregates or writes, and skips an absent key', async () => {
    const f = fixture(3)
    f.stored.set('u:7:article', { id: 'u:7:article', namespace: 'user-article', values: axis(4) })
    f.stored.set('u:8:collection', { id: 'u:8:collection', namespace: 'user-collection', values: axis(5) })
    f.index.delete.mockImplementation(async (_kind: string, ids: string[]) => {
      for (const id of ids) f.stored.delete(id)
      return { mutationId: 'cleanup' }
    })
    const before = [...f.stored.keys()].filter(id => id !== 'u:7:collection')
    const output = await f.service.refreshUser(7, 'collection')
    expect(output).toMatchObject({ state: 'deleted', reason: 'collection_preference_on_demand', vectorIds: ['u:7:collection'], mutationIds: ['cleanup'] })
    expect(output.coverage).toBeUndefined()
    expect(await f.service.verifyRefresh(output)).toBe(true)
    expect([...f.stored.keys()]).toEqual(before)
    expect(f.repo.listUserCollections).not.toHaveBeenCalled()
    expect(f.index.upsert).not.toHaveBeenCalled()
    expect(f.index.get.mock.calls.every(([kind, ids]) => kind === 'user' && ids.every(id => id === 'u:7:collection'))).toBe(true)
    expect(await f.service.refreshUser(7, 'collection')).toMatchObject({ state: 'empty', reason: 'collection_preference_on_demand', mutationIds: [], vectorIds: [] })
    expect(f.index.delete).toHaveBeenCalledOnce()
  })

  test('accepted deletion is not verified until the legacy record is absent', async () => {
    const f = fixture(1)
    f.index.delete.mockResolvedValue({ mutationId: 'not-visible-yet' })
    const output = await f.service.refreshUser(7, 'collection')
    expect(output.state).toBe('deleted')
    expect(await f.service.verifyRefresh(output)).toBe(false)
    f.stored.delete('u:7:collection')
    expect(await f.service.verifyRefresh(output)).toBe(true)
  })

  test('delete failure does not claim successful retirement', async () => {
    const f = fixture(1)
    f.index.delete.mockRejectedValue(new Error('cleanup_unavailable'))
    expect(await f.service.refreshUser(7, 'collection')).toMatchObject({ state: 'failed', reason: 'cleanup_unavailable' })
    expect(f.stored.has('u:7:collection')).toBe(true)
    expect(f.repo.listUserCollections).not.toHaveBeenCalled()
    expect(f.index.upsert).not.toHaveBeenCalled()
  })
})
