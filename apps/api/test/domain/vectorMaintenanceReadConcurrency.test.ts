import { describe, expect, test, vi } from 'vitest'
import { VectorMaintenanceService } from '../../src/domain/vectorMaintenance'
import { memoryPreferenceStates } from '../helpers/preferenceStateMemory'

const flush = async (turns = 12) => {
  for (let index = 0; index < turns; index++) await Promise.resolve()
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((inner, fail) => {
    resolve = inner
    reject = fail
  })
  return { promise, resolve, reject }
}

const unitVector = () => Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0))
const vectorsFor = (ids: string[]) => ids.map(id => ({ id, values: unitVector() }))

function trackingIndex() {
  const calls: string[][] = []
  const pending: Array<Deferred<Array<{ id: string; values: number[] }>>> = []
  let inFlight = 0
  let peak = 0
  const index = {
    get: vi.fn(async (kind: string, ids: string[]) => {
      calls.push([...ids])
      inFlight += 1
      peak = Math.max(peak, inFlight)
      const gate = deferred<Array<{ id: string; values: number[] }>>()
      pending.push(gate)
      gate.promise.then(
        () => (inFlight -= 1),
        () => (inFlight -= 1)
      )
      return gate.promise
    })
  }
  return { index, calls, pending, peak: () => peak, inFlight: () => inFlight }
}

const service = (index: unknown) => new VectorMaintenanceService({} as never, {} as never, {} as never, index as never, memoryPreferenceStates())

describe('vector read batching', () => {
  test('101 article identities fan out to at most four concurrent 20-id reads with results merged', async () => {
    const tracked = trackingIndex()
    const reading = service(tracked.index).readArticles(Array.from({ length: 101 }, (_, index) => ({ userId: 1, id: index + 1 })))
    await flush()

    expect(tracked.calls).toHaveLength(4)
    expect(tracked.calls.map(page => page.length)).toEqual([20, 20, 20, 20])
    expect(tracked.calls[0]).toEqual(Array.from({ length: 20 }, (_, index) => `a:1:${index + 1}`))
    expect(tracked.calls[1][0]).toBe('a:1:21')
    expect(tracked.calls[3][19]).toBe('a:1:80')
    expect(tracked.peak()).toBe(4)
    expect(tracked.inFlight()).toBe(4)

    tracked.pending[0].resolve(vectorsFor(tracked.calls[0]))
    await flush()
    expect(tracked.calls).toHaveLength(5)
    expect(tracked.calls[4][0]).toBe('a:1:81')
    expect(tracked.calls[4]).toHaveLength(20)
    expect(tracked.peak()).toBe(4)
    expect(tracked.inFlight()).toBe(4)

    tracked.pending[1].resolve(vectorsFor(tracked.calls[1]))
    await flush()
    expect(tracked.calls).toHaveLength(6)
    expect(tracked.calls[5]).toEqual(['a:1:101'])
    expect(tracked.peak()).toBe(4)

    for (let position = 2; position < tracked.pending.length; position++) {
      tracked.pending[position].resolve(vectorsFor(tracked.calls[position]))
      await flush()
    }
    const result = await reading

    expect(tracked.calls.map(page => page.length)).toEqual([20, 20, 20, 20, 20, 1])
    expect(tracked.peak()).toBe(4)
    expect(tracked.inFlight()).toBe(0)
    expect(result.size).toBe(101)
    expect(result.get('a:1:1')?.[0]).toBe(1)
    expect(result.get('a:1:1')).toHaveLength(1024)
    expect(result.get('a:1:101')?.[0]).toBe(1)
  })

  test('101 collection ids use the same four-worker twenty-id batching', async () => {
    const tracked = trackingIndex()
    const reading = service(tracked.index).readCollections(Array.from({ length: 101 }, (_, index) => index + 1))
    await flush()

    expect(tracked.calls.map(page => page.length)).toEqual([20, 20, 20, 20])
    expect(tracked.calls[0][0]).toBe('c:1')
    expect(tracked.calls[0][19]).toBe('c:20')
    expect(tracked.peak()).toBe(4)

    tracked.pending[0].resolve(vectorsFor(tracked.calls[0]))
    await flush()
    expect(tracked.calls).toHaveLength(5)
    expect(tracked.calls[4][0]).toBe('c:81')

    for (let position = 1; position < tracked.pending.length; position++) {
      tracked.pending[position].resolve(vectorsFor(tracked.calls[position]))
      await flush()
    }
    const result = await reading

    expect(tracked.calls.map(page => page.length)).toEqual([20, 20, 20, 20, 20, 1])
    expect(tracked.peak()).toBe(4)
    expect(result.size).toBe(101)
    expect(result.get(1)?.[0]).toBe(1)
    expect(result.get(1)).toHaveLength(1024)
    expect(result.get(101)?.[0]).toBe(1)
  })

  test('a rejected index read rejects the caller without retrying', async () => {
    const tracked = trackingIndex()
    const reading = service(tracked.index).readArticles([{ userId: 1, id: 1 }])
    await flush()

    tracked.pending[0].reject(new Error('vector_index_unavailable'))
    await expect(reading).rejects.toThrow('vector_index_unavailable')
    expect(tracked.calls).toHaveLength(1)
  })

  test('an identity outside the requested page rejects the whole read', async () => {
    const tracked = trackingIndex()
    const reading = service(tracked.index).readArticles([{ userId: 1, id: 1 }])
    await flush()

    tracked.pending[0].resolve([...vectorsFor(tracked.calls[0]), { id: 'a:2:2', values: [0, 1] }])
    await expect(reading).rejects.toThrow('unexpected_vector_identity')
  })
})
