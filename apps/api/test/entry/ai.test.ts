import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ coreFetch: vi.fn() }))

vi.mock('@/entry/core', () => ({ default: { fetch: mocks.coreFetch } }))

vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class<Environment> {
    protected env: Environment
    constructor(_ctx: ExecutionContext, env: Environment) {
      this.env = env
    }
  }
}))

import ai, { AiEntry } from '@/entry/ai'

const execution = {} as ExecutionContext

function buildEnv() {
  const indexes = [0, 1, 2, 3, 4].map(() => ({
    query: vi.fn().mockResolvedValue({ matches: [], count: 0 }),
    upsert: vi.fn().mockResolvedValue({ ids: ['a'], count: 1 }),
    deleteByIds: vi.fn().mockResolvedValue({ ids: ['a'], count: 1 })
  }))
  const env = {
    VECTORIZE1: indexes[0],
    VECTORIZE2: indexes[1],
    VECTORIZE3: indexes[2],
    VECTORIZE4: indexes[3],
    VECTORIZE5: indexes[4]
  } as unknown as Env
  return { env, indexes }
}

describe('AiEntry RPC surface', () => {
  test('default fetch delegates AIGC requests to the existing HTTP worker', async () => {
    const request = new Request('https://api-reader.slax.com/v1/aigc/chat', { method: 'POST' })
    const env = {} as Env
    const ctx = {} as ExecutionContext
    mocks.coreFetch.mockResolvedValueOnce(new Response('ok'))

    const response = await ai.fetch(request, env, ctx)

    expect(mocks.coreFetch).toHaveBeenCalledWith(request, env, ctx)
    expect(await response.text()).toBe('ok')
  })

  test('query forwards to the shard matching the 0-based shard index', async () => {
    const { env, indexes } = buildEnv()
    const entry = new AiEntry(execution, env)

    await entry.query(2, [0.1, 0.2], 30, { bookmark_id: { $in: [1, 2] } } as unknown as VectorizeVectorMetadataFilter)

    expect(indexes[2].query).toHaveBeenCalledWith([0.1, 0.2], { topK: 30, filter: { bookmark_id: { $in: [1, 2] } } })
    expect(indexes[0].query).not.toHaveBeenCalled()
  })

  test('upsert and deleteByIds forward to the matching shard', async () => {
    const { env, indexes } = buildEnv()
    const entry = new AiEntry(execution, env)

    const vectors = [{ id: '1_0', values: [0.1], metadata: { bookmark_id: 1 } }] as unknown as VectorizeVector[]
    await entry.upsert(0, vectors)
    expect(indexes[0].upsert).toHaveBeenCalledWith(vectors)

    await entry.deleteByIds(4, ['1_0'])
    expect(indexes[4].deleteByIds).toHaveBeenCalledWith(['1_0'])
  })

  test('rejects an out-of-range shard index', async () => {
    const { env } = buildEnv()
    const entry = new AiEntry(execution, env)

    await expect(entry.query(5, [0.1], 10, undefined)).rejects.toThrow('invalid vectorize shard index: 5')
  })
})
