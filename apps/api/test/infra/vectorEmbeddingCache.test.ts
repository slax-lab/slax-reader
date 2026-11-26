import { describe, expect, test, vi } from 'vitest'
import { VectorEmbeddingClient } from '@/infra/external/vectorEmbedding'
import { VECTOR_DIMENSIONS } from '@/utils/vectorEmbedding'

const vector = Array.from({ length: VECTOR_DIMENSIONS }, (_, index) => (index === 0 ? 1 : 0))

function memoryKv(failing = false) {
  const store = new Map<string, string>()
  return {
    store,
    get: vi.fn(async (key: string) => {
      if (failing) throw new Error('kv unavailable')
      const value = store.get(key)
      return value === undefined ? null : JSON.parse(value)
    }),
    put: vi.fn(async (key: string, value: string) => {
      if (failing) throw new Error('kv unavailable')
      store.set(key, value)
    })
  }
}

describe('search-term embedding cache', () => {
  test('reuses the cached vector for the same term and keys it by model, dimensions and text', async () => {
    const kv = memoryKv()
    const client = new VectorEmbeddingClient({ JINA_API_KEY: 'key', KV: kv } as unknown as Env)
    const query = vi.spyOn(client, 'query').mockResolvedValue(vector)

    expect(await client.cachedQuery('reader')).toEqual(vector)
    expect(await client.cachedQuery('reader')).toEqual(vector)
    expect(query).toHaveBeenCalledOnce()
    await client.cachedQuery('Reader')
    expect(query).toHaveBeenCalledTimes(2)
    expect([...kv.store.keys()].every(key => /^search:embedding:[a-f0-9]{64}$/.test(key))).toBe(true)
    expect(kv.put.mock.calls[0][2]).toEqual({ expirationTtl: 7 * 24 * 60 * 60 })
  })

  test('ignores a malformed cache entry and still answers when KV fails', async () => {
    const kv = memoryKv()
    const client = new VectorEmbeddingClient({ JINA_API_KEY: 'key', KV: kv } as unknown as Env)
    const query = vi.spyOn(client, 'query').mockResolvedValue(vector)
    await client.cachedQuery('term')
    for (const key of kv.store.keys()) kv.store.set(key, JSON.stringify([1, 2, 3]))
    expect(await client.cachedQuery('term')).toEqual(vector)
    expect(query).toHaveBeenCalledTimes(2)

    const broken = new VectorEmbeddingClient({ JINA_API_KEY: 'key', KV: memoryKv(true) } as unknown as Env)
    vi.spyOn(broken, 'query').mockResolvedValue(vector)
    expect(await broken.cachedQuery('term')).toEqual(vector)
  })
})
