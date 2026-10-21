import { afterEach, describe, expect, test, vi } from 'vitest'
import { embedding } from '@/utils/hybridSearch/vectorize'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('embedding timeout', () => {
  test('returns no embedding when the provider times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })
    )
    const env = { JINA_API_KEY: 'key' } as never

    const pending = embedding(env, ['slow query'])

    await expect(pending).resolves.toEqual([])
  })
})
