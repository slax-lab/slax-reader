import { describe, expect, test } from 'vitest'
import {
  addContribution,
  emptyPreferenceSums,
  nextPreferenceSeq,
  packSum,
  parseInterests,
  PREFERENCE_BATCH_SIZE,
  PreferenceQueue,
  publicationScope,
  unpackSum,
  vectorToken,
  type PreferenceCall
} from '@/utils/preferenceLedger'
import { referenceCenter } from '../helpers/recommendationReference'

const spread = (seed: number) => Array.from({ length: 1024 }, (_, i) => Math.sin(seed + i * 0.37))
const norm = (values: ArrayLike<number>) => Math.sqrt(Array.from(values).reduce((sum, value) => sum + value * value, 0))

describe('preference ledger', () => {
  test('vector tokens are stable for identical Float32 values and change with any component', () => {
    const values = spread(1)
    expect(vectorToken(values)).toMatch(/^[0-9a-f]{16}$/)
    expect(vectorToken(Float32Array.from(values))).toBe(vectorToken(values))
    const changed = values.slice()
    changed[1023] += 0.001
    expect(vectorToken(changed)).not.toBe(vectorToken(values))
    expect(() => vectorToken(values.slice(1))).toThrow('invalid_vector_dimensions')
  })

  test('adding then subtracting a contribution returns the sums to their previous values', () => {
    const sums = emptyPreferenceSums('mean', 1)
    addContribution(sums, spread(1), 1, true, 1)
    const before = [sums.raw.slice(), sums.centered.slice(), sums.owner.slice()]
    addContribution(sums, spread(2), 2, true, 1)
    addContribution(sums, spread(2), 2, true, -1)
    ;[sums.raw, sums.centered, sums.owner].forEach((sum, index) => sum.forEach((value, i) => expect(value).toBeCloseTo(before[index][i], 12)))
  })

  test('contributions add weighted normalized and centered vectors; the owner sum adds members with weight one', () => {
    const sums = emptyPreferenceSums('mean', 1)
    const values = spread(3)
    addContribution(sums, values, 2, true, 1)
    expect(norm(sums.raw)).toBeCloseTo(2, 10)
    expect(norm(sums.owner)).toBeCloseTo(1, 10)
    const centered = referenceCenter(Array.from(values, value => value / norm(values)))
    sums.centered.forEach((value, i) => expect(value).toBeCloseTo(2 * centered[i], 10))
    addContribution(sums, spread(4), 1, false, 1)
    expect(norm(sums.owner)).toBeCloseTo(1, 10)
  })

  test('sums survive packing, all-zero sums pack to an empty blob and corrupted blobs are rejected', () => {
    const sums = emptyPreferenceSums('mean', 1)
    expect(packSum(sums.raw).length).toBe(0)
    expect(unpackSum(new Uint8Array())).toEqual(new Float64Array(1024))
    addContribution(sums, spread(5), 1, false, 1)
    expect(unpackSum(packSum(sums.raw))).toEqual(sums.raw)
    expect(() => unpackSum(new Uint8Array(7))).toThrow('invalid_preference_state')
    expect(() => unpackSum(new Uint8Array(new Float64Array(1024).fill(Number.NaN).buffer))).toThrow('invalid_preference_state')
  })

  test('stored interests must be medoid and importance pairs', () => {
    expect(parseInterests('[[3,1.5],[9,0.25]]')).toEqual([
      [3, 1.5],
      [9, 0.25]
    ])
    for (const bad of ['{', '{}', '[[0,1]]', '[[1]]', '[[1,"x"]]']) expect(() => parseInterests(bad)).toThrow('invalid_preference_state')
  })

  test('sequences are strictly increasing even when the clock is behind', () => {
    const future = Date.now() + 86_400_000
    expect(nextPreferenceSeq(future)).toBe(future + 1)
    expect(nextPreferenceSeq(1)).toBeGreaterThanOrEqual(Date.now() - 1000)
  })

  test('an apply in a batch publishes everything; rebuilds publish the union of their scopes', () => {
    const apply: PreferenceCall = { kind: 'apply', userId: 1, id: 2 }
    const collection: PreferenceCall = { kind: 'rebuild', userId: 1, publish: { user: false, collections: [5] } }
    const article: PreferenceCall = { kind: 'rebuild', userId: 1, publish: { user: true, collections: [] } }
    expect(publicationScope([collection, apply])).toEqual({ user: true, collections: 'all' })
    expect(publicationScope([collection])).toEqual({ user: false, collections: [5] })
    expect(publicationScope([collection, article])).toEqual({ user: true, collections: [5] })
  })
})

describe('preference queue', () => {
  test('runs one batch at a time and combines calls that arrive while a batch runs', async () => {
    let running = 0
    let overlap = false
    const batches: number[][] = []
    let release: () => void = () => {}
    const queue = new PreferenceQueue(async calls => {
      running++
      overlap ||= running > 1
      batches.push(calls.map(call => (call.kind === 'apply' ? call.id : 0)))
      if (batches.length === 1) await new Promise<void>(resolve => (release = resolve))
      running--
      return [{ target: { kind: 'user', id: 1, preference: 'article' }, state: 'written', vectorIds: [], mutationIds: [] }]
    })
    const first = queue.submit({ kind: 'apply', userId: 1, id: 1 })
    const rest = [2, 3, 4].map(id => queue.submit({ kind: 'apply', userId: 1, id }))
    await Promise.resolve()
    release()
    await Promise.all([first, ...rest])
    expect(overlap).toBe(false)
    expect(batches).toEqual([[1], [2, 3, 4]])
  })

  test('a failed batch rejects only its own calls and later calls still run', async () => {
    let calls = 0
    const queue = new PreferenceQueue(async () => {
      if (calls++ === 0) throw new Error('first_batch_failed')
      return []
    })
    const failed = queue.submit({ kind: 'apply', userId: 1, id: 1 })
    await expect(failed).rejects.toThrow('first_batch_failed')
    await expect(queue.submit({ kind: 'apply', userId: 1, id: 2 })).resolves.toEqual([])
  })

  test('batches never mix users and never exceed the batch size', async () => {
    const batches: PreferenceCall[][] = []
    let release: () => void = () => {}
    const queue = new PreferenceQueue(async calls => {
      batches.push(calls)
      if (batches.length === 1) await new Promise<void>(resolve => (release = resolve))
      return []
    })
    const pending = [queue.submit({ kind: 'apply', userId: 1, id: 1 })]
    for (let id = 1; id <= PREFERENCE_BATCH_SIZE + 5; id++) pending.push(queue.submit({ kind: 'apply', userId: 1, id }))
    pending.push(queue.submit({ kind: 'apply', userId: 2, id: 1 }))
    await Promise.resolve()
    release()
    await Promise.all(pending)
    expect(batches.map(batch => batch.length)).toEqual([1, PREFERENCE_BATCH_SIZE, 5, 1])
    for (const batch of batches) expect(new Set(batch.map(call => call.userId)).size).toBe(1)
  })
})
