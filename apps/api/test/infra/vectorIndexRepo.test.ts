import { describe, expect, test, vi } from 'vitest'

vi.mock('@/entry/core', () => ({ default: { fetch: vi.fn() } }))
vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class {
    protected env: Env
    constructor(_ctx: ExecutionContext, env: Env) {
      this.env = env
    }
  }
}))

import { AiEntry } from '@/entry/ai'
import { VectorIndexClient } from '@/infra/repository/vectorIndexClient'
import { VectorIndexRepo } from '@/infra/repository/vectorIndexRepo'

const unit = (axis = 0) => Array.from({ length: 1024 }, (_, index) => (index === axis ? 1 : 0))
const vectorWith = (...leading: number[]) => Array.from({ length: 1024 }, (_, index) => leading[index] ?? 0)

function nativeIndex() {
  const stored = new Map<string, VectorizeVector>()
  return {
    stored,
    getByIds: vi.fn(async (ids: string[]) => ids.flatMap(id => (stored.has(id) ? [stored.get(id)!] : []))),
    upsert: vi.fn(async (vectors: VectorizeVector[]) => {
      for (const vector of vectors) stored.set(vector.id, vector)
      return { mutationId: `mutation-${vectors[0].id}` }
    }),
    deleteByIds: vi.fn(async (ids: string[]) => {
      for (const id of ids) stored.delete(id)
      return { mutationId: `mutation-${ids[0]}` }
    }),
    query: vi.fn(async () => ({ matches: [{ id: 'a:1:2', score: 0.75 }], count: 1 }))
  }
}

function environment() {
  const article = nativeIndex()
  const collection = nativeIndex()
  const user = nativeIndex()
  const legacy = [0, 1, 2, 3, 4].map(() => nativeIndex())
  const env = {
    VECTOR_V5_ARTICLE: article,
    VECTOR_V5_COLLECTION: collection,
    VECTOR_V5_USER: user,
    VECTORIZE1: legacy[0],
    VECTORIZE2: legacy[1],
    VECTORIZE3: legacy[2],
    VECTORIZE4: legacy[3],
    VECTORIZE5: legacy[4]
  } as unknown as Env
  return { env, article, collection, user, legacy }
}

const articleVector = (overrides: Partial<VectorizeVector> = {}): VectorizeVector =>
  ({
    id: 'a:1:2',
    values: vectorWith(3, 4),
    metadata: {
      user_id: 1,
      bookmark_id: 2,
      kind: 'article',
      part_count: 1,
      source_updated_at: 1,
      published_at: 2,
      private_user: 0
    },
    ...overrides
  }) as VectorizeVector

const chunkVector = (overrides: Partial<VectorizeVector> = {}): VectorizeVector =>
  ({
    id: 'a:1:2:c:0',
    values: unit(),
    metadata: {
      user_id: 1,
      bookmark_id: 2,
      kind: 'chunk',
      part_index: 0,
      source_updated_at: 1,
      published_at: 2,
      private_user: 0
    },
    ...overrides
  }) as VectorizeVector

const collectionVector = (overrides: Partial<VectorizeVector> = {}): VectorizeVector =>
  ({
    id: 'c:5',
    values: vectorWith(3, 4),
    metadata: { collection_id: 5, owner_id: 1, recommendable: true, published_at: 7 },
    ...overrides
  }) as VectorizeVector

const userVector = (): VectorizeVector => ({ id: 'u:1:article', namespace: 'user-article', values: vectorWith(3, 4) }) as VectorizeVector

describe('VectorIndexRepo native validation and filters', () => {
  test.each([
    ['article', ['a:1:2'], 'article'],
    ['article', ['a:1:2:c:0'], 'article'],
    ['collection', ['c:5'], 'collection'],
    ['user', ['u:1:article', 'u:1:article:centered', 'u:1:collection'], 'user']
  ] as const)('%s by-ID reads accept their exact identity grammar', async (kind, ids, indexName) => {
    const { env, article, collection, user } = environment()
    const repo = new VectorIndexRepo(env)
    await repo.getVectorsByIds(kind, [...ids])
    expect({ article, collection, user }[indexName].getByIds).toHaveBeenCalledExactlyOnceWith([...ids])
  })

  test.each([
    ['article', ['a:1']],
    ['article', ['a:0:2']],
    ['article', ['a:1:2:c:']],
    ['collection', ['a:1:2']],
    ['collection', ['c:0']],
    ['user', ['u:1:article:centred']],
    ['user', ['u:1:article:centered:extra']],
    ['user', ['u:1:collection:centered']],
    ['user', ['u:0:article']],
    ['article', ['a:1:2', 'a:1']],
    ['article', []],
    ['article', Array.from({ length: 101 }, (_, index) => `a:1:${index + 2}`)]
  ] as const)('%s rejects invalid ids %j without touching the binding', async (kind, ids) => {
    const { env, article, collection, user } = environment()
    const repo = new VectorIndexRepo(env)
    await expect(repo.getVectorsByIds(kind, [...ids] as string[])).rejects.toThrow('invalid_v5_ids')
    expect(article.getByIds).not.toHaveBeenCalled()
    expect(collection.getByIds).not.toHaveBeenCalled()
    expect(user.getByIds).not.toHaveBeenCalled()
  })

  test('accepts the maximum native batch of one hundred identities', async () => {
    const { env, article } = environment()
    const repo = new VectorIndexRepo(env)
    const ids = Array.from({ length: 100 }, (_, index) => `a:1:${index + 2}`)
    await repo.getVectorsByIds('article', ids)
    expect(article.getByIds).toHaveBeenCalledExactlyOnceWith(ids)
    const vectors = ids.map(id => articleVector({ id, metadata: { ...articleVector().metadata, bookmark_id: Number(id.split(':')[2]) } }))
    await repo.upsertVectors('article', vectors)
    expect(article.upsert).toHaveBeenCalledExactlyOnceWith(vectors)
  })

  test('an unconfigured binding fails explicitly', async () => {
    const repo = new VectorIndexRepo({} as Env)
    await expect(repo.getVectorsByIds('article', ['a:1:2'])).rejects.toThrow('missing_v5_index')
  })

  test('upsert normalizes values in place and forwards the exact batch to its own binding', async () => {
    const { env, article, collection, user } = environment()
    const repo = new VectorIndexRepo(env)
    const vectors = [articleVector()]
    const mutation = await repo.upsertVectors('article', vectors)
    expect(mutation).toEqual({ mutationId: 'mutation-a:1:2' })
    expect(vectors[0].values.slice(0, 2).map(value => Number(value.toFixed(6)))).toEqual([0.6, 0.8])
    expect(article.upsert).toHaveBeenCalledExactlyOnceWith(vectors)
    expect(collection.upsert).not.toHaveBeenCalled()
    expect(user.upsert).not.toHaveBeenCalled()
  })

  test('upsert accepts a user namespace with raw and centered records', async () => {
    const { env, user } = environment()
    const repo = new VectorIndexRepo(env)
    const vectors = [userVector(), { id: 'u:1:article:centered', namespace: 'user-article', values: vectorWith(0, 3) } as VectorizeVector]
    await repo.upsertVectors('user', vectors)
    expect(vectors[1].values.slice(0, 2)).toEqual([0, 1])
    expect(user.upsert).toHaveBeenCalledExactlyOnceWith(vectors)
  })

  test('upsert accepts an article chunk with matching part metadata', async () => {
    const { env, article } = environment()
    const repo = new VectorIndexRepo(env)
    const vectors = [chunkVector()]
    await repo.upsertVectors('article', vectors)
    expect(article.upsert).toHaveBeenCalledExactlyOnceWith(vectors)
  })

  test.each([
    ['empty batch', []],
    ['oversized batch', Array.from({ length: 101 }, (_, index) => articleVector({ id: `a:1:${index + 2}` }))],
    ['missing article metadata', [{ ...articleVector(), metadata: undefined } as VectorizeVector]],
    ['non-finite publication', [articleVector({ metadata: { ...articleVector().metadata, published_at: Infinity } as never })]],
    ['mismatched article owner', [articleVector({ metadata: { ...articleVector().metadata, user_id: 9 } as never })]],
    ['mismatched article kind', [articleVector({ metadata: { ...articleVector().metadata, kind: 'chunk' } as never })]],
    ['mismatched chunk index', [chunkVector({ metadata: { ...chunkVector().metadata, part_index: 2 } as never })]],
    ['missing part count', [articleVector({ metadata: { ...articleVector().metadata, part_count: 0 } as never })]],
    ['invalid private user', [articleVector({ metadata: { ...articleVector().metadata, private_user: -1 } as never })]],
  ] as const)('upsert rejects %s before the native binding', async (_label, vectors) => {
    const { env, article, collection, user } = environment()
    const repo = new VectorIndexRepo(env)
    await expect(repo.upsertVectors('article', [...(vectors as VectorizeVector[])] as VectorizeVector[])).rejects.toThrow(/invalid_v5_|missing_v5/)
    expect(article.upsert).not.toHaveBeenCalled()
    expect(collection.upsert).not.toHaveBeenCalled()
    expect(user.upsert).not.toHaveBeenCalled()
  })

  test('article upsert requires no recommendable marker and preserves an absent field', async () => {
    const { env, article } = environment()
    const repo = new VectorIndexRepo(env)
    const vectors = [articleVector(), chunkVector()]
    expect(vectors[0].metadata).not.toHaveProperty('recommendable')
    expect(vectors[1].metadata).not.toHaveProperty('recommendable')
    await repo.upsertVectors('article', vectors)
    expect(article.upsert).toHaveBeenCalledExactlyOnceWith(vectors)
    expect(article.upsert.mock.calls[0][0].every(vector => !('recommendable' in (vector.metadata ?? {})))).toBe(true)
    const stale = articleVector({ id: 'a:1:3', metadata: { ...articleVector().metadata, bookmark_id: 3, recommendable: false } as never })
    await repo.upsertVectors('article', [stale])
    expect(article.upsert).toHaveBeenCalledTimes(2)
  })

  test('upsert validates the user namespace and Collection identity on their own indexes', async () => {
    const { env, user, collection } = environment()
    const repo = new VectorIndexRepo(env)
    await expect(repo.upsertVectors('user', [{ id: 'u:1:article', namespace: 'user-collection', values: unit() } as VectorizeVector])).rejects.toThrow(
      'invalid_v5_namespace'
    )
    await expect(repo.upsertVectors('collection', [collectionVector({ metadata: { ...collectionVector().metadata, collection_id: 6 } as never })])).rejects.toThrow(
      'invalid_v5_identity'
    )
    await expect(repo.upsertVectors('collection', [collectionVector({ metadata: { ...collectionVector().metadata, owner_id: 0 } as never })])).rejects.toThrow(
      'invalid_v5_identity'
    )
    expect(user.upsert).not.toHaveBeenCalled()
    expect(collection.upsert).not.toHaveBeenCalled()
  })

  test('upsert rejects a payload above four megabytes before the native binding', async () => {
    const { env, article } = environment()
    const repo = new VectorIndexRepo(env)
    const blob = 'x'.repeat(4 * 1024 * 1024 + 1)
    await expect(
      repo.upsertVectors('article', [articleVector({ metadata: { ...articleVector().metadata, blob } as never })])
    ).rejects.toThrow('v5_payload_too_large')
    expect(article.upsert).not.toHaveBeenCalled()
  })

  test('delete validates every identity and returns the native mutation', async () => {
    const { env, collection, article } = environment()
    const repo = new VectorIndexRepo(env)
    await expect(repo.deleteVectorsByIds('collection', ['c:5', 'c:0'])).rejects.toThrow('invalid_v5_ids')
    expect(collection.deleteByIds).not.toHaveBeenCalled()
    await expect(repo.deleteVectorsByIds('collection', ['c:5'])).resolves.toEqual({ mutationId: 'mutation-c:5' })
    expect(collection.deleteByIds).toHaveBeenCalledExactlyOnceWith(['c:5'])
    expect(article.deleteByIds).not.toHaveBeenCalled()
  })

  test('article queries require the owner filter and drop values and metadata', async () => {
    const { env, article, collection } = environment()
    const repo = new VectorIndexRepo(env)
    const result = await repo.queryVectors('article', vectorWith(3, 4), { userId: 42, limit: 100 })
    expect(result).toEqual([{ id: 'a:1:2', score: 0.75 }])
    const [vector, options] = article.query.mock.calls[0]
    expect(vector.slice(0, 2).map(value => Number(value.toFixed(6)))).toEqual([0.6, 0.8])
    expect(options).toEqual({ topK: 100, filter: { kind: 'article', user_id: 42 }, returnValues: false, returnMetadata: 'none' })
    expect(collection.query).not.toHaveBeenCalled()
    for (const scope of [{ recommendable: true }, { userId: 42, recommendable: true }, { userId: 0 }, { userId: 1.5 }, {}] as never[]) {
      await expect(repo.queryVectors('article', unit(), scope)).rejects.toThrow('invalid_v5_query_scope')
    }
    expect(article.query).toHaveBeenCalledOnce()
  })

  test('owned article queries default to topK twenty and keep the exact user filter', async () => {
    const { env, article } = environment()
    const repo = new VectorIndexRepo(env)
    await repo.queryVectors('article', unit(), { userId: 42 })
    expect(article.query.mock.calls[0][1]).toEqual({ topK: 20, filter: { kind: 'article', user_id: 42 }, returnValues: false, returnMetadata: 'none' })
  })

  test('Collection queries always constrain to recommendable candidates and validate the index kind', async () => {
    const { env, collection } = environment()
    const repo = new VectorIndexRepo(env)
    await repo.queryVectors('collection', unit(2), { limit: 100 })
    expect(collection.query.mock.calls[0][1]).toEqual({ topK: 100, filter: { recommendable: true }, returnValues: false, returnMetadata: 'none' })
    await expect(repo.queryVectors('user' as never, unit(), {})).rejects.toThrow('invalid_v5_query_index')
    for (const limit of [0, 101, 1.5]) await expect(repo.queryVectors('article', unit(), { recommendable: true, limit } as never)).rejects.toThrow('invalid_v5_query_limit')
    expect(collection.query).toHaveBeenCalledOnce()
  })

  test('the legacy five-shard signatures and shapes are unchanged', async () => {
    const { env, legacy } = environment()
    const repo = new VectorIndexRepo(env)
    const vectors = [{ id: '1_0', values: [0.1], metadata: { bookmark_id: 1 } }] as unknown as VectorizeVector[]
    await expect(repo.query(2, [0.1], 30, { bookmark_id: { $in: [1, 2] } } as never)).resolves.toEqual({ matches: [{ id: 'a:1:2', score: 0.75 }], count: 1 })
    expect(legacy[2].query).toHaveBeenCalledExactlyOnceWith([0.1], { topK: 30, filter: { bookmark_id: { $in: [1, 2] } } })
    await expect(repo.upsert(0, vectors)).resolves.toEqual({ mutationId: 'mutation-1_0' })
    expect(legacy[0].upsert).toHaveBeenCalledExactlyOnceWith(vectors)
    await expect(repo.deleteByIds(4, ['1_0'])).resolves.toEqual({ mutationId: 'mutation-1_0' })
    expect(legacy[4].deleteByIds).toHaveBeenCalledExactlyOnceWith(['1_0'])
    await expect(repo.query(5, [0.1], 10, undefined)).rejects.toThrow('invalid vectorize shard index: 5')
  })
})

describe('AiEntry is a thin RPC boundary', () => {
  test('the descriptive RPC names forward directly to the native Repository', async () => {
    const { env, article } = environment()
    const entry = new AiEntry({} as ExecutionContext, env)
    const vectors = [articleVector()]
    expect(await entry.upsertVectors('article', vectors)).toEqual({ mutationId: 'mutation-a:1:2' })
    expect(article.upsert).toHaveBeenCalledExactlyOnceWith(vectors)
    expect(await entry.getVectorsByIds('article', ['a:1:2'])).toEqual([vectors[0]])
    expect(article.getByIds).toHaveBeenCalledExactlyOnceWith(['a:1:2'])
    expect(await entry.deleteVectorsByIds('article', ['a:1:2'])).toEqual({ mutationId: 'mutation-a:1:2' })
    expect(article.deleteByIds).toHaveBeenCalledExactlyOnceWith(['a:1:2'])
    expect(await entry.queryVectors('article', unit(), { userId: 1, limit: 1 })).toEqual([{ id: 'a:1:2', score: 0.75 }])
    expect(article.query).toHaveBeenCalledOnce()
  })

  test('the removed v5 RPC aliases are absent and legacy methods still delegate', async () => {
    const { env, legacy } = environment()
    const entry = new AiEntry({} as ExecutionContext, env) as unknown as Record<string, unknown>
    for (const removed of ['v5GetByIds', 'v5Upsert', 'v5DeleteByIds', 'v5Query']) expect(entry[removed]).toBeUndefined()
    expect(typeof entry.query).toBe('function')
    expect(typeof entry.upsert).toBe('function')
    expect(typeof entry.deleteByIds).toBe('function')
    await (entry as unknown as AiEntry).query(1, [0.1], 10, undefined)
    expect(legacy[1].query).toHaveBeenCalledOnce()
  })
})

describe('VectorIndexClient remote adapter', () => {
  test('the adapter uses Repository-side RPC names instead of the Entry class', async () => {
    const rpc = {
      getVectorsByIds: vi.fn(async () => []),
      upsertVectors: vi.fn(async () => ({ mutationId: 'm' })),
      deleteVectorsByIds: vi.fn(async () => ({ mutationId: 'm' })),
      queryVectors: vi.fn(async () => [])
    }
    const client = new VectorIndexClient({ VECTOR: rpc } as unknown as Env)
    await client.get('user', ['u:1:article'])
    await client.upsert('user', [userVector()])
    await client.delete('collection', ['c:5'])
    await client.query('article', unit(), { userId: 7, limit: 1 })
    expect(rpc.getVectorsByIds).toHaveBeenCalledExactlyOnceWith('user', ['u:1:article'])
    expect(rpc.upsertVectors).toHaveBeenCalledExactlyOnceWith('user', [expect.objectContaining({ id: 'u:1:article' })])
    expect(rpc.deleteVectorsByIds).toHaveBeenCalledExactlyOnceWith('collection', ['c:5'])
    expect(rpc.queryVectors).toHaveBeenCalledExactlyOnceWith('article', unit(), { userId: 7, limit: 1 })
  })
})
