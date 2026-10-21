import { afterEach, describe, expect, test, vi } from 'vitest'
import { embedding } from '@/utils/hybridSearch/vectorize'

function createKV() {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    })
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('embedding cache and timeout', () => {
  test('serves a repeated query embedding from KV', async () => {
    const kv = createKV()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [0.1, 0.2] }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const env = { KV: kv, JINA_API_KEY: 'key' } as never
    const execution = { waitUntil: () => {} } as never

    const first = await embedding(env, ['saved article'], execution)
    const second = await embedding(env, ['saved article'], execution)

    expect(first).toEqual([{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }])
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('returns no new embedding when the provider times out', async () => {
    const kv = createKV()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })
    )
    const env = { KV: kv, JINA_API_KEY: 'key' } as never

    const pending = embedding(env, ['slow query'], { waitUntil: () => {} } as never)

    await expect(pending).resolves.toEqual([])
  })
})
