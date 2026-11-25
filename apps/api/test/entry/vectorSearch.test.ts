import { beforeEach, describe, expect, test, vi } from 'vitest'

// The Vector entry and AI's client speak the internal protocol in src/const/vectorSearch.ts. The native index and
// the encoder are replaced by fakes; the scoring itself runs for real.
const fakes = vi.hoisted(() => ({ query: vi.fn(), embed: vi.fn() }))
vi.mock('@/infra/repository/vectorIndexRepo', () => ({
  VectorIndexRepo: class {
    queryVectors = fakes.query
  }
}))
vi.mock('@/infra/external/vectorEmbedding', () => ({
  VectorEmbeddingClient: class {
    query = fakes.embed
  }
}))

import vector from '@/entry/vector'
import { EDGE_SECRET_HEADER } from '@/const/edge'
import { VECTOR_SEARCH_HOST, VECTOR_SEARCH_PATH } from '@/const/vectorSearch'
import { VectorSearchClient } from '@/infra/external/vectorSearchClient'
import { EMBEDDING_MEAN } from '@/utils/embeddingMean'

const unit = (values: number[]) => {
  const norm = Math.hypot(...values)
  return values.map(value => value / norm)
}
const around = (index: number) => unit(EMBEDDING_MEAN.values.map((value, dimension) => value + (dimension === index ? 1 : 0)))
const env = { EDGE_SHARED_SECRET: 'shared' } as unknown as Env
const url = `https://${VECTOR_SEARCH_HOST}${VECTOR_SEARCH_PATH}`
const call = (init: RequestInit & { url?: string } = {}) =>
  vector.fetch(
    new Request(init.url ?? url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [EDGE_SECRET_HEADER]: 'shared', ...(init.headers as Record<string, string>) },
      body: JSON.stringify({ userId: 7, keyword: 'term' }),
      ...init
    }),
    env
  )

beforeEach(() => {
  fakes.query.mockReset()
  fakes.embed.mockReset()
})

describe('Vector entry', () => {
  test('embeds once, queries the caller with values in one call and returns unbounded centered scores', async () => {
    fakes.embed.mockResolvedValue(around(0))
    fakes.query.mockResolvedValue([
      { id: 'a:7:2', score: 0.8, values: around(2) },
      { id: 'a:7:1', score: 0.9, values: around(0) },
      { id: 'a:9:3', score: 0.99, values: around(0) }
    ])

    const response = await call()

    expect(response.status).toBe(200)
    const body = (await response.json()) as { candidates: { id: number; score: number }[]; timings: Record<string, number> }
    expect(fakes.embed).toHaveBeenCalledExactlyOnceWith('term')
    expect(fakes.query).toHaveBeenCalledExactlyOnceWith('article', expect.any(Array), { userId: 7, limit: 50, values: true })
    expect(body.candidates.map(item => item.id)).toEqual([1, 2])
    expect(body.candidates[0].score).toBeCloseTo(1, 5)
    expect(Object.keys(body.timings).sort()).toEqual(['embedding', 'query'])
  })

  test('rejects a missing or wrong secret before any embedding or query', async () => {
    for (const headers of [{ [EDGE_SECRET_HEADER]: 'other' }, { [EDGE_SECRET_HEADER]: '' }]) expect((await call({ headers })).status).toBe(403)
    expect((await vector.fetch(new Request(url, { method: 'POST', headers: { [EDGE_SECRET_HEADER]: 'shared' }, body: '{}' }), {} as Env)).status).toBe(403)
    expect(fakes.embed).not.toHaveBeenCalled()
  })

  test('answers not found for any other host, path or method', async () => {
    for (const init of [{ url: 'https://reader-vector.example/search' }, { url: `https://${VECTOR_SEARCH_HOST}/other` }, { method: 'GET', body: undefined }])
      expect((await call(init)).status).toBe(404)
    expect(fakes.embed).not.toHaveBeenCalled()
  })

  test('rejects an invalid body', async () => {
    for (const body of [
      'not json',
      '[]',
      JSON.stringify({ userId: 0, keyword: 'x' }),
      JSON.stringify({ userId: 1.5, keyword: 'x' }),
      JSON.stringify({ userId: 7, keyword: ' ' }),
      JSON.stringify({ userId: 7, keyword: 'x'.repeat(501) })
    ])
      expect((await call({ body })).status).toBe(400)
    expect(fakes.embed).not.toHaveBeenCalled()
  })

  test('reports an encoder or index failure as a server error without its message', async () => {
    fakes.embed.mockRejectedValue(new Error('jina detail'))
    const response = await call()
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('jina detail')
  })
})

describe('AI client for the Vector Worker', () => {
  test('sends the secret and the request to the internal host and validates the answer', async () => {
    const service = { fetch: vi.fn(async () => Response.json({ candidates: [{ id: 4, score: 0.6 }], timings: { embedding: 80, query: 210 } })) }
    const client = new VectorSearchClient({ VECTOR_SEARCH: service, EDGE_SHARED_SECRET: 'shared' } as unknown as Env)

    expect(client.available).toBe(true)
    expect(await client.search({ userId: 7, keyword: 'term' })).toEqual({ candidates: [{ id: 4, score: 0.6 }], timings: { embedding: 80, query: 210 } })
    const [target, init] = service.fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(target).toBe(url)
    expect(new Headers(init.headers).get(EDGE_SECRET_HEADER)).toBe('shared')
    expect(JSON.parse(String(init.body))).toEqual({ userId: 7, keyword: 'term' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  test('fails on an error status or a malformed answer, and is unavailable without the binding', async () => {
    const answers = [new Response('no', { status: 500 }), Response.json({ candidates: [{ id: 0, score: 1 }] }), Response.json({ rows: [] })]
    const service = { fetch: vi.fn(async () => answers.shift()!) }
    const client = new VectorSearchClient({ VECTOR_SEARCH: service, EDGE_SHARED_SECRET: 'shared' } as unknown as Env)
    await expect(client.search({ userId: 7, keyword: 'term' })).rejects.toThrow('vector_search_status_500')
    await expect(client.search({ userId: 7, keyword: 'term' })).rejects.toThrow('invalid_vector_search_response')
    await expect(client.search({ userId: 7, keyword: 'term' })).rejects.toThrow('invalid_vector_search_response')

    const absent = new VectorSearchClient({ EDGE_SHARED_SECRET: 'shared' } as unknown as Env)
    expect(absent.available).toBe(false)
    await expect(absent.search({ userId: 7, keyword: 'term' })).rejects.toThrow('missing_vector_search_binding')
  })
})
