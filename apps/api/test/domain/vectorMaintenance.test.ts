import { beforeAll, beforeEach, afterAll, describe, expect, test, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

vi.mock('@/entry/core', () => ({ default: { fetch: vi.fn() } }))
vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class {
    constructor(
      _ctx: unknown,
      protected env: Env
    ) {}
  }
}))

import { Prisma, type PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { AiEntry } from '@/entry/ai'
import { ErrorName } from '@/const/err'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import { VectorMaintenanceRepo } from '@/infra/repository/dbVectorMaintenance'
import { VectorSourceRepo } from '@/infra/repository/vectorSources'
import { VectorIndexClient } from '@/infra/repository/vectorIndexClient'
import { VectorEmbeddingClient } from '@/infra/external/vectorEmbedding'
import { articleVectorId, type VectorRefreshResult } from '@/utils/vectorMaintenanceTypes'
import { estimatedTokens, requestBytes, VECTOR_MODEL, VECTOR_REQUEST_BYTES } from '@/utils/vectorEmbedding'
import { EMBEDDING_MEAN_VERSION } from '@/utils/recommendationAlgorithms'
import { referenceCenter, weightedNormalizedSum } from '../helpers/recommendationReference'
import { pdfFixture } from '../helpers/pdfFixture'
import { memoryPreferenceStates } from '../helpers/preferenceStateMemory'

const unit = (axis = 0) => Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0))
let db: PGlite
let objects: Map<string, { bytes: Uint8Array; type?: string }>
let indexes: ReturnType<typeof index>[]
let provider: ReturnType<typeof vi.fn>
let pdfVectors: number
let env: Env
let service: VectorMaintenanceService
let repo: VectorMaintenanceRepo
let states: ReturnType<typeof memoryPreferenceStates>

const prismaAdapter = {
  async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
    const query = Prisma.sql(strings, ...values)
    return (await db.query(query.text, query.values)).rows
  }
} as unknown as HyperdrivePrismaClient

function index() {
  const stored = new Map<string, VectorizeVector>()
  return {
    stored,
    getByIds: vi.fn(async (ids: string[]) => ids.flatMap(id => (stored.has(id) ? [stored.get(id)!] : []))),
    upsert: vi.fn(async (vectors: VectorizeVector[]) => {
      for (const vector of vectors) stored.set(vector.id, structuredClone(vector))
      return { mutationId: crypto.randomUUID() }
    }),
    deleteByIds: vi.fn(async (ids: string[]) => {
      for (const id of ids) stored.delete(id)
      return { mutationId: crypto.randomUUID() }
    }),
    query: vi.fn(async (_vector: number[], options: any) => {
      const matches = [...stored.values()]
        .filter(vector =>
          Object.entries(options.filter).every(([key, condition]) => {
            const actual = vector.metadata?.[key]
            return typeof condition === 'object' ? Number(actual) >= (condition as { $gte: number }).$gte : actual === condition
          })
        )
        .slice(0, options.topK)
        .map(vector => ({ id: vector.id, score: 0.9 }))
      return { matches, count: matches.length }
    })
  }
}

function put(key: string, text: string) {
  objects.set(key, { bytes: new TextEncoder().encode(text) })
}

async function seed(id = 1, userIds = [1], text = 'A full stored article.', options: { privateUser?: number; starred?: boolean; published?: boolean } = {}) {
  await db.query('INSERT INTO sr_bookmark(id,uuid,title,content_md_key,private_user) VALUES ($1,$2,$3,$4,$5)', [
    id,
    `uuid-${id}`,
    `Title ${id}`,
    `text/${id}`,
    options.privateUser ?? 0
  ])
  for (const user of userIds) await db.query('INSERT INTO sr_user_bookmark(user_id,bookmark_id,is_starred) VALUES($1,$2,$3)', [user, id, options.starred ?? false])
  if (options.published)
    await db.query("INSERT INTO sr_user_collection(id,owner_id,status,collection_code) VALUES ($1,$2,1,'published') ON CONFLICT DO NOTHING", [userIds[0], userIds[0]])
  put(`text/${id}`, text)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE TABLE sr_user(id int PRIMARY KEY, deleted_at timestamp, snapshot_sharing boolean DEFAULT true);
    CREATE TABLE sr_bookmark(id int PRIMARY KEY, uuid text, title text DEFAULT '', content_key text DEFAULT '', content_md_key text DEFAULT '',
      private_user int DEFAULT 0, status text DEFAULT 'success', moderation_result int DEFAULT 0, updated_at timestamp DEFAULT now(), published_at timestamp DEFAULT now());
    CREATE TABLE sr_user_bookmark(id serial, user_id int, bookmark_id int, is_starred boolean DEFAULT false, deleted_at timestamp, type int DEFAULT 0, archive_status int DEFAULT 0, created_at timestamptz DEFAULT now(), starred_at timestamptz, PRIMARY KEY(user_id,bookmark_id));
    CREATE TABLE sr_bookmark_share(bookmark_id int, user_id int, is_enable boolean, PRIMARY KEY(bookmark_id,user_id));
    CREATE TABLE sr_user_collection(id int PRIMARY KEY,owner_id int,status int DEFAULT 1,collection_code text DEFAULT '',created_at timestamp DEFAULT now());
    CREATE TABLE sr_user_collection_subscriber(id serial,user_id int,collection_id int,is_deleted boolean DEFAULT false,is_cancelled boolean DEFAULT false,is_active boolean DEFAULT true,subscription_end_time timestamp DEFAULT now() + interval '1 year');`)
})

beforeEach(async () => {
  await db.exec(
    'TRUNCATE sr_user,sr_bookmark,sr_user_bookmark,sr_bookmark_share,sr_user_collection,sr_user_collection_subscriber RESTART IDENTITY; INSERT INTO sr_user(id) VALUES(1),(2),(3)'
  )
  objects = new Map()
  pdfVectors = 1
  indexes = [index(), index(), index()]
  provider = vi.fn(async (_url: string, request: RequestInit) => {
    const payload = JSON.parse(request.body as string)
    const count = Array.isArray(payload.input) ? payload.input.length : pdfVectors
    return Response.json({ model: VECTOR_MODEL, data: Array.from({ length: count }, (_, i) => ({ index: i, embedding: unit() })) })
  })
  vi.stubGlobal('fetch', provider)
  env = {
    JINA_API_KEY: 'test',
    PROXY_IMAGE_PREFIX: 'https://reader.invalid/image_proxy',
    VECTOR_V5_ARTICLE: indexes[0],
    VECTOR_V5_COLLECTION: indexes[1],
    VECTOR_V5_USER: indexes[2],
    OSS: {
      head: vi.fn(async (key: string) => {
        const object = objects.get(key)
        return object
          ? { size: object.bytes.length, etag: Buffer.from(await crypto.subtle.digest('SHA-256', object.bytes)).toString('hex'), httpMetadata: { contentType: object.type } }
          : null
      }),
      get: vi.fn(async (key: string, options?: { range?: { offset: number; length: number } }) => {
        const object = objects.get(key)
        if (!object) return null
        const bytes = options?.range ? object.bytes.slice(options.range.offset, options.range.offset + options.range.length) : object.bytes
        return {
          size: bytes.length,
          httpMetadata: { contentType: object.type },
          body: new Response(bytes).body,
          arrayBuffer: async () => bytes.slice().buffer,
          text: async () => new TextDecoder().decode(bytes)
        }
      })
    }
  } as unknown as Env
  env.VECTOR = new AiEntry({} as ExecutionContext, env) as unknown as Env['VECTOR']
  repo = new VectorMaintenanceRepo(() => prismaAdapter)
  states = memoryPreferenceStates()
  service = new VectorMaintenanceService(repo, new VectorSourceRepo(env), new VectorEmbeddingClient(env), new VectorIndexClient(env), states)
})

afterAll(async () => {
  await db.close()
  vi.unstubAllGlobals()
})

describe('single-target task refresh semantics', () => {
  test('current-state repository reads resolve exactly the requested private pair and Collection', async () => {
    await seed(41, [2], 'stored owner article', { starred: true, published: true })
    await db.exec('UPDATE sr_user_bookmark SET deleted_at=now() WHERE user_id=1 AND bookmark_id=41')
    const found = await repo.findArticles([{ userId: 2, id: 41 }])
    expect(found).toMatchObject([{ id: 41, user_id: 2 }])
    expect(found[0]).not.toHaveProperty('recommendable')
    expect(await repo.findArticles([{ userId: 1, id: 41 }])).toEqual([])
    expect(await repo.findCollection(2)).toMatchObject({ id: 2, owner_id: 2 })
    expect(await repo.findCollection(41)).toBeUndefined()
    await db.exec('UPDATE sr_user SET deleted_at=now() WHERE id=2')
    expect(await repo.findArticles([{ userId: 2, id: 41 }])).toEqual([])
    expect(await repo.findCollection(2)).toBeUndefined()
  })

  test('one article pair writes only that identity and never its owner preference or Collections', async () => {
    await seed(41, [2], 'stored owner article', { starred: true, published: true })
    const users = vi.spyOn(service, 'refreshUser')
    const collections = vi.spyOn(service, 'refreshCollection')
    const [output] = await service.refreshArticles([{ userId: 2, id: 41 }])
    expect(output).toMatchObject({ state: 'written', target: { kind: 'article', userId: 2, id: 41 } })
    expect(output).not.toHaveProperty('article')
    expect(output).not.toHaveProperty('preference')
    expect(users).not.toHaveBeenCalled()
    expect(collections).not.toHaveBeenCalled()
    expect([...indexes[0].stored.keys()]).toEqual(['a:2:41'])
    expect(indexes[1].upsert).not.toHaveBeenCalled()
    expect(indexes[2].upsert).not.toHaveBeenCalled()
    expect(env.OSS.get).toHaveBeenCalledWith('text/41', expect.anything())
    expect(JSON.parse(provider.mock.calls[0][1].body as string).input).toEqual([{ text: 'Title 41\n\nstored owner article' }])
  })

  test.each([
    [true, false],
    [true, true],
    [false, true],
    [false, false]
  ])('empty images preserve text=%s and valid image=%s without empty provider input', async (hasText, hasImage) => {
    await seed(41, [1], hasText ? 'stored article text' : '')
    await db.query('UPDATE sr_bookmark SET content_key=$1,content_md_key=$2 WHERE id=41', ['html/41', hasText ? 'text/41' : ''])
    const emptyKey = 'private-snapshots/uuid-41/images/0'
    const validKey = 'private-snapshots/uuid-41/images/1'
    put('html/41', `<img src="https://source-assets.reader.invalid/${emptyKey}">${hasImage ? `<img src="https://source-assets.reader.invalid/${validKey}">` : ''}`)
    objects.set(emptyKey, { bytes: new Uint8Array(), type: 'image/png' })
    if (hasImage) objects.set(validKey, { bytes: new Uint8Array([1, 2, 3]), type: 'image/png' })
    const original = provider.getMockImplementation()!
    provider.mockImplementation(async (url, request) => {
      const payload = JSON.parse(request.body as string)
      const empty = payload.input.some((input: { content?: { image?: string }[]; image?: string }) => input.image === '' || input.content?.some(part => part.image === ''))
      if (empty) return new Response('empty image rejected', { status: 400 })
      return original(url, request)
    })
    const [output] = await service.refreshArticles([{ userId: 1, id: 41 }])
    if (hasText || hasImage) {
      expect(output).toMatchObject({ state: 'written', reason: `images_selected:${hasImage ? 1 : 0};images_skipped:empty:1` })
      expect(indexes[0].stored.has('a:1:41')).toBe(true)
      expect(provider).toHaveBeenCalledTimes(Number(hasText) + Number(hasImage))
    } else {
      expect(output).toMatchObject({ state: 'failed', reason: 'missing_source_content' })
      expect(provider).not.toHaveBeenCalled()
      expect(indexes[0].upsert).not.toHaveBeenCalled()
    }
    expect(env.OSS.get).not.toHaveBeenCalledWith(emptyKey)
    expect(objects.get(emptyKey)?.bytes.byteLength).toBe(0)
  })

  test('an unrelated provider 400 remains a failure after empty-image filtering', async () => {
    await seed(41)
    provider.mockImplementationOnce(async () => new Response('invalid nonempty input', { status: 400 }))
    const [output] = await service.refreshArticles([{ userId: 1, id: 41 }])
    expect(output).toMatchObject({ state: 'failed', reason: 'embedding_http_400' })
    expect(indexes[0].upsert).not.toHaveBeenCalled()
  })

  test('two owners of one original keep independent article identities', async () => {
    await seed(41, [1, 2], 'shared source', { starred: true, published: true })
    const first = (await service.refreshArticles([{ userId: 1, id: 41 }]))[0]
    expect(first).toMatchObject({ state: 'written', target: { kind: 'article', userId: 1, id: 41 } })
    expect([...indexes[0].stored.keys()]).toEqual(['a:1:41'])
    const second = (await service.refreshArticles([{ userId: 2, id: 41 }]))[0]
    expect(second).toMatchObject({ state: 'written', target: { kind: 'article', userId: 2, id: 41 } })
    expect([...indexes[0].stored.keys()].sort()).toEqual(['a:1:41', 'a:2:41'])
    expect(indexes[2].upsert).not.toHaveBeenCalled()
  })

  test('chunked output remains one logical article target', async () => {
    await seed(41, [2], 'long stored article '.repeat(80000), { starred: true, published: true })
    const [output] = await service.refreshArticles([{ userId: 2, id: 41 }])
    expect(output.target).toEqual({ kind: 'article', userId: 2, id: 41 })
    expect(output.vectorIds.length).toBeGreaterThan(1)
    expect(output.vectorIds.every(id => id === 'a:2:41' || id.startsWith('a:2:41:c:'))).toBe(true)
    expect(output.reason).toBeUndefined()
  })

  test.each([
    ['deleted relation', 'UPDATE sr_user_bookmark SET deleted_at=now() WHERE user_id=2 AND bookmark_id=41'],
    ['shortcut relation', 'UPDATE sr_user_bookmark SET type=1 WHERE user_id=2 AND bookmark_id=41'],
    ['foreign private original', 'UPDATE sr_bookmark SET private_user=3 WHERE id=41'],
    ['deleted owner', 'UPDATE sr_user SET deleted_at=now() WHERE id=2']
  ])('an unreadable %s cleans up without reading the source or embedding', async (_label, mutation) => {
    await seed(41, [2], 'private owner source', { privateUser: 2 })
    await db.exec(mutation)
    const [output] = await service.refreshArticles([{ userId: 2, id: 41 }])
    expect(output).toMatchObject({ state: 'empty', target: { kind: 'article', userId: 2, id: 41 } })
    expect(env.OSS.get).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
    expect(indexes[0].upsert).not.toHaveBeenCalled()
  })

  test.each(['source-not-ready', 'provider-failed'])('article %s stays a single failed target without dependence cascade', async state => {
    await seed(41)
    const users = vi.spyOn(service, 'refreshUser')
    const verify = vi.spyOn(service, 'verifyRefresh')
    if (state === 'source-not-ready') await db.exec("UPDATE sr_bookmark SET status='pending'")
    else provider.mockImplementationOnce(async () => new Response('unavailable', { status: 503 }))
    const [output] = await service.refreshArticles([{ userId: 1, id: 41 }])
    expect(output).toMatchObject({ state: 'failed', reason: state === 'source-not-ready' ? 'source_not_ready' : 'embedding_http_503' })
    expect(output).not.toHaveProperty('article')
    expect(output).not.toHaveProperty('preference')
    expect(users).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
    expect(indexes[2].upsert).not.toHaveBeenCalled()
  })

  test('provider transport failure remains explicit and never publishes vectors', async () => {
    await seed(41)
    const users = vi.spyOn(service, 'refreshUser')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    provider.mockRejectedValueOnce(new Error('Network connection lost. private provider detail'))
    try {
      const [output] = await service.refreshArticles([{ userId: 1, id: 41 }])
      expect(output).toMatchObject({ state: 'failed', reason: 'embedding_transport_failed', mutationIds: [], vectorIds: [] })
      expect(users).not.toHaveBeenCalled()
      expect(provider).toHaveBeenCalledOnce()
      expect(indexes.every(index => !index.upsert.mock.calls.length)).toBe(true)
      expect(JSON.stringify(log.mock.calls)).toContain('embedding_transport_failed')
      expect(JSON.stringify(log.mock.calls)).not.toContain('private provider detail')
    } finally {
      log.mockRestore()
    }
  })

  test('pending article readback is reported by verifyRefresh and a retry reuses the same write token', async () => {
    await seed(41)
    const [first] = await service.refreshArticles([{ userId: 1, id: 41 }])
    expect(first.state).toBe('written')
    indexes[0].getByIds.mockResolvedValueOnce([])
    expect(await service.verifyRefresh(first)).toBe(false)
    const [retry] = await service.refreshArticles([{ userId: 1, id: 41 }])
    expect(retry.state).toBe('written')
    expect(retry.writeToken).toBe(first.writeToken)
    expect(retry.mutationIds).toEqual([])
    expect(provider).toHaveBeenCalledOnce()
    expect(indexes[0].upsert).toHaveBeenCalledOnce()
  })

  test('article preference refresh uses existing article vectors and clears stale records for an empty history', async () => {
    indexes[2].stored.set('u:1:article', { id: 'u:1:article', values: unit(), namespace: 'user-article' })
    indexes[2].stored.set('u:1:article:centered', { id: 'u:1:article:centered', values: unit(1), namespace: 'user-article' })
    indexes[2].stored.set('u:1:collection', { id: 'u:1:collection', values: unit(1), namespace: 'user-collection' })
    const output = await service.refreshUser(1, 'article')
    expect(output).toMatchObject({ state: 'deleted', target: { kind: 'user', id: 1, preference: 'article' }, removedVectorIds: ['u:1:article', 'u:1:article:centered'] })
    expect(indexes[2].stored.has('u:1:article')).toBe(false)
    expect(indexes[2].stored.has('u:1:article:centered')).toBe(false)
    expect(await service.readUser(1, 'article')).toBeNull()
    expect(await service.readArticleProfile(1)).toBeNull()
    expect(await service.readUser(1, 'collection')).toEqual(unit(1))
    expect(provider).not.toHaveBeenCalled()
    expect(indexes[0].upsert).not.toHaveBeenCalled()
    expect(indexes[1].upsert).not.toHaveBeenCalled()
  })

  test('article preference writes raw and centered records as one logical target and leaves other users alone', async () => {
    await seed(41, [1], 'owned article', { starred: true })
    indexes[0].stored.set('a:1:41', { id: 'a:1:41', values: unit(2), metadata: {} })
    indexes[2].stored.set('u:2:article', { id: 'u:2:article', values: unit(3), namespace: 'user-article' })
    const output = await service.refreshUser(1, 'article')
    expect(output).toMatchObject({ state: 'written', target: { kind: 'user', id: 1, preference: 'article' } })
    expect(await service.readUser(1, 'article')).toEqual(unit(2))
    expect(await service.readArticleProfile(1)).not.toBeNull()
    expect(await service.readUser(2, 'article')).toEqual(unit(3))
    expect(provider).not.toHaveBeenCalled()
    expect(env.OSS.get).not.toHaveBeenCalled()
    expect(indexes[0].upsert).not.toHaveBeenCalled()
    expect(indexes[1].upsert).not.toHaveBeenCalled()
  })

  test('a missing source vector is reported explicitly instead of being generated', async () => {
    await seed(41)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await service.refreshUser(1, 'article')).toMatchObject({ state: 'failed', reason: 'no_usable_preference_vectors', coverage: { eligible: 1, used: 0, missing: 1 } })
      expect(provider).not.toHaveBeenCalled()
      expect(indexes[0].upsert).not.toHaveBeenCalled()
      expect(indexes[2].upsert).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })

  test('Collection refresh writes only its own representation from existing member vectors', async () => {
    await seed(41, [2], 'published member', { starred: true, published: true, privateUser: 2 })
    await db.exec('INSERT INTO sr_user_collection_subscriber(id,user_id,collection_id) VALUES(91,1,2)')
    indexes[0].stored.set('a:2:41', { id: 'a:2:41', values: unit(2) })
    const articles = vi.spyOn(service, 'refreshArticles')
    const users = vi.spyOn(service, 'refreshUser')
    const output = await service.refreshCollection(2)
    expect(output).toMatchObject({ state: 'written', target: { kind: 'collection', id: 2 } })
    expect(indexes[1].stored.get('c:2')?.values).toEqual(unit(2))
    expect(articles).not.toHaveBeenCalled()
    expect(users).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
    expect(env.OSS.get).not.toHaveBeenCalled()
    expect(indexes[0].upsert).not.toHaveBeenCalled()
    expect(indexes[2].upsert).not.toHaveBeenCalled()
  })

  test('a closed or vanished Collection clears only its stale representation', async () => {
    await db.exec("INSERT INTO sr_user_collection(id,owner_id,status,collection_code) VALUES(81,1,0,'closed')")
    indexes[1].stored.set('c:81', { id: 'c:81', values: unit() })
    expect(await service.refreshCollection(81)).toMatchObject({ state: 'deleted', target: { kind: 'collection', id: 81 } })
    expect(indexes[1].stored.has('c:81')).toBe(false)
    expect(await service.refreshCollection(82)).toMatchObject({ state: 'deleted', target: { kind: 'collection', id: 82 } })
    expect(provider).not.toHaveBeenCalled()
  })

  test('a Collection with an unreadable member vector fails explicitly without refreshing the member', async () => {
    await seed(41, [2], 'member without vector', { starred: true, published: true, privateUser: 2 })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await service.refreshCollection(2)).toMatchObject({ state: 'failed', reason: 'missing_dependency:a:2:41' })
      expect(indexes[1].upsert).not.toHaveBeenCalled()
      expect(provider).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})

describe('minimal per-user vector maintenance', () => {
  test('write tokens survive JSON roundtrip and stale existing values are not visible success', async () => {
    await seed(1, [1], 'a long article '.repeat(80000))
    const output = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    const decoded: VectorRefreshResult = JSON.parse(JSON.stringify(output))
    expect(decoded.writeToken).toMatch(/^[a-f0-9]{64}$/)
    expect(decoded.removedVectorIds).toEqual([])
    expect(decoded.vectorIds.length).toBeGreaterThan(1)
    for (const id of decoded.vectorIds) expect(indexes[0].stored.get(id)?.metadata?.write_token).toBe(decoded.writeToken)
    expect(await service.verifyRefresh(decoded)).toBe(true)
    const chunk = indexes[0].stored.get(decoded.vectorIds[1])!
    chunk.metadata!.write_token = 'previous-operation-token'
    expect(await service.verifyRefresh(decoded)).toBe(false)
    chunk.metadata!.write_token = decoded.writeToken!
    expect(await service.verifyRefresh(decoded)).toBe(true)
    const profile = await service.refreshUser(1, 'article')
    expect(indexes[2].stored.get('u:1:article')?.metadata?.write_token).toBe(profile.writeToken)
    expect(await service.verifyRefresh(profile)).toBe(true)
  })

  test('article tokens are fixed before chunks and retries of accepted writes use the same hash', async () => {
    await seed(1, [1], 'a lengthy complete article '.repeat(12000))
    const original = indexes[0].upsert.getMockImplementation()!
    let fail = true
    indexes[0].upsert.mockImplementation(async vectors => {
      const acknowledgement = await original(vectors)
      if (fail && vectors.some(vector => vector.metadata?.kind === 'article')) {
        fail = false
        throw new Error('acknowledgement_lost')
      }
      return acknowledgement
    })
    const first = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(first.state).toBe('failed')
    expect(first.writeToken).toMatch(/^[a-f0-9]{64}$/)
    const calls = provider.mock.calls.length
    const writes = indexes[0].upsert.mock.calls.length
    const retry = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(retry.state).toBe('written')
    expect(retry.writeToken).toBe(first.writeToken)
    expect(provider).toHaveBeenCalledTimes(calls)
    expect(indexes[0].upsert).toHaveBeenCalledTimes(writes)
    for (const call of indexes[0].upsert.mock.calls) for (const vector of call[0]) expect(vector.metadata?.write_token).toBe(first.writeToken)
    expect(await service.verifyRefresh(retry)).toBe(true)
  })

  test.each([true, false])('same-token reuse rewrites a stale recommendable=%s chunk without the field', async stale => {
    await seed(1, [1], 'a complete long article '.repeat(45000))
    const first = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    const changed = indexes[0].stored.get(first.vectorIds[1])!
    changed.metadata!.recommendable = stale
    provider.mockClear()
    indexes[0].upsert.mockClear()
    const second = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(second.writeToken).toBe(first.writeToken)
    expect(provider).not.toHaveBeenCalled()
    expect(indexes[0].upsert).toHaveBeenCalledOnce()
    expect(indexes[0].upsert.mock.calls[0][0].map(vector => vector.id)).toEqual([changed.id])
    expect(indexes[0].stored.get(changed.id)?.metadata).not.toHaveProperty('recommendable')
    expect(await service.verifyRefresh(first)).toBe(true)
    expect(await service.verifyRefresh(second)).toBe(true)
  })

  test('user aggregate hashes are stable for identical Float32 values and change with preferences', async () => {
    await seed(1)
    await seed(2)
    indexes[0].stored.set('a:1:1', { id: 'a:1:1', values: unit(0) })
    indexes[0].stored.set('a:1:2', { id: 'a:1:2', values: unit(1) })
    const first = await service.refreshUser(1, 'article')
    const repeat = await service.refreshUser(1, 'article')
    expect(first.writeToken).toMatch(/^[a-f0-9]{64}$/)
    expect(repeat.writeToken).toBe(first.writeToken)
    expect(await service.verifyRefresh(first)).toBe(true)
    await db.exec('UPDATE sr_user_bookmark SET is_starred=true WHERE bookmark_id=2')
    const changed = await service.refreshUser(1, 'article')
    expect(changed.writeToken).not.toBe(first.writeToken)
    expect(changed.stateVersion).toBeGreaterThan(first.stateVersion!)
    expect(await service.verifyRefresh(first)).toBe(true)
    expect(await service.verifyRefresh(changed)).toBe(true)
    const visible = structuredClone(indexes[2].stored.get('u:1:article')!)
    indexes[2].stored.set('u:1:article', { ...visible, metadata: { ...visible.metadata, write_token: first.writeToken, state_version: first.stateVersion } })
    expect(await service.verifyRefresh(changed)).toBe(false)
    indexes[2].stored.set('u:1:article', visible)
    await db.exec('UPDATE sr_user_bookmark SET is_starred=false')
    expect((await service.refreshUser(1, 'article')).writeToken).toBe(first.writeToken)
  })

  test('Collection hashes include publication metadata even when aggregate values stay identical', async () => {
    await seed(1, [1], 'member', { starred: true, published: true, privateUser: 1 })
    indexes[0].stored.set('a:1:1', { id: 'a:1:1', values: unit() })
    const first = await service.refreshCollection(1)
    expect(first.unchanged).toBeUndefined()
    indexes[1].upsert.mockClear()
    const repeated = await service.refreshCollection(1)
    expect(repeated.writeToken).toBe(first.writeToken)
    expect(repeated.unchanged).toBe(true)
    expect(indexes[1].upsert).not.toHaveBeenCalled()
    expect(await service.verifyRefresh(repeated)).toBe(true)
    await db.exec("UPDATE sr_bookmark SET updated_at=updated_at + interval '1 day'")
    const changed = await service.refreshCollection(1)
    expect(changed.writeToken).not.toBe(first.writeToken)
    expect(await service.verifyRefresh(changed)).toBe(true)
  })

  test('deleting A records its complete representative/chunks and never deletes B', async () => {
    await seed(1, [1, 2], 'long shared historical article '.repeat(40000))
    const [a, b] = await service.refreshArticles([
      { userId: 1, id: 1 },
      { userId: 2, id: 1 }
    ])
    const stale = structuredClone(indexes[0].stored.get(a.vectorIds[1])!)
    await db.exec('DELETE FROM sr_user_bookmark WHERE user_id=1')
    const deleted = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(deleted.state).toBe('deleted')
    expect(deleted.vectorIds).toEqual([...a.vectorIds.slice(1), a.vectorIds[0]])
    expect(deleted.removedVectorIds).toEqual([...a.vectorIds.slice(1), a.vectorIds[0]])
    expect(deleted.vectorIds.every(id => id.startsWith('a:1:1'))).toBe(true)
    expect(b.vectorIds.every(id => indexes[0].stored.has(id))).toBe(true)
    expect(await service.verifyRefresh(deleted)).toBe(true)
    indexes[0].stored.set(stale.id, stale)
    expect(await service.verifyRefresh(deleted)).toBe(false)
  })

  test('chunk deletion failure retains the representative count and retry removes every A vector only', async () => {
    await seed(1, [1, 2], 'long historical article '.repeat(50000))
    const [a, b] = await service.refreshArticles([
      { userId: 1, id: 1 },
      { userId: 2, id: 1 }
    ])
    const oldCount = indexes[0].stored.get('a:1:1')!.metadata!.part_count
    const remove = indexes[0].deleteByIds.getMockImplementation()!
    indexes[0].deleteByIds.mockImplementationOnce(async ids => {
      expect(ids.every(id => id.startsWith('a:1:1:c:'))).toBe(true)
      indexes[0].stored.delete(ids[0])
      throw new Error('chunk_delete_failed')
    })
    await db.exec('DELETE FROM sr_user_bookmark WHERE user_id=1')
    const failed = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(failed).toMatchObject({ state: 'failed', reason: 'chunk_delete_failed' })
    expect(indexes[0].stored.get('a:1:1')?.metadata?.part_count).toBe(oldCount)
    expect(indexes[0].deleteByIds.mock.calls.flatMap(call => call[0])).not.toContain('a:1:1')
    indexes[0].deleteByIds.mockImplementation(remove)
    const retry = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(retry.state).toBe('deleted')
    expect(a.vectorIds.every(id => !indexes[0].stored.has(id))).toBe(true)
    expect(b.vectorIds.every(id => indexes[0].stored.has(id))).toBe(true)
    expect(await service.verifyRefresh(retry)).toBe(true)
  })

  test('accepted but invisible chunk deletion blocks representative removal until retry', async () => {
    await seed(1, [1], 'long article '.repeat(90000))
    const first = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    const remove = indexes[0].deleteByIds.getMockImplementation()!
    indexes[0].deleteByIds.mockImplementationOnce(async () => ({ mutationId: 'accepted-not-visible' }))
    indexes[0].getByIds.mockClear()
    await db.exec('DELETE FROM sr_user_bookmark')
    const failed = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(failed).toMatchObject({ state: 'failed', reason: 'vector_delete_not_visible' })
    expect(indexes[0].stored.has('a:1:1')).toBe(true)
    expect(indexes[0].getByIds.mock.calls.filter(call => call[0][0].includes(':c:'))).toHaveLength(3)
    expect(indexes[0].deleteByIds.mock.calls.flatMap(call => call[0])).not.toContain('a:1:1')
    indexes[0].deleteByIds.mockImplementation(remove)
    expect((await service.refreshArticles([{ userId: 1, id: 1 }]))[0].state).toBe('deleted')
    expect(first.vectorIds.every(id => !indexes[0].stored.has(id))).toBe(true)
  })

  test.each(['single', 'multiple'])('failed shrink to %s parts keeps old count and retries cleanly without touching B', async size => {
    await seed(1, [1, 2], 'long original article '.repeat(55000))
    const [first, b] = await service.refreshArticles([
      { userId: 1, id: 1 },
      { userId: 2, id: 1 }
    ])
    const original = structuredClone(indexes[0].stored.get('a:1:1')!)
    const bValues = b.vectorIds.map(id => structuredClone(indexes[0].stored.get(id)!))
    put('text/1', size === 'single' ? 'short' : 'smaller complete article '.repeat(5000))
    const remove = indexes[0].deleteByIds.getMockImplementation()!
    indexes[0].deleteByIds.mockImplementationOnce(async ids => {
      expect(ids.every(id => id.startsWith('a:1:1:c:'))).toBe(true)
      throw new Error('chunk_delete_failed')
    })
    const failed = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(failed).toMatchObject({ state: 'failed', reason: 'chunk_delete_failed' })
    expect(indexes[0].stored.get('a:1:1')).toEqual(original)
    indexes[0].deleteByIds.mockImplementation(remove)
    const retry = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(retry.state).toBe('written')
    expect(retry.vectorIds.length).toBeLessThan(first.vectorIds.length)
    const oldOnly = first.vectorIds.filter(id => !retry.vectorIds.includes(id))
    expect(oldOnly.every(id => !indexes[0].stored.has(id))).toBe(true)
    expect(b.vectorIds.map(id => indexes[0].stored.get(id))).toEqual(bValues)
    expect(await service.verifyRefresh(retry)).toBe(true)
  })

  test('invisible shrink deletion leaves old part_count until its bounded retry succeeds', async () => {
    await seed(1, [1], 'long article '.repeat(90000))
    const first = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    const original = structuredClone(indexes[0].stored.get('a:1:1')!)
    put('text/1', 'short')
    indexes[0].deleteByIds.mockImplementationOnce(async () => ({ mutationId: 'accepted-not-visible' }))
    const failed = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(failed).toMatchObject({ state: 'failed', reason: 'vector_delete_not_visible' })
    expect(indexes[0].stored.get('a:1:1')).toEqual(original)
    const retry = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(retry.state).toBe('written')
    expect(retry.removedVectorIds).toEqual(first.vectorIds.slice(1))
    expect([...indexes[0].stored.keys()]).toEqual(['a:1:1'])
  })

  test('visibility reads are bounded, require removed absence and never leak RPC errors', async () => {
    const writeToken = crypto.randomUUID()
    const ids = Array.from({ length: 203 }, (_, i) => `a:1:1:c:${i}`)
    for (const id of ids) indexes[0].stored.set(id, { id, values: unit(), metadata: { write_token: writeToken } })
    const output: VectorRefreshResult = {
      target: { kind: 'article', userId: 1, id: 1 },
      state: 'written',
      vectorIds: ids,
      mutationIds: [],
      writeToken,
      removedVectorIds: ['a:1:1:c:999']
    }
    expect(await service.verifyRefresh(output)).toBe(true)
    const calls = indexes[0].getByIds.mock.calls.map(call => call[0])
    expect(calls.map(ids => ids.length)).toEqual([...Array(10).fill(20), 3, 1])
    expect(calls.every(ids => ids.length <= 20)).toBe(true)
    expect(new Set(calls.flat())).toEqual(new Set([...ids, 'a:1:1:c:999']))
    indexes[0].getByIds.mockClear()
    expect(await service.verifyRefresh({ ...output, state: 'empty', vectorIds: [], removedVectorIds: [] })).toBe(true)
    expect(indexes[0].getByIds).not.toHaveBeenCalled()
    indexes[0].getByIds.mockClear()
    indexes[0].stored.delete(ids[0])
    expect(await service.verifyRefresh(output)).toBe(false)
    expect(indexes[0].getByIds.mock.calls.every(([requested]) => requested.length <= 20)).toBe(true)
    indexes[0].stored.set(ids[0], { id: ids[0], values: unit(), metadata: { write_token: writeToken } })
    indexes[0].stored.set('a:1:1:c:999', { id: 'a:1:1:c:999', values: unit() })
    expect(await service.verifyRefresh(output)).toBe(false)
    expect(await service.verifyRefresh({ ...output, state: 'empty', vectorIds: [], removedVectorIds: [] })).toBe(true)
    expect(await service.verifyRefresh({ ...output, state: 'empty', vectorIds: [] })).toBe(false)
    indexes[0].getByIds.mockRejectedValueOnce(new Error('Bearer private-secret'))
    expect(await service.verifyRefresh(output)).toBe(false)
  })

  test('star, share and Collection visibility changes reuse article vectors without publication metadata', async () => {
    await seed(1, [1], 'same complete content', { published: true, privateUser: 1 })
    const first = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    const original = structuredClone(indexes[0].stored.get('a:1:1')!)
    expect(provider).toHaveBeenCalledOnce()
    expect(indexes[0].stored.get('a:1:1')?.metadata).not.toHaveProperty('recommendable')
    indexes[0].upsert.mockClear()
    await db.exec('UPDATE sr_user_bookmark SET is_starred=true')
    const starred = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(starred.writeToken).toBe(first.writeToken)
    expect(starred.mutationIds).toEqual([])
    expect(indexes[0].upsert).not.toHaveBeenCalled()
    expect(indexes[0].stored.get('a:1:1')?.metadata).not.toHaveProperty('recommendable')
    await db.exec('INSERT INTO sr_bookmark_share VALUES(1,1,false)')
    const unshared = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(unshared.writeToken).toBe(first.writeToken)
    await db.exec('DELETE FROM sr_bookmark_share; UPDATE sr_user_collection SET status=0')
    const closed = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(closed.writeToken).toBe(first.writeToken)
    expect(closed.mutationIds).toEqual([])
    await db.exec('UPDATE sr_bookmark SET private_user=0')
    const changedPrivacy = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(changedPrivacy.writeToken).not.toBe(closed.writeToken)
    expect(provider).toHaveBeenCalledOnce()
    expect(indexes[0].stored.get('a:1:1')?.values).toEqual(original.values)
    expect(indexes[0].stored.get('a:1:1')?.metadata).toMatchObject({ text_etag: expect.any(String), html_or_pdf_etag: '', text_key: 'text/1' })
    expect(indexes[0].stored.get('a:1:1')?.metadata).not.toHaveProperty('recommendable')
    expect(new TextEncoder().encode(JSON.stringify(indexes[0].stored.get('a:1:1')?.metadata)).length).toBeLessThan(10 * 1024)
  })

  test('changed ETag or source key reembeds even without updated_at changes', async () => {
    await seed()
    await service.refreshArticles([{ userId: 1, id: 1 }])
    const oldEtag = indexes[0].stored.get('a:1:1')?.metadata?.text_etag
    await service.refreshArticles([{ userId: 1, id: 1 }])
    expect(provider).toHaveBeenCalledOnce()
    put('text/1', 'changed stored source')
    await service.refreshArticles([{ userId: 1, id: 1 }])
    expect(provider).toHaveBeenCalledTimes(2)
    expect(indexes[0].stored.get('a:1:1')?.metadata?.text_etag).not.toBe(oldEtag)
    put('text/new', 'changed stored source')
    await db.exec("UPDATE sr_bookmark SET content_md_key='text/new'")
    await service.refreshArticles([{ userId: 1, id: 1 }])
    expect(provider).toHaveBeenCalledTimes(3)
    delete indexes[0].stored.get('a:1:1')!.metadata!.text_etag
    await service.refreshArticles([{ userId: 1, id: 1 }])
    expect(provider).toHaveBeenCalledTimes(4)
    put('html/new', '<article>first stored HTML</article>')
    await db.exec("UPDATE sr_bookmark SET content_key='html/new'")
    await service.refreshArticles([{ userId: 1, id: 1 }])
    expect(provider).toHaveBeenCalledTimes(5)
    const htmlEtag = indexes[0].stored.get('a:1:1')?.metadata?.html_or_pdf_etag
    await service.refreshArticles([{ userId: 1, id: 1 }])
    expect(provider).toHaveBeenCalledTimes(5)
    put('html/new', '<article>replacement stored HTML</article>')
    await service.refreshArticles([{ userId: 1, id: 1 }])
    expect(provider).toHaveBeenCalledTimes(6)
    expect(indexes[0].stored.get('a:1:1')?.metadata?.html_or_pdf_etag).not.toBe(htmlEtag)
  })

  test('identical long article refresh skips all writes and repairs a missing cached chunk by re-embedding', async () => {
    await seed(1, [1], 'a complete long article '.repeat(45000))
    const first = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    const calls = provider.mock.calls.length
    const writes = indexes[0].upsert.mock.calls.length
    const second = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(second.state).toBe('written')
    expect(second.writeToken).toBe(first.writeToken)
    expect(second.mutationIds).toEqual([])
    expect(provider).toHaveBeenCalledTimes(calls)
    expect(indexes[0].upsert).toHaveBeenCalledTimes(writes)
    expect(second.vectorIds).toEqual(first.vectorIds)
    expect(await service.verifyRefresh(second)).toBe(true)
    expect(await service.verifyRefresh(first)).toBe(true)
    indexes[0].stored.delete(second.vectorIds[1])
    const repaired = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(repaired.state).toBe('written')
    expect(provider.mock.calls.length).toBeGreaterThan(calls)
    expect(repaired.vectorIds).toEqual(second.vectorIds)
    expect(indexes[0].stored.has(second.vectorIds[1])).toBe(true)
    expect(await service.verifyRefresh(repaired)).toBe(true)
  })

  test('type two PDFs participate in articles and aggregates while type one shortcuts do not', async () => {
    await seed(1, [1], 'pdf text', { starred: true, published: true, privateUser: 1 })
    await seed(2, [1], 'shortcut', { starred: true })
    objects.set('pdf/body/typed.pdf', { bytes: pdfFixture() })
    await db.exec(
      "UPDATE sr_bookmark SET content_key='pdf/body/typed.pdf' WHERE id=1; UPDATE sr_user_bookmark SET type=2 WHERE bookmark_id=1; UPDATE sr_user_bookmark SET type=1 WHERE bookmark_id=2"
    )
    const results = await service.refreshArticles([
      { userId: 1, id: 1 },
      { userId: 1, id: 2 }
    ])
    expect(results.map(result => result.state)).toEqual(['written', 'empty'])
    expect((await service.refreshUser(1, 'article')).state).toBe('written')
    expect((await service.refreshCollection(1)).state).toBe('written')
    expect(indexes[0].stored.has('a:1:2')).toBe(false)
    expect(JSON.parse(provider.mock.calls[0][1].body as string).input.pdf).toEqual(expect.any(String))
  })

  test('historical shared bookmark has independent identities, isolated ANN, and independent deletion', async () => {
    await seed(1, [1, 2])
    const identities = [
      { userId: 1, id: 1 },
      { userId: 2, id: 1 }
    ]
    const results = await service.refreshArticles(identities)
    expect(results.map(result => result.state)).toEqual(['written', 'written'])
    expect([...indexes[0].stored.keys()]).toEqual(['a:1:1', 'a:2:1'])
    expect(indexes[0].stored.get('a:1:1')?.metadata).toMatchObject({ user_id: 1, bookmark_id: 1, kind: 'article' })
    expect(indexes[0].stored.get('a:1:1')?.metadata).not.toHaveProperty('recommendable')
    expect(indexes[0].stored.get('a:2:1')?.metadata).toMatchObject({ user_id: 2 })
    expect(await service.queryArticles(unit(), { userId: 1 })).toEqual([{ id: 1, userId: 1, score: 0.9 }])
    expect(indexes[0].query.mock.calls[0][1]).toEqual({ topK: 20, filter: { kind: 'article', user_id: 1 }, returnValues: false, returnMetadata: 'none' })
    await expect(service.queryArticles(unit(), { recommendable: true } as never)).rejects.toThrow('invalid_v5_query_scope')
    await db.exec('DELETE FROM sr_user_bookmark WHERE user_id=1')
    expect((await service.refreshArticles([identities[0]]))[0].state).toBe('deleted')
    expect(indexes[0].stored.has('a:1:1')).toBe(false)
    expect(indexes[0].stored.has('a:2:1')).toBe(true)
    expect('close' in service).toBe(false)
  })

  test('ten complete articles fit one actual provider request and one native upsert batch', async () => {
    for (let id = 1; id <= 10; id++) await seed(id)
    expect((await service.refreshArticles(Array.from({ length: 10 }, (_, i) => ({ userId: 1, id: i + 1 })))).every(result => result.state === 'written')).toBe(true)
    expect(provider).toHaveBeenCalledOnce()
    const payload = JSON.parse(provider.mock.calls[0][1].body as string)
    expect(payload).toMatchObject({ model: VECTOR_MODEL, task: 'text-matching', dimensions: 1024, truncate: false, normalized: true })
    expect(payload.input).toHaveLength(10)
    expect(payload.input[0]).toEqual({ text: 'Title 1\n\nA full stored article.' })
    expect(indexes[0].upsert).toHaveBeenCalledOnce()
    expect(indexes[0].upsert.mock.calls[0][0]).toHaveLength(10)
  })

  test('never admits another owners private snapshot even with a corrupt relation', async () => {
    await seed(1, [1, 2], 'private', { privateUser: 1 })
    expect((await service.refreshArticles([{ userId: 2, id: 1 }]))[0].state).toBe('empty')
    expect(provider).not.toHaveBeenCalled()
    expect(indexes[0].stored.size).toBe(0)
  })

  test('article representative and chunk metadata never carry a publication marker', async () => {
    await seed(1, [1], 'owned and shared '.repeat(80000), { privateUser: 1, starred: true, published: true })
    const result = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(result.state).toBe('written')
    expect(result.vectorIds.length).toBeGreaterThan(1)
    for (const id of result.vectorIds) expect(indexes[0].stored.get(id)?.metadata).not.toHaveProperty('recommendable')
    await db.exec('UPDATE sr_user SET snapshot_sharing=false WHERE id=1')
    await service.refreshArticles([{ userId: 1, id: 1 }])
    for (const id of result.vectorIds) expect(indexes[0].stored.get(id)?.metadata).not.toHaveProperty('recommendable')
    await db.exec('INSERT INTO sr_bookmark_share VALUES(1,1,true)')
    await service.refreshArticles([{ userId: 1, id: 1 }])
    for (const id of result.vectorIds) expect(indexes[0].stored.get(id)?.metadata).not.toHaveProperty('recommendable')
  })

  test('long text has lossless model parts and shrinking removes old chunks', async () => {
    const text = '完整🙂 source with English.\n'.repeat(60000)
    await seed(1, [1], text)
    const result = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(result.state).toBe('written')
    const inputs = provider.mock.calls.flatMap(call => JSON.parse(call[1].body as string).input)
    expect(inputs.map(input => input.text).join('')).toBe('Title 1\n\n' + text)
    expect(inputs.length).toBeGreaterThan(1)
    expect(indexes[0].stored.get('a:1:1')?.metadata?.part_count).toBe(inputs.length)
    expect([...indexes[0].stored.keys()].filter(id => id.includes(':c:'))).toHaveLength(inputs.length)
    const oldChunk = structuredClone(indexes[0].stored.get(result.vectorIds[1])!)
    put('text/1', 'short')
    const shrunk = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(shrunk.state).toBe('written')
    expect(shrunk.removedVectorIds).toEqual(result.vectorIds.slice(1))
    expect([...indexes[0].stored.keys()]).toEqual(['a:1:1'])
    expect(await service.verifyRefresh(shrunk)).toBe(true)
    indexes[0].stored.set(oldChunk.id, oldChunk)
    expect(await service.verifyRefresh(shrunk)).toBe(false)
  })

  test('text larger than request bound uses lossless UTF8 range bisection, not R2 read pages', async () => {
    const text = '完整🙂abc'.repeat(90_000)
    await seed(1, [1], text)
    expect((await service.refreshArticles([{ userId: 1, id: 1 }]))[0].state).toBe('written')
    expect(
      provider.mock.calls
        .flatMap(call => JSON.parse(call[1].body as string).input)
        .map(input => input.text)
        .join('')
    ).toBe('Title 1\n\n' + text)
    expect(Math.max(...(env.OSS.get as any).mock.calls.map((call: any) => call[1]?.range?.length ?? 0))).toBeLessThanOrEqual(1024 * 1024)
  })

  test('readArticles uses bounded exact getByIds pages with identity map keys', async () => {
    const identities = Array.from({ length: 203 }, (_, i) => ({ userId: 1, id: i + 1 }))
    for (const identity of identities) indexes[0].stored.set(articleVectorId(identity), { id: articleVectorId(identity), values: unit() })
    expect((await service.readArticles(identities)).size).toBe(203)
    const pages = indexes[0].getByIds.mock.calls.map(call => call[0].length)
    expect(pages).toEqual([...Array(10).fill(20), 3])
    expect(pages.every(size => size <= 20)).toBe(true)
    expect(new Set(indexes[0].getByIds.mock.calls.flatMap(call => call[0])).size).toBe(203)
    expect(indexes[0].query).not.toHaveBeenCalled()
  })

  test.each([21, 27, 41, 103])('native reads page at most 20 IDs and cover all %i requested identities', async count => {
    const identities = Array.from({ length: count }, (_, i) => ({ userId: 1, id: i + 1 }))
    for (const identity of identities) indexes[0].stored.set(articleVectorId(identity), { id: articleVectorId(identity), values: unit() })
    expect((await service.readArticles(identities)).size).toBe(count)
    const calls = indexes[0].getByIds.mock.calls.map(call => call[0])
    expect(calls.map(ids => ids.length)).toEqual(Array.from({ length: Math.ceil(count / 20) }, (_, index) => Math.min(20, count - index * 20)))
    expect(calls.every(ids => ids.length <= 20)).toBe(true)
    expect(new Set(calls.flat()).size).toBe(count)
  })

  test.each([21, 27, 41, 103])('written verification pages at most 20 IDs and covers all %i vectors', async count => {
    const writeToken = crypto.randomUUID()
    const ids = Array.from({ length: count }, (_, i) => `a:1:1:c:${i}`)
    for (const id of ids) indexes[0].stored.set(id, { id, values: unit(), metadata: { write_token: writeToken } })
    const output: VectorRefreshResult = {
      target: { kind: 'article', userId: 1, id: 1 },
      state: 'written',
      vectorIds: ids,
      mutationIds: [],
      writeToken
    }
    expect(await service.verifyRefresh(output)).toBe(true)
    const calls = indexes[0].getByIds.mock.calls.map(call => call[0])
    expect(calls.map(ids => ids.length)).toEqual(Array.from({ length: Math.ceil(count / 20) }, (_, index) => Math.min(20, count - index * 20)))
    expect(calls.every(ids => ids.length <= 20)).toBe(true)
    expect(new Set(calls.flat())).toEqual(new Set(ids))
  })

  test.each([21, 27, 41, 103])('deleted verification pages at most 20 IDs and covers all %i removed vectors', async count => {
    const removed = Array.from({ length: count }, (_, i) => `a:1:1:c:${i}`)
    const output: VectorRefreshResult = {
      target: { kind: 'article', userId: 1, id: 1 },
      state: 'deleted',
      vectorIds: ['a:1:1'],
      mutationIds: [],
      removedVectorIds: removed
    }
    expect(await service.verifyRefresh(output)).toBe(true)
    const calls = indexes[0].getByIds.mock.calls.map(call => call[0])
    const total = count + 1
    expect(calls.map(ids => ids.length)).toEqual(Array.from({ length: Math.ceil(total / 20) }, (_, index) => Math.min(20, total - index * 20)))
    expect(calls.every(ids => ids.length <= 20)).toBe(true)
    expect(new Set(calls.flat())).toEqual(new Set(['a:1:1', ...removed]))
  })

  test('saved=1/starred=2, archive neutral, independent profile IDs and cancellation recompute', async () => {
    await seed(1, [1])
    await seed(2, [1], 'starred', { starred: true })
    await seed(3, [2], 'published owner member', { starred: true, privateUser: 2 })
    await db.exec(
      "UPDATE sr_user_bookmark SET archive_status=1 WHERE bookmark_id=2; INSERT INTO sr_user_collection(id,owner_id,collection_code) VALUES (2,2,'open'); INSERT INTO sr_user_collection_subscriber(user_id,collection_id) VALUES(1,2)"
    )
    indexes[0].stored.set('a:1:1', { id: 'a:1:1', values: unit(0) })
    indexes[0].stored.set('a:1:2', { id: 'a:1:2', values: unit(1) })
    indexes[1].stored.set('c:2', { id: 'c:2', values: unit(2) })
    expect((await service.refreshUser(1, 'article')).state).toBe('written')
    expect((await service.refreshUser(1, 'collection')).state).toBe('written')
    const article = await service.readUser(1, 'article')
    expect(article?.[0]).toBeCloseTo(1 / Math.sqrt(5))
    expect(article?.[1]).toBeCloseTo(2 / Math.sqrt(5))
    expect((await service.readUser(1, 'collection'))?.[2]).toBe(1)
    expect(indexes[2].stored.get('u:1:article')?.namespace).toBe('user-article')
    expect(indexes[2].stored.get('u:1:collection')?.namespace).toBe('user-collection')
    await db.exec('UPDATE sr_user_collection_subscriber SET is_cancelled=true')
    expect((await service.refreshUser(1, 'collection')).state).toBe('written')
    expect((await service.readUser(1, 'collection'))?.[2]).toBe(1)
    await db.exec('UPDATE sr_user_collection_subscriber SET is_active=false')
    expect((await service.refreshUser(1, 'collection')).state).toBe('deleted')
    expect(await service.readUser(1, 'collection')).toBeNull()
    expect(await service.readUser(1, 'article')).toEqual(article)
  })

  test('ordered star, repeated star and unstar reconcile to the exact current weighted aggregate', async () => {
    await seed(601, [1])
    await seed(602, [1])
    await seed(603, [1])
    indexes[0].stored.set('a:1:601', { id: 'a:1:601', values: unit(0) })
    indexes[0].stored.set('a:1:602', { id: 'a:1:602', values: unit(1) })
    indexes[0].stored.set('a:1:603', { id: 'a:1:603', values: unit(2) })
    const refresh = async () => {
      expect((await service.refreshUser(1, 'article')).state).toBe('written')
      return (await service.readUser(1, 'article'))!
    }
    const expectWeighted = (vector: number[], weights: number[]) => {
      const norm = Math.hypot(...weights)
      weights.forEach((weight, axis) => expect(vector[axis]).toBeCloseTo(weight / norm))
      expect(Math.hypot(...vector)).toBeCloseTo(1)
    }
    const baseline = await refresh()
    expectWeighted(baseline, [1, 1, 1])
    const baselineToken = indexes[2].stored.get('u:1:article')?.metadata?.write_token
    expect((await refresh()).every((value, axis) => Math.abs(value - baseline[axis]) < 1e-9)).toBe(true)
    expect(indexes[2].stored.get('u:1:article')?.metadata?.write_token).toBe(baselineToken)

    await db.exec('UPDATE sr_user_bookmark SET is_starred=true WHERE user_id=1 AND bookmark_id=601')
    const starred = await refresh()
    expectWeighted(starred, [2, 1, 1])
    const starredToken = indexes[2].stored.get('u:1:article')?.metadata?.write_token
    expect(starredToken).not.toBe(baselineToken)
    expect((await refresh()).every((value, axis) => Math.abs(value - starred[axis]) < 1e-9)).toBe(true)
    expect(indexes[2].stored.get('u:1:article')?.metadata?.write_token).toBe(starredToken)

    await db.exec('UPDATE sr_user_bookmark SET is_starred=false WHERE user_id=1 AND bookmark_id=601')
    const unstarred = await refresh()
    expectWeighted(unstarred, [1, 1, 1])
    expect(indexes[2].stored.get('u:1:article')?.metadata?.write_token).toBe(baselineToken)
    expect(indexes[1].upsert).not.toHaveBeenCalled()
  })

  test('interests metadata is stored and participates in the user write token', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-05T00:00:00Z'))
      await seed(1, [1], 'A', { starred: true })
      await seed(2, [1], 'B', { starred: true })
      await db.exec(`
        UPDATE sr_user_bookmark SET created_at='2026-10-01T00:00:00Z', starred_at='2026-10-02T00:00:00Z' WHERE user_id=1 AND bookmark_id IN (1,2)
      `)
      const tilted = [Math.cos(Math.PI / 4.5), Math.sin(Math.PI / 4.5), ...new Array(1022).fill(0)]
      indexes[0].stored.set('a:1:1', { id: 'a:1:1', values: unit(0) })
      indexes[0].stored.set('a:1:2', { id: 'a:1:2', values: tilted })
      const first = await service.refreshUser(1, 'article')
      expect(first.state).toBe('written')
      const stored = indexes[2].stored.get('u:1:article')!
      const metadata = stored.metadata?.interests
      expect(typeof metadata).toBe('string')
      const parsed = JSON.parse(metadata as string) as Array<[number, number]>
      expect(parsed).toHaveLength(1)
      expect(parsed[0][0]).toBe(1)
      const days = (Date.UTC(2026, 10, 5) - Date.UTC(2026, 9, 1)) / 86_400_000
      expect(parsed[0][1]).toBeCloseTo(Number((2 * Math.exp(-0.01 * days) + 2 * Math.exp(-0.01 * (days - 1))).toPrecision(6)), 5)
      const profile = await service.readArticleProfile(1)
      expect(profile?.interests).toEqual([{ medoidBookmarkId: 1, importance: parsed[0][1] }])
      expect(await service.verifyRefresh(first)).toBe(true)

      const before = await service.readUser(1, 'article')
      await db.exec(`UPDATE sr_user_bookmark SET starred_at='2026-09-01T00:00:00Z' WHERE user_id=1 AND bookmark_id=2`)
      const second = await service.refreshUser(1, 'article')
      expect(second.state).toBe('written')
      const after = await service.readUser(1, 'article')
      expect(after).toEqual(before)
      expect(second.writeToken).not.toBe(first.writeToken)
      expect(indexes[2].stored.get('u:1:article')?.metadata?.interests).not.toBe(metadata)
    } finally {
      vi.useRealTimers()
    }
  })

  const storeProfile = (metadata: Record<string, unknown>) => {
    indexes[2].stored.set('u:1:article', { id: 'u:1:article', namespace: 'user-article', values: unit(0), metadata: metadata as Record<string, string> })
    indexes[2].stored.set('u:1:article:centered', { id: 'u:1:article:centered', namespace: 'user-article', values: unit(1), metadata: {} })
  }

  test('readArticleProfile rejects every malformed interests metadata shape', async () => {
    storeProfile({ interests: 5 })
    await expect(service.readArticleProfile(1)).rejects.toThrow('invalid_preference_interests')
    for (const interests of ['{', '{}', '[[1]]', '[[1,1,1]]', '[[1.5,1]]', '[[0,1]]', '[[-1,1]]', '[["1",1]]', '[[1,"1"]]', '[[1,null]]', '[[1,0]]', '[[1,-1]]']) {
      storeProfile({ interests })
      await expect(service.readArticleProfile(1)).rejects.toThrow('invalid_preference_interests')
    }
  })

  test('readArticleProfile accepts a valid pair list and defaults to no interests without metadata', async () => {
    storeProfile({ interests: '[[7,2.5],[3,1]]' })
    expect(await service.readArticleProfile(1)).toMatchObject({
      vector: unit(0),
      centered: unit(1),
      interests: [
        { medoidBookmarkId: 7, importance: 2.5 },
        { medoidBookmarkId: 3, importance: 1 }
      ]
    })
    storeProfile({})
    expect((await service.readArticleProfile(1))?.interests).toEqual([])
    storeProfile({ interests: '[]' })
    expect((await service.readArticleProfile(1))?.interests).toEqual([])
  })

  test('readArticleProfile is unavailable when either the raw or centered record is missing', async () => {
    indexes[2].stored.set('u:1:article', { id: 'u:1:article', namespace: 'user-article', values: unit(0), metadata: {} })
    expect(await service.readArticleProfile(1)).toBeNull()
    indexes[2].stored.delete('u:1:article')
    indexes[2].stored.set('u:1:article:centered', { id: 'u:1:article:centered', namespace: 'user-article', values: unit(1), metadata: {} })
    expect(await service.readArticleProfile(1)).toBeNull()
  })

  test('writes the raw and exact centered profiles together with one shared token', async () => {
    await seed(1, [1], 'first')
    await seed(2, [1], 'second', { starred: true })
    const tilted = [Math.cos(Math.PI / 4.5), Math.sin(Math.PI / 4.5), ...new Array(1022).fill(0)]
    indexes[0].stored.set('a:1:1', { id: 'a:1:1', values: unit(0) })
    indexes[0].stored.set('a:1:2', { id: 'a:1:2', values: tilted })
    const output = await service.refreshUser(1, 'article')
    expect(output.state).toBe('written')
    expect(output.vectorIds).toEqual(['u:1:article', 'u:1:article:centered'])
    expect(indexes[2].upsert).toHaveBeenCalledOnce()
    expect(indexes[2].upsert.mock.calls[0][0].map(vector => vector.id)).toEqual(['u:1:article', 'u:1:article:centered'])
    const raw = indexes[2].stored.get('u:1:article')!
    const centered = indexes[2].stored.get('u:1:article:centered')!
    expect(raw.metadata?.write_token).toBe(output.writeToken)
    expect(centered.metadata?.write_token).toBe(output.writeToken)
    expect(raw.metadata?.embedding_mean_version).toBe(EMBEDDING_MEAN_VERSION)
    expect(centered.metadata?.embedding_mean_version).toBe(EMBEDDING_MEAN_VERSION)
    expect(centered.namespace).toBe('user-article')
    const expectedRaw = weightedNormalizedSum([unit(0), tilted], [1, 2])!
    const expectedCentered = weightedNormalizedSum([referenceCenter(unit(0)), referenceCenter(tilted)], [1, 2])!
    raw.values.forEach((value, index) => expect(value).toBeCloseTo(expectedRaw[index], 10))
    centered.values.forEach((value, index) => expect(value).toBeCloseTo(expectedCentered[index], 10))
    expect(await service.verifyRefresh(output)).toBe(true)
    const storedCentered = structuredClone(indexes[2].stored.get('u:1:article:centered')!)
    indexes[2].stored.delete('u:1:article:centered')
    expect(await service.verifyRefresh(output)).toBe(false)
    indexes[2].stored.set('u:1:article:centered', storedCentered)
    expect(await service.verifyRefresh(output)).toBe(true)
    expect((await service.readArticleProfile(1))?.centered).toEqual(storedCentered.values)
  })

  test('a failed first representative upsert removes its new chunks and keeps the item failed', async () => {
    await seed(1, [1], 'x'.repeat(1_200_000))
    const original = indexes[0].upsert.getMockImplementation()!
    indexes[0].upsert.mockImplementation(async vectors => {
      if (vectors.some(vector => vector.metadata?.kind === 'article')) throw new Error('representative_write_failed')
      return original(vectors)
    })
    const failedWrite = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(failedWrite).toMatchObject({ state: 'failed', reason: 'representative_write_failed' })
    expect([...indexes[0].stored.keys()]).toEqual([])
    const removed = indexes[0].deleteByIds.mock.calls.flatMap(call => call[0])
    expect(removed).toContain('a:1:1:c:0')
    expect(removed).toContain('a:1:1:c:1')
    expect(await service.verifyRefresh(failedWrite)).toBe(false)
  })

  test('a failed growth representative upsert removes only chunks beyond the previous part_count', async () => {
    await seed(1, [1], 'y'.repeat(1_200_000))
    const first = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(indexes[0].stored.get('a:1:1')?.metadata?.part_count).toBe(2)
    const oldRepresentative = structuredClone(indexes[0].stored.get('a:1:1')!)
    put('text/1', 'z'.repeat(2_400_000))
    const original = indexes[0].upsert.getMockImplementation()!
    indexes[0].upsert.mockImplementation(async vectors => {
      if (vectors.some(vector => vector.metadata?.kind === 'article')) throw new Error('representative_write_failed')
      return original(vectors)
    })
    const failedWrite = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
    expect(failedWrite).toMatchObject({ state: 'failed', reason: 'representative_write_failed' })
    expect(indexes[0].stored.get('a:1:1')).toEqual(oldRepresentative)
    expect(indexes[0].stored.has('a:1:1:c:0')).toBe(true)
    expect(indexes[0].stored.has('a:1:1:c:1')).toBe(true)
    expect(indexes[0].stored.has('a:1:1:c:2')).toBe(false)
    expect(indexes[0].deleteByIds.mock.calls.flatMap(call => call[0])).toContain('a:1:1:c:2')
    expect(first.vectorIds).toContain('a:1:1:c:1')
  })

  test('a chunk-cleanup error does not mask the representative failure', async () => {
    await seed(1, [1], 'w'.repeat(1_200_000))
    const original = indexes[0].upsert.getMockImplementation()!
    indexes[0].upsert.mockImplementation(async vectors => {
      if (vectors.some(vector => vector.metadata?.kind === 'article')) throw new Error('representative_write_failed')
      return original(vectors)
    })
    indexes[0].deleteByIds.mockRejectedValueOnce(new Error('cleanup unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const failedWrite = (await service.refreshArticles([{ userId: 1, id: 1 }]))[0]
      expect(failedWrite).toMatchObject({ state: 'failed', reason: 'representative_write_failed' })
      expect(log).toHaveBeenCalledWith(expect.stringContaining('failed representative chunk cleanup'), expect.anything(), expect.anything())
    } finally {
      log.mockRestore()
    }
  })

  test('partial article preferences use the same available inputs for raw, centered and interests', async () => {
    await seed(1, [1], 'first', { starred: true })
    await seed(2, [1], 'missing')
    await seed(3, [1], 'third')
    const tilted = unit().map((value, index) => (index === 0 ? 0.8 : index === 1 ? 0.6 : value))
    indexes[0].stored.set('a:1:1', { id: 'a:1:1', values: unit() })
    indexes[0].stored.set('a:1:3', { id: 'a:1:3', values: tilted })
    const output = await service.refreshUser(1, 'article')
    expect(output).toMatchObject({ state: 'written', coverage: { eligible: 3, used: 2, missing: 1 } })
    expect(indexes[2].upsert).toHaveBeenCalledOnce()
    const raw = indexes[2].stored.get('u:1:article')!
    const centered = indexes[2].stored.get('u:1:article:centered')!
    const expectedRaw = weightedNormalizedSum([unit(), tilted], [2, 1])!
    const expectedCentered = weightedNormalizedSum([referenceCenter(unit()), referenceCenter(tilted)], [2, 1])!
    raw.values.forEach((value, index) => expect(value).toBeCloseTo(expectedRaw[index], 10))
    centered.values.forEach((value, index) => expect(value).toBeCloseTo(expectedCentered[index], 10))
    const partialInterests = raw.metadata!.interests
    await db.exec('UPDATE sr_user_bookmark SET deleted_at=now() WHERE bookmark_id=2')
    const complete = await service.refreshUser(1, 'article')
    expect(complete.coverage).toEqual({ eligible: 2, used: 2, missing: 0 })
    expect(indexes[2].stored.get('u:1:article')?.metadata?.interests).toBe(partialInterests)
    expect(complete.writeToken).toBe(output.writeToken)
    expect(provider).not.toHaveBeenCalled()
    expect(env.OSS.get).not.toHaveBeenCalled()
    expect(indexes[0].upsert).not.toHaveBeenCalled()
  })

  test.each(['article', 'collection'] as const)('%s preference continues after an entirely missing first page', async preference => {
    const rows = Array.from({ length: 103 }, (_, index) => ({ id: index + 1, is_starred: false }))
    const page = async (_user: number, after: number, limit: number) => rows.filter(row => row.id > after).slice(0, limit)
    const member = vi.spyOn(repo, preference === 'article' ? 'listUserArticles' : 'listUserCollections').mockImplementation(page)
    const sourceIndex = preference === 'article' ? indexes[0] : indexes[1]
    for (let id = 101; id <= 103; id++) {
      const key = preference === 'article' ? `a:1:${id}` : `c:${id}`
      sourceIndex.stored.set(key, { id: key, values: unit(1) })
    }
    try {
      const output = await service.refreshUser(1, preference)
      expect(output).toMatchObject({ state: 'written', coverage: { eligible: 103, used: 3, missing: 100 } })
      expect(member.mock.calls.map(call => call[1])).toEqual([0, 100])
      expect(sourceIndex.getByIds.mock.calls.flatMap(call => call[0])).toHaveLength(103)
      expect(await service.readUser(1, preference)).toEqual(unit(1))
      expect(provider).not.toHaveBeenCalled()
    } finally {
      member.mockRestore()
    }
  })

  test.each(['article', 'collection'] as const)('all missing %s inputs preserve the previous profile', async preference => {
    const rows = [
      { id: 41, is_starred: false },
      { id: 42, is_starred: true }
    ]
    const member = vi.spyOn(repo, preference === 'article' ? 'listUserArticles' : 'listUserCollections').mockResolvedValue(rows)
    const keys = preference === 'article' ? ['u:1:article', 'u:1:article:centered'] : ['u:1:collection']
    for (const key of keys) indexes[2].stored.set(key, { id: key, values: unit(2), namespace: `user-${preference}`, metadata: { original: true } })
    const original = structuredClone([...indexes[2].stored.entries()])
    try {
      const output = await service.refreshUser(1, preference)
      expect(output).toMatchObject({ state: 'failed', reason: 'no_usable_preference_vectors', coverage: { eligible: 2, used: 0, missing: 2 }, vectorIds: [], mutationIds: [] })
      expect([...indexes[2].stored.entries()]).toEqual(original)
      expect(indexes[2].upsert).not.toHaveBeenCalled()
      expect(indexes[2].deleteByIds).not.toHaveBeenCalled()
      expect(provider).not.toHaveBeenCalled()
    } finally {
      member.mockRestore()
    }
  })

  test.each(['article', 'collection'] as const)('empty eligible %s history still removes stale profiles with zero coverage', async preference => {
    const key = `u:1:${preference}`
    indexes[2].stored.set(key, { id: key, values: unit(), namespace: `user-${preference}` })
    const output = await service.refreshUser(1, preference)
    expect(output).toMatchObject({ state: 'deleted', coverage: { eligible: 0, used: 0, missing: 0 } })
    expect(indexes[2].stored.has(key)).toBe(false)
    expect(provider).not.toHaveBeenCalled()
  })

  test.each(['article', 'collection'] as const)('%s read errors after valid contributions never publish a partial replacement', async preference => {
    const member = vi
      .spyOn(repo, preference === 'article' ? 'listUserArticles' : 'listUserCollections')
      .mockResolvedValue(Array.from({ length: 21 }, (_, i) => ({ id: i + 1, is_starred: false })))
    const sourceIndex = preference === 'article' ? indexes[0] : indexes[1]
    const key = `u:1:${preference}`
    indexes[2].stored.set(key, { id: key, values: unit(2), namespace: `user-${preference}` })
    const original = structuredClone(indexes[2].stored.get(key))
    sourceIndex.getByIds.mockImplementation(async ids => {
      if (ids.some(id => id.endsWith(':21'))) throw new Error('storage_unavailable')
      return ids.map(id => ({ id, values: unit() }))
    })
    try {
      expect(await service.refreshUser(1, preference)).toMatchObject({ state: 'failed', reason: 'storage_unavailable', coverage: { missing: 0 } })
      expect(indexes[2].stored.get(key)).toEqual(original)
      expect(indexes[2].upsert).not.toHaveBeenCalled()
      expect(indexes[2].deleteByIds).not.toHaveBeenCalled()
    } finally {
      member.mockRestore()
    }
  })

  test('invalid present vectors are errors rather than missing contributions', async () => {
    await seed(1)
    await seed(2)
    indexes[0].stored.set('a:1:1', { id: 'a:1:1', values: unit() })
    indexes[0].stored.set('a:1:2', { id: 'a:1:2', values: [NaN] })
    expect(await service.refreshUser(1, 'article')).toMatchObject({ state: 'failed', reason: 'invalid_vector_dimensions', coverage: { missing: 0 } })
    expect(indexes[2].upsert).not.toHaveBeenCalled()
    expect(indexes[2].deleteByIds).not.toHaveBeenCalled()
  })

  test.each(['pending', 'failed'])('a %s capture is not a preference dependency until its source completes', async status => {
    await seed(41)
    await seed(42)
    await db.query('UPDATE sr_bookmark SET status=$1 WHERE id=42', [status])
    expect(await repo.listUserArticles(1, 0, 100)).toEqual([{ id: 41, is_starred: false }])
    const [article] = await service.refreshArticles([{ userId: 1, id: 41 }])
    expect(article).toMatchObject({ state: 'written', target: { kind: 'article', userId: 1, id: 41 } })
    expect(await service.refreshUser(1, 'article')).toMatchObject({ state: 'written', target: { kind: 'user', id: 1, preference: 'article' } })
    expect(indexes[0].stored.has('a:1:42')).toBe(false)
    expect(indexes[0].getByIds.mock.calls.every(([ids]) => !ids.includes('a:1:42'))).toBe(true)
    await db.exec("UPDATE sr_bookmark SET status='success' WHERE id=42")
    expect(await repo.listUserArticles(1, 0, 100)).toEqual([
      { id: 41, is_starred: false },
      { id: 42, is_starred: false }
    ])
    expect(await service.refreshUser(1, 'article')).toMatchObject({ state: 'written', coverage: { eligible: 2, used: 1, missing: 1 } })
    expect((await service.refreshArticles([{ userId: 1, id: 42 }]))[0]).toMatchObject({ state: 'written', target: { kind: 'article', userId: 1, id: 42 } })
    expect(await service.refreshUser(1, 'article')).toMatchObject({ state: 'written', coverage: { eligible: 2, used: 2, missing: 0 } })
  })

  test('Collection reads only its owners readable starred vector identities', async () => {
    await seed(1, [1], 'shared', { starred: true, published: true, privateUser: 1 })
    await seed(2, [1, 2], 'not shared')
    indexes[0].stored.set('a:1:1', { id: 'a:1:1', values: unit(1) })
    indexes[0].stored.set('a:2:1', { id: 'a:2:1', values: unit(2) })
    expect((await service.refreshCollection(1)).state).toBe('written')
    expect(indexes[0].getByIds.mock.calls).toEqual([[['a:1:1']]])
    expect(indexes[1].stored.get('c:1')?.values).toEqual(unit(1))
    await db.exec('INSERT INTO sr_bookmark_share VALUES(1,1,false)')
    expect((await service.refreshCollection(1)).state).toBe('deleted')
    expect(indexes[1].stored.size).toBe(0)
  })

  test('Collection freshness tracks latest eligible member publication or update, not creation', async () => {
    await seed(1, [1], 'older', { starred: true, published: true, privateUser: 1 })
    await seed(2, [1], 'newer', { starred: true, privateUser: 1 })
    await seed(3, [1], 'hidden newer', { starred: true, privateUser: 1 })
    await db.exec(`UPDATE sr_user_collection SET created_at='2020-01-01';
      UPDATE sr_bookmark SET published_at='2026-01-01',updated_at='2026-01-02' WHERE id=1;
      UPDATE sr_bookmark SET published_at='2026-02-01',updated_at='2026-03-01' WHERE id=2;
      UPDATE sr_bookmark SET published_at='2026-09-01',updated_at='2026-10-01' WHERE id=3;
      INSERT INTO sr_bookmark_share VALUES(3,1,false);`)
    indexes[0].stored.set('a:1:1', { id: 'a:1:1', values: unit() })
    indexes[0].stored.set('a:1:2', { id: 'a:1:2', values: unit() })
    expect((await service.refreshCollection(1)).state).toBe('written')
    expect(indexes[1].stored.get('c:1')?.metadata?.published_at).toBe(Date.parse('2026-03-01T00:00:00Z'))
    await db.exec('UPDATE sr_user_bookmark SET is_starred=false WHERE bookmark_id=2')
    expect((await service.refreshCollection(1)).state).toBe('written')
    expect(indexes[1].stored.get('c:1')?.metadata?.published_at).toBe(Date.parse('2026-01-02T00:00:00Z'))
  })

  test.each(['unstar', 'share-off'])('last member %s removes only that Collection preference contribution', async action => {
    await seed(1, [2], 'first collection', { starred: true, published: true, privateUser: 2 })
    await seed(2, [3], 'second collection', { starred: true, published: true, privateUser: 3 })
    await db.exec('INSERT INTO sr_user_collection_subscriber(user_id,collection_id,is_cancelled) VALUES(1,2,true),(1,3,false)')
    indexes[0].stored.set('a:2:1', { id: 'a:2:1', values: unit(0) })
    indexes[0].stored.set('a:3:2', { id: 'a:3:2', values: unit(1) })
    expect((await service.refreshCollection(2)).state).toBe('written')
    expect((await service.refreshCollection(3)).state).toBe('written')
    expect((await service.refreshUser(1, 'collection')).state).toBe('written')
    const combined = await service.readUser(1, 'collection')
    expect(combined?.[0]).toBeCloseTo(Math.SQRT1_2)
    expect(combined?.[1]).toBeCloseTo(Math.SQRT1_2)
    if (action === 'unstar') await db.exec('UPDATE sr_user_bookmark SET is_starred=false WHERE user_id=2')
    else await db.exec('INSERT INTO sr_bookmark_share VALUES(1,2,false)')
    expect((await service.refreshCollection(2)).state).toBe('deleted')
    expect(indexes[1].stored.has('c:2')).toBe(false)
    expect((await service.refreshUser(1, 'collection')).state).toBe('written')
    expect(await service.readUser(1, 'collection')).toEqual(unit(1))
    expect(indexes[1].stored.has('c:3')).toBe(true)
    await db.exec('UPDATE sr_user_bookmark SET is_starred=false WHERE user_id=3')
    expect((await service.refreshCollection(3)).state).toBe('deleted')
    expect((await service.refreshUser(1, 'collection')).state).toBe('deleted')
    expect(await service.readUser(1, 'collection')).toBeNull()
  })

  test('a nonempty Collection without its vector remains a real dependency failure', async () => {
    await seed(1, [2], 'published PDF member', { starred: true, published: true, privateUser: 2 })
    await db.exec('UPDATE sr_user_bookmark SET type=2; INSERT INTO sr_user_collection_subscriber(user_id,collection_id) VALUES(1,2)')
    const result = await service.refreshUser(1, 'collection')
    expect(result).toMatchObject({ state: 'failed', reason: 'no_usable_preference_vectors', coverage: { eligible: 1, used: 0, missing: 1 } })
    expect(indexes[2].upsert).not.toHaveBeenCalled()
    expect(indexes[2].deleteByIds).not.toHaveBeenCalled()
  })

  test.each(['shortcut', 'deleted', 'moderated', 'foreign-private', 'owner-sharing-off'])('Collection with only %s members is not a preference dependency', async state => {
    await seed(1, [2], 'ineligible member', { starred: true, published: true, privateUser: 2 })
    await db.exec('INSERT INTO sr_user_collection_subscriber(user_id,collection_id) VALUES(1,2)')
    if (state === 'shortcut') await db.exec('UPDATE sr_user_bookmark SET type=1')
    if (state === 'deleted') await db.exec('UPDATE sr_user_bookmark SET deleted_at=now()')
    if (state === 'moderated') await db.exec('UPDATE sr_bookmark SET moderation_result=1')
    if (state === 'foreign-private') await db.exec('UPDATE sr_bookmark SET private_user=3')
    if (state === 'owner-sharing-off') await db.exec('UPDATE sr_user SET snapshot_sharing=false WHERE id=2')
    expect((await service.refreshUser(1, 'collection')).state).toBe('deleted')
    expect(indexes[1].getByIds).not.toHaveBeenCalled()
  })

  test('103 canonical saves aggregate in bounded pages once each', async () => {
    await db.exec(`INSERT INTO sr_bookmark(id,uuid) SELECT id, id::text FROM generate_series(1,103) id;
      INSERT INTO sr_user_bookmark(user_id,bookmark_id) SELECT 1,id FROM sr_bookmark;`)
    for (let id = 1; id <= 103; id++) indexes[0].stored.set(`a:1:${id}`, { id: `a:1:${id}`, values: unit() })
    expect((await service.refreshUser(1, 'article')).state).toBe('written')
    const calls = indexes[0].getByIds.mock.calls.map(call => call[0])
    expect(calls.map(ids => ids.length)).toEqual([20, 20, 20, 20, 20, 3])
    expect(calls.every(ids => ids.length <= 20)).toBe(true)
    expect(new Set(calls.flat()).size).toBe(103)
    expect(await service.readUser(1, 'article')).toEqual(unit())
  })

  test('Collection aggregation pages 103 members in bounded native reads', async () => {
    await db.exec(`INSERT INTO sr_bookmark(id,uuid,title,content_md_key) SELECT 500 + i, 'member-' || i, 'Member ' || i, 'text/' || i FROM generate_series(1,103) i;
      INSERT INTO sr_user_bookmark(user_id,bookmark_id,is_starred) SELECT 2, 500 + i, true FROM generate_series(1,103) i;
      INSERT INTO sr_user_collection(id,owner_id,status,collection_code) VALUES (2,2,1,'members');`)
    for (let id = 501; id <= 603; id++) indexes[0].stored.set(`a:2:${id}`, { id: `a:2:${id}`, values: unit() })
    expect(await service.refreshCollection(2)).toMatchObject({ state: 'written', target: { kind: 'collection', id: 2 } })
    const calls = indexes[0].getByIds.mock.calls.map(call => call[0])
    expect(calls.map(ids => ids.length)).toEqual([20, 20, 20, 20, 20, 3])
    expect(calls.every(ids => ids.length <= 20)).toBe(true)
    expect(new Set(calls.flat()).size).toBe(103)
    expect(indexes[1].stored.get('c:2')?.values).toEqual(unit())
    expect(indexes[0].upsert).not.toHaveBeenCalled()
    expect(indexes[2].upsert).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
  })

  test('user Collection preference aggregates 103 active subscriptions across database and native pages', async () => {
    await db.exec(`INSERT INTO sr_bookmark(id,uuid,title,content_md_key) VALUES (3000,'uuid-3000','Owner member','text/3000');
      INSERT INTO sr_user_bookmark(user_id,bookmark_id,is_starred) VALUES (2,3000,true);
      INSERT INTO sr_user_collection(id,owner_id,status,collection_code) SELECT 200 + i, 2, 1, 'sub-collection-' || i FROM generate_series(1,103) i;
      INSERT INTO sr_user_collection_subscriber(user_id,collection_id) SELECT 1, 200 + i FROM generate_series(1,103) i;`)
    for (let id = 201; id <= 303; id++) indexes[1].stored.set(`c:${id}`, { id: `c:${id}`, values: unit() })
    expect((await service.refreshUser(1, 'collection')).state).toBe('written')
    const calls = indexes[1].getByIds.mock.calls.map(call => call[0])
    expect(calls.map(ids => ids.length)).toEqual([20, 20, 20, 20, 20, 3])
    expect(calls.every(ids => ids.length <= 20)).toBe(true)
    expect(new Set(calls.flat()).size).toBe(103)
    expect(await service.readUser(1, 'collection')).toEqual(unit())
    expect(indexes[0].getByIds).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
  })

  test('uses official standalone original-PDF payload and never substitutes extracted text', async () => {
    await seed()
    pdfVectors = 2
    objects.set('pdf/body/one.pdf', { bytes: pdfFixture(['Page one', 'Page two']) })
    await db.exec("UPDATE sr_bookmark SET content_key='pdf/body/one.pdf'")
    expect((await service.refreshArticles([{ userId: 1, id: 1 }]))[0].state).toBe('written')
    const payload = JSON.parse(provider.mock.calls[0][1].body as string)
    expect(typeof payload.input.pdf).toBe('string')
    expect(Array.isArray(payload.input)).toBe(false)
    expect(indexes[0].stored.get('a:1:1')?.metadata?.part_count).toBe(2)
  })

  test('stored Reader images use official merged content with existing ownership', async () => {
    await seed()
    const uuid = '12345678-1234-1234-1234-123456789012'
    const key = `private-snapshots/${uuid}/images/0`
    put('html/body/one.html', `<article><img src="https://source-assets.reader.invalid/${key}"></article>`)
    objects.set(key, { bytes: new Uint8Array([137, 80, 78, 71]), type: 'image/png' })
    await db.query("UPDATE sr_bookmark SET content_key='html/body/one.html',uuid=$1", [uuid])
    expect((await service.refreshArticles([{ userId: 1, id: 1 }]))[0].state).toBe('written')
    expect(provider.mock.calls.map(call => JSON.parse(call[1].body as string).input).flat()).toContainEqual({
      content: [{ text: 'Title 1' }, { image: Buffer.from([137, 80, 78, 71]).toString('base64') }]
    })
  })

  test('four selected images do not outweigh the complete text modality', async () => {
    await seed()
    const uuid = '12345678-1234-1234-1234-123456789012'
    let html = ''
    for (let i = 0; i < 4; i++) {
      const key = `private-snapshots/${uuid}/images/${i}`
      objects.set(key, { bytes: new Uint8Array([1, 2, 3]), type: 'image/png' })
      html += `<img width="800" src="https://source-assets.reader.invalid/${key}">`
    }
    put('html/body/images.html', html)
    await db.query("UPDATE sr_bookmark SET content_key='html/body/images.html',uuid=$1", [uuid])
    provider.mockImplementation(async (_url: string, init: RequestInit) => {
      const inputs = JSON.parse(init.body as string).input
      return Response.json({ model: VECTOR_MODEL, data: inputs.map((input: object, index: number) => ({ index, embedding: unit('text' in input ? 0 : 1) })) })
    })
    expect((await service.refreshArticles([{ userId: 1, id: 1 }]))[0].state).toBe('written')
    const vector = indexes[0].stored.get('a:1:1')!.values
    expect(vector[0]).toBeCloseTo(Math.SQRT1_2)
    expect(vector[1]).toBeCloseTo(Math.SQRT1_2)
  })

  test('one selected-image provider error does not fail sibling text articles', async () => {
    await seed(1)
    await seed(2)
    const uuid = '12345678-1234-1234-1234-123456789012'
    const key = `private-snapshots/${uuid}/images/0`
    objects.set(key, { bytes: new Uint8Array([1, 2, 3]), type: 'image/png' })
    put('html/body/one.html', `<img width="800" src="https://source-assets.reader.invalid/${key}">`)
    await db.query("UPDATE sr_bookmark SET content_key='html/body/one.html',uuid=$1 WHERE id=1", [uuid])
    provider.mockImplementation(async (_url: string, init: RequestInit) => {
      const inputs = JSON.parse(init.body as string).input
      if (inputs.some((input: object) => !('text' in input))) return new Response('rejected image', { status: 422 })
      return Response.json({ model: VECTOR_MODEL, data: inputs.map((_input: object, index: number) => ({ index, embedding: unit() })) })
    })
    const results = await service.refreshArticles([
      { userId: 1, id: 1 },
      { userId: 1, id: 2 }
    ])
    expect(results.map(result => result.state)).toEqual(['failed', 'written'])
    expect(indexes[0].stored.has('a:1:1')).toBe(false)
    expect(indexes[0].stored.has('a:1:2')).toBe(true)
  })

  test('HTML above 4MiB streams while substantial stored images above 512KiB are embedded', async () => {
    await seed()
    const uuid = '12345678-1234-1234-1234-123456789012'
    const key = `private-snapshots/${uuid}/images/0`
    const html = '<article>' + 'ordinary text '.repeat(400_000) + `<img width="800" height="600" src="https://source-assets.reader.invalid/${key}"></article>`
    put('html/body/large.html', html)
    objects.set(key, { bytes: new Uint8Array(700 * 1024).fill(1), type: 'image/jpeg' })
    await db.query("UPDATE sr_bookmark SET content_key='html/body/large.html',uuid=$1", [uuid])
    const get = env.OSS.get as ReturnType<typeof vi.fn>
    const original = get.getMockImplementation()!
    const wholeHtmlReads = vi.fn(() => {
      throw new Error('whole_html_read_forbidden')
    })
    get.mockImplementation(async (key: string, options: unknown) => {
      const object = await original(key, options)
      if (key === 'html/body/large.html') {
        object.text = wholeHtmlReads
        object.arrayBuffer = wholeHtmlReads
      }
      return object
    })
    expect((await service.refreshArticles([{ userId: 1, id: 1 }]))[0]).toMatchObject({ state: 'written', reason: 'images_selected:1;images_skipped:' })
    expect(wholeHtmlReads).not.toHaveBeenCalled()
    const inputs = provider.mock.calls.flatMap(call => JSON.parse(call[1].body as string).input)
    expect(inputs[0]).toEqual({ text: 'Title 1\n\nA full stored article.' })
    expect(inputs[1].content[1].image.length).toBe(Math.ceil((700 * 1024) / 3) * 4)
  })

  test('decorative unstored inline and missing images skip without failing a batch of ordinary text', async () => {
    const identities = []
    for (let id = 1; id <= 10; id++) {
      await seed(id)
      put(
        `html/${id}`,
        '<img width="16" height="16" src="https://external.test/logo.png"><img src="data:image/png;base64,aW1hZ2U="><img src="https://external.test/unavailable.jpg">'
      )
      await db.query('UPDATE sr_bookmark SET content_key=$1 WHERE id=$2', [`html/${id}`, id])
      identities.push({ userId: 1, id })
    }
    const results = await service.refreshArticles(identities)
    expect(results.every(result => result.state === 'written')).toBe(true)
    expect(results[0].reason).toBe('images_selected:0;images_skipped:decorative:1,inline:1,not_stored:1')
    expect(provider).toHaveBeenCalledOnce()
    expect(indexes[0].stored.size).toBe(10)
  })

  test('provider errors are explicit and never publish a partial representative', async () => {
    await seed(1, [1], 'large content '.repeat(20000))
    provider.mockImplementationOnce(async () => new Response('upstream secret diagnostic', { status: 503 }))
    expect((await service.refreshArticles([{ userId: 1, id: 1 }]))[0]).toMatchObject({ state: 'failed', reason: 'embedding_http_503' })
    expect(provider).toHaveBeenCalledOnce()
    expect(indexes[0].stored.size).toBe(0)
  })

  test('sends content under the request byte bound whole even above the old token estimate', async () => {
    const text = 'word '.repeat(60000)
    await seed(1, [1], text)
    expect(estimatedTokens(text)).toBeGreaterThan(30_000)
    expect(requestBytes([{ text: 'Title 1\n\n' + text }])).toBeLessThanOrEqual(VECTOR_REQUEST_BYTES)
    expect((await service.refreshArticles([{ userId: 1, id: 1 }]))[0].state).toBe('written')
    expect(provider).toHaveBeenCalledOnce()
    expect(provider.mock.calls.flatMap(call => JSON.parse(call[1].body as string).input)).toEqual([{ text: 'Title 1\n\n' + text }])
    expect(indexes[0].stored.get('a:1:1')?.metadata?.part_count).toBe(1)
  })

  test('empty users delete the raw and centered records and never emit zero vectors', async () => {
    indexes[2].stored.set('u:1:article', { id: 'u:1:article', values: unit(), namespace: 'user-article' })
    indexes[2].stored.set('u:1:article:centered', { id: 'u:1:article:centered', values: unit(1), namespace: 'user-article' })
    indexes[2].stored.set('u:1:collection', { id: 'u:1:collection', values: unit(1), namespace: 'user-collection' })
    const deleted = await service.refreshUser(1, 'article')
    expect(deleted.state).toBe('deleted')
    expect(deleted.removedVectorIds).toEqual(['u:1:article', 'u:1:article:centered'])
    expect(indexes[2].stored.has('u:1:article')).toBe(false)
    expect(indexes[2].stored.has('u:1:article:centered')).toBe(false)
    expect(await service.readUser(1, 'article')).toBeNull()
    expect(await service.readArticleProfile(1)).toBeNull()
    expect(await service.readUser(1, 'collection')).toEqual(unit(1))
    expect(indexes[2].upsert).not.toHaveBeenCalled()
  })

  test('AI user index accepts only the raw and centered article suffixes through getVectorsByIds', async () => {
    const rpc = env.VECTOR as unknown as AiEntry
    indexes[2].stored.set('u:1:article', { id: 'u:1:article', values: unit(0), namespace: 'user-article' })
    indexes[2].stored.set('u:1:article:centered', { id: 'u:1:article:centered', values: unit(1), namespace: 'user-article' })
    expect(await rpc.getVectorsByIds('user', ['u:1:article', 'u:1:article:centered'])).toHaveLength(2)
    for (const id of ['u:1:article:centred', 'u:1:article:center', 'u:1:collection:centered', 'u:1:article:centered:extra', 'u:0:article:centered']) {
      await expect(rpc.getVectorsByIds('user', [id])).rejects.toThrow('invalid_v5_ids')
    }
  })

  test('article ANN requires an owner filter, old public queries reject, Collection filters stay', async () => {
    const rpc = env.VECTOR as unknown as AiEntry
    await rpc.queryVectors('article', unit(), { userId: 7, limit: 100 })
    expect(indexes[0].query.mock.calls[0][1]).toEqual({
      topK: 100,
      filter: { kind: 'article', user_id: 7 },
      returnValues: false,
      returnMetadata: 'none'
    })
    for (const scope of [{ recommendable: true }, { userId: 7, recommendable: true }, { userId: 0 }, {}] as never[]) {
      await expect(rpc.queryVectors('article', unit(), scope)).rejects.toThrow('invalid_v5_query_scope')
    }
    expect(indexes[0].query).toHaveBeenCalledOnce()
    await rpc.queryVectors('collection', unit(), { limit: 100 })
    expect(indexes[1].query.mock.calls[0][1]).toEqual({ topK: 100, filter: { recommendable: true }, returnValues: false, returnMetadata: 'none' })
  })

  test('repository content fanout keeps relation cursors and includes removed saves for cleanup', async () => {
    await seed(10, [1, 2, 3])
    await db.exec('UPDATE sr_user_bookmark SET deleted_at=now() WHERE user_id=1; UPDATE sr_user SET deleted_at=now() WHERE id=3')
    expect(await repo.listContentOwners(10, 0, 1)).toEqual([{ id: 1, user_id: 1 }])
    expect(await repo.listContentOwners(10, 1, 10)).toEqual([{ id: 2, user_id: 2 }])
    await db.exec('UPDATE sr_bookmark SET private_user=1')
    expect(await repo.listContentOwners(10, 0, 10)).toEqual([{ id: 1, user_id: 1 }])
  })

  test('repository owner fanout returns bookmark identities without dropping removed starred relations', async () => {
    await seed(10, [1], 'deleted starred', { starred: true })
    await seed(20, [1], 'PDF', { starred: true })
    await seed(30, [1], 'shortcut', { starred: true })
    await seed(40, [1], 'unstarred')
    await seed(50, [1], 'foreign private', { starred: true, privateUser: 2 })
    await db.exec(
      'UPDATE sr_user_bookmark SET deleted_at=now() WHERE bookmark_id=10; UPDATE sr_user_bookmark SET type=2 WHERE bookmark_id=20; UPDATE sr_user_bookmark SET type=1 WHERE bookmark_id=30'
    )
    expect(await repo.listOwnerArticles(1, 0, 1)).toEqual([{ id: 1, bookmark_id: 10, user_id: 1 }])
    expect(await repo.listOwnerArticles(1, 1, 10)).toEqual([{ id: 2, bookmark_id: 20, user_id: 1 }])
    await db.exec('INSERT INTO sr_user_collection(id,owner_id,status) VALUES (11,1,0),(12,1,1),(13,2,1)')
    expect(await repo.listOwnerCollections(1)).toEqual([{ id: 11 }, { id: 12 }])
  })

  test('repository subscriber fanout lists only active, unexpired, non-deleted, non-owner subscriptions', async () => {
    await db.exec(`
      INSERT INTO sr_user(id) VALUES (9);
      INSERT INTO sr_user_collection(id,owner_id) VALUES (7,9),(8,9);
      INSERT INTO sr_user_collection_subscriber(id,user_id,collection_id,is_deleted,is_active,subscription_end_time) VALUES
        (1,1,7,true,true,now()+interval '1 day'),
        (2,2,7,false,true,now()+interval '1 day'),
        (3,3,8,false,false,now()+interval '1 day'),
        (4,9,7,false,true,now()+interval '1 day'),
        (5,4,7,false,true,now()-interval '1 day')
    `)
    expect(await repo.listSubscriberUsers(7, 0, 10)).toEqual([{ id: 2, user_id: 2 }])
    expect(await repo.listSubscriberUsers(7, 2, 10)).toEqual([])
    expect(await repo.listSubscriberUsers(8, 0, 10)).toEqual([])
  })

  test('native RPC rejects missing, combined or invalid scope and user ANN', async () => {
    const rpc = env.VECTOR as unknown as AiEntry
    await expect(rpc.queryVectors('article', unit(), {})).rejects.toThrow('invalid_v5_query_scope')
    await expect(rpc.queryVectors('article', unit(), { userId: 1, recommendable: true } as any)).rejects.toThrow('invalid_v5_query_scope')
    await expect(rpc.queryVectors('user' as any, unit(), {})).rejects.toThrow('invalid_v5_query_index')
    await expect(rpc.getVectorsByIds('article', ['a:1'])).rejects.toThrow('invalid_v5_ids')
    await expect(rpc.upsertVectors('user', [{ id: 'u:1:article', namespace: 'user-collection', values: unit() }])).rejects.toThrow('invalid_v5_namespace')
    expect(indexes[0].query).not.toHaveBeenCalled()
  })
})

describe('incremental preference maintenance', () => {
  const spread = (seed: number) => Array.from({ length: 1024 }, (_, i) => Math.sin(seed * 12.9898 + i * 78.233) + (i % 7 === seed % 7 ? 2 : 0))
  const store = (userId: number, id: number, values = spread(id)) => indexes[0].stored.set(`a:${userId}:${id}`, { id: `a:${userId}:${id}`, values })
  const full = () => new VectorMaintenanceService(repo, new VectorSourceRepo(env), new VectorEmbeddingClient(env), new VectorIndexClient(env), memoryPreferenceStates())
  const event = async (userId: number, id: number, change: () => Promise<unknown> = async () => undefined) => {
    await service.retireArticle({ userId, id })
    await change()
    return service.applyUserArticle({ userId, id })
  }
  const expectSameProfile = async () => {
    const incremental = structuredClone([indexes[2].stored.get('u:1:article'), indexes[2].stored.get('u:1:article:centered')])
    const reference = await full().refreshUser(1, 'article')
    expect(reference.state).toBe('written')
    const [raw, centered] = [indexes[2].stored.get('u:1:article')!, indexes[2].stored.get('u:1:article:centered')!]
    incremental[0]!.values.forEach((value, i) => expect(value).toBeCloseTo(raw.values[i], 10))
    incremental[1]!.values.forEach((value, i) => expect(value).toBeCloseTo(centered.values[i], 10))
    const interests = (vector: VectorizeVector) =>
      (JSON.parse(String(vector.metadata!.interests)) as [number, number][]).map(([id, importance]) => [id, Math.round(importance * 1000)])
    expect(interests(incremental[0]!)).toEqual(interests(raw))
  }

  test('save, star, unstar, re-embed and delete events match a full recompute without reading the whole history', async () => {
    for (const id of [1, 2, 3]) await seed(id, [1], `article ${id}`, { starred: id === 2 })
    for (const id of [1, 2, 3]) store(1, id)
    expect((await service.refreshUser(1, 'article')).state).toBe('written')
    const history = vi.spyOn(repo, 'listUserArticles')

    await seed(4, [1], 'new article')
    store(1, 4)
    expect(await event(1, 4)).toMatchObject({ state: 'written', coverage: { eligible: 4, used: 4, missing: 0 } })
    expect(history).not.toHaveBeenCalled()
    await expectSameProfile()

    history.mockClear()
    expect(await event(1, 1, () => db.exec('UPDATE sr_user_bookmark SET is_starred=true WHERE bookmark_id=1'))).toMatchObject({ state: 'written' })
    expect(await event(1, 2, () => db.exec('UPDATE sr_user_bookmark SET is_starred=false WHERE bookmark_id=2'))).toMatchObject({ state: 'written' })
    expect(await event(1, 3, async () => store(1, 3, spread(30)))).toMatchObject({ state: 'written' })
    expect(
      await event(1, 4, async () => {
        await db.exec('UPDATE sr_user_bookmark SET deleted_at=now() WHERE bookmark_id=4')
        indexes[0].stored.delete('a:1:4')
      })
    ).toMatchObject({ state: 'written', coverage: { eligible: 3, used: 3, missing: 0 } })
    expect(history).not.toHaveBeenCalled()
    await expectSameProfile()
  })

  test('missing or outdated state rebuilds once, then later events stay incremental', async () => {
    for (const id of [1, 2]) await seed(id, [1], `article ${id}`)
    for (const id of [1, 2]) store(1, id)
    const history = vi.spyOn(repo, 'listUserArticles')
    expect(await event(1, 1)).toMatchObject({ state: 'written', coverage: { eligible: 2, used: 2, missing: 0 } })
    expect(history).toHaveBeenCalled()
    history.mockClear()
    await seed(3, [1], 'third')
    store(1, 3)
    expect(await event(1, 3)).toMatchObject({ state: 'written', coverage: { eligible: 3, used: 3 } })
    expect(history).not.toHaveBeenCalled()
    await expectSameProfile()

    const outdated = (await states.read('state:user-article:1'))!
    await states.update('state:user-article:1', outdated.version, { ...outdated, version: outdated.version + 1, meanVersion: 'previous-mean' })
    expect(await event(1, 2)).toMatchObject({ state: 'written' })
    expect(history).toHaveBeenCalled()
    expect((await states.read('state:user-article:1'))!.meanVersion).toBe(EMBEDDING_MEAN_VERSION)
  })

  test('a vector replaced outside the event path triggers a rebuild instead of subtracting the wrong contribution', async () => {
    for (const id of [1, 2]) await seed(id, [1], `article ${id}`)
    for (const id of [1, 2]) store(1, id)
    await service.refreshUser(1, 'article')
    store(1, 1, spread(99))
    const history = vi.spyOn(repo, 'listUserArticles')
    expect(await service.applyUserArticle({ userId: 1, id: 1 })).toMatchObject({ state: 'written' })
    expect(history).toHaveBeenCalled()
    await expectSameProfile()
  })

  test('a failed article write restores the old contribution instead of dropping the article', async () => {
    for (const id of [1, 2]) await seed(id, [1], `article ${id}`, { starred: id === 1 })
    for (const id of [1, 2]) store(1, id)
    await service.refreshUser(1, 'article')
    await service.retireArticle({ userId: 1, id: 1 })
    expect((await states.read('state:user-article:1'))!.entries.get(1)).toEqual({ weight: 2, token: '' })
    await service.restoreArticle({ userId: 1, id: 1 })
    expect((await states.read('state:user-article:1'))!.entries.get(1)!.token).toMatch(/^[0-9a-f]{16}$/)
    expect(await service.applyUserArticle({ userId: 1, id: 2 })).toMatchObject({ state: 'written', coverage: { eligible: 2, used: 2, missing: 0 } })
    await expectSameProfile()
  })

  test('deleting the last article removes the profile and its state', async () => {
    await seed(1, [1], 'only')
    store(1, 1)
    await service.refreshUser(1, 'article')
    expect(states.rows.has('state:user-article:1')).toBe(true)
    const output = await event(1, 1, () => db.exec('UPDATE sr_user_bookmark SET deleted_at=now()'))
    expect(output).toMatchObject({ state: 'deleted', vectorIds: ['u:1:article', 'u:1:article:centered'] })
    expect(states.rows.has('state:user-article:1')).toBe(false)
    expect(indexes[2].stored.has('u:1:article')).toBe(false)
    expect(await service.verifyRefresh(output)).toBe(true)
  })

  test('concurrent events converge on one state and older publishers stand down', async () => {
    for (const id of [1, 2, 3]) await seed(id, [1], `article ${id}`)
    for (const id of [1, 2, 3]) store(1, id)
    await service.refreshUser(1, 'article')
    await db.exec('UPDATE sr_user_bookmark SET is_starred=true')
    const outputs = await Promise.all([1, 2, 3].map(id => service.applyUserArticle({ userId: 1, id })))
    expect(outputs.every(output => output.state !== 'failed')).toBe(true)
    for (const output of outputs) expect(await service.verifyRefresh(output)).toBe(true)
    const state = (await states.read('state:user-article:1'))!
    expect([...state.entries.values()].map(entry => entry.weight)).toEqual([2, 2, 2])
    expect(indexes[2].stored.get('u:1:article')!.metadata!.state_version).toBe(state.version)
    await expectSameProfile()
  })

  test('an older publisher stands down when a newer state commits just before its write', async () => {
    for (const id of [1, 2]) await seed(id, [1], `article ${id}`)
    for (const id of [1, 2]) store(1, id)
    await service.refreshUser(1, 'article')
    await db.exec('UPDATE sr_user_bookmark SET is_starred=true')
    const original = repo.listRecentUserActions.bind(repo)
    let newer: VectorRefreshResult | undefined
    vi.spyOn(repo, 'listRecentUserActions').mockImplementationOnce(async (...args) => {
      newer = await service.applyUserArticle({ userId: 1, id: 2 })
      return original(...args)
    })
    indexes[2].upsert.mockClear()
    const older = await service.applyUserArticle({ userId: 1, id: 1 })
    expect(older).toMatchObject({ superseded: true, state: 'empty' })
    expect(newer).toMatchObject({ state: 'written' })
    expect(older.stateVersion).toBeLessThan(newer!.stateVersion!)
    expect(indexes[2].upsert).toHaveBeenCalledOnce()
    expect(indexes[2].stored.get('u:1:article')!.metadata!.state_version).toBe(newer!.stateVersion)
    expect(await service.verifyRefresh(older)).toBe(true)
    expect(await service.verifyRefresh(newer!)).toBe(true)
    await expectSameProfile()
  })

  test('owner Collections share one incremental aggregate and stay strict about missing members', async () => {
    await seed(1, [1], 'member one', { starred: true, published: true })
    await db.exec("INSERT INTO sr_user_collection(id,owner_id,status,collection_code) VALUES (2,1,1,'second')")
    store(1, 1)
    expect((await service.refreshCollection(1)).state).toBe('written')
    const members = vi.spyOn(repo, 'listCollectionMembers')
    await seed(2, [1], 'member two', { starred: true })
    store(1, 2)
    await service.retireArticle({ userId: 1, id: 2 })
    const outputs = await service.applyOwnerCollections({ userId: 1, id: 2 })
    expect(outputs.map(output => [output.target, output.state])).toEqual([
      [{ kind: 'collection', id: 1 }, 'written'],
      [{ kind: 'collection', id: 2 }, 'written']
    ])
    expect(members).not.toHaveBeenCalled()
    expect(indexes[1].stored.get('c:1')!.values).toEqual(indexes[1].stored.get('c:2')!.values)
    const incremental = structuredClone(indexes[1].stored.get('c:1')!.values)
    expect((await full().refreshCollection(1)).state).toBe('written')
    incremental.forEach((value, i) => expect(value).toBeCloseTo(indexes[1].stored.get('c:1')!.values[i], 10))

    await seed(3, [1], 'member without vector', { starred: true })
    const missing = await service.applyOwnerCollections({ userId: 1, id: 3 })
    expect(missing.map(output => output.reason)).toEqual(['missing_dependency:a:1:3', 'missing_dependency:a:1:3'])
    store(1, 3)
    expect((await service.applyOwnerCollections({ userId: 1, id: 3 })).map(output => output.state)).toEqual(['written', 'written'])
  })
})
