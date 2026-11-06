import { PGlite } from '@electric-sql/pglite'
import type { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { Prisma } from '@prisma/hyperdrive-client'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { ContentRecommendationService } from '../../src/domain/contentRecommendation'
import { VectorMaintenanceService } from '../../src/domain/vectorMaintenance'
import type { VectorMaintenanceService as VectorMaintenance } from '../../src/domain/vectorMaintenance'
import { ContentRecommendationRepo } from '../../src/infra/repository/dbContentRecommendation'
import { VectorMaintenanceRepo } from '../../src/infra/repository/dbVectorMaintenance'
import { articleVectorId, type ArticleVectorIdentity } from '../../src/utils/vectorMaintenanceTypes'
import { EMBEDDING_MEAN } from '../../src/utils/embeddingMean'

const axis = (index: number) => Array.from({ length: 1024 }, (_, position) => (position === index ? 1 : 0))
const withMean = (terms: Array<[number, number]>) => {
  const vector = [...EMBEDDING_MEAN.values]
  for (const [position, value] of terms) vector[position] += value
  return vector
}

let pg: PGlite
let recommendationRepo: ContentRecommendationRepo
let maintenanceRepo: VectorMaintenanceRepo

const unit = (axis: number) => Array.from({ length: 1024 }, (_, index) => (index === axis ? 1 : 0))
const close = (actual: number, expected: number, tolerance = 1e-9) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance
const closeVector = (actual: number[], expected: number[], tolerance = 1e-9) =>
  actual.length === expected.length && actual.every((value, index) => close(value, expected[index], tolerance))

function disposableIndex() {
  const stored = new Map<string, any>()
  return {
    stored,
    get: vi.fn(async (_kind: string, ids: string[]) => ids.flatMap(id => (stored.has(id) ? [structuredClone(stored.get(id))] : []))),
    upsert: vi.fn(async (_kind: string, vectors: any[]) => {
      for (const vector of vectors) stored.set(vector.id, structuredClone(vector))
      return { mutationId: crypto.randomUUID() }
    }),
    delete: vi.fn(async (_kind: string, ids: string[]) => {
      for (const id of ids) stored.delete(id)
      return { mutationId: crypto.randomUUID() }
    }),
    query: vi.fn()
  }
}

function maintenance(index: ReturnType<typeof disposableIndex>) {
  return new VectorMaintenanceService(maintenanceRepo, {} as any, {} as any, index as any)
}

function articleRuntime(
  candidates: { id: number; userId: number; score: number }[],
  vectors: Map<string, number[]>,
  readUser: () => Promise<number[] | null> = async () => axis(0)
) {
  return {
    refreshArticles: vi.fn(),
    refreshCollection: vi.fn(),
    refreshUser: vi.fn(),
    verifyRefresh: vi.fn(),
    readUser: vi.fn(readUser),
    readArticleProfile: vi.fn(async () => {
      const vector = await readUser()
      return vector ? { vector, centered: vector, interests: [] } : null
    }),
    queryArticles: vi.fn().mockResolvedValue(candidates),
    queryCollections: vi.fn().mockResolvedValue([]),
    readArticles: vi.fn(
      async (identities: ArticleVectorIdentity[]) => new Map(identities.map(identity => [articleVectorId(identity), vectors.get(`${identity.userId}:${identity.id}`) ?? withMean([[0, 1]])]))
    ),
    readCollections: vi.fn(async (ids: number[]) => new Map(ids.map(id => [id, [1, 0]])))
  } as unknown as VectorMaintenance
}

function collectionRuntime(
  ids: { id: number; score: number }[],
  vectors: Map<string, number[]>,
  readUser: () => Promise<number[] | null> = async () => [1, 0],
  collectionVectors: Map<number, number[]> = new Map()
) {
  return {
    refreshArticles: vi.fn(),
    refreshCollection: vi.fn(),
    refreshUser: vi.fn(),
    verifyRefresh: vi.fn(),
    readUser: vi.fn(readUser),
    readArticleProfile: vi.fn(async () => {
      const vector = await readUser()
      return vector ? { vector, centered: vector, interests: [] } : null
    }),
    queryArticles: vi.fn().mockResolvedValue([]),
    queryCollections: vi.fn().mockResolvedValue(ids),
    readArticles: vi.fn(
      async (identities: ArticleVectorIdentity[]) => new Map(identities.map(identity => [articleVectorId(identity), vectors.get(`${identity.userId}:${identity.id}`) ?? [0, 0]]))
    ),
    readCollections: vi.fn(async (collectionIds: number[]) => new Map(collectionIds.map(id => [id, collectionVectors.get(id) ?? [1, 0]])))
  } as unknown as VectorMaintenance
}

async function vectorOf(index: ReturnType<typeof disposableIndex>, id: string) {
  return index.stored.get(id)?.values as number[] | undefined
}

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`
    CREATE TABLE sr_user(id int PRIMARY KEY, deleted_at timestamptz, snapshot_sharing boolean DEFAULT true);
    CREATE TABLE sr_bookmark(id int PRIMARY KEY, uuid text, title text DEFAULT '', target_url text, private_user int DEFAULT 0, status text DEFAULT 'success', moderation_result int DEFAULT 0, updated_at timestamptz DEFAULT now(), published_at timestamptz DEFAULT now());
    CREATE TABLE sr_user_bookmark(id serial PRIMARY KEY, uuid text, alias_title text DEFAULT '', user_id int, bookmark_id int, is_starred boolean DEFAULT false, deleted_at timestamptz, type int DEFAULT 0, created_at timestamptz DEFAULT now(), starred_at timestamptz);
    CREATE TABLE sr_user_collection(id int PRIMARY KEY, owner_id int, status int DEFAULT 1, collection_code text DEFAULT '', display_name text DEFAULT 'Collection', description text DEFAULT '', created_at timestamptz DEFAULT now());
    CREATE TABLE sr_bookmark_share(user_id int, bookmark_id int, is_enable boolean, UNIQUE(user_id, bookmark_id));
    CREATE TABLE sr_user_collection_subscriber(id serial PRIMARY KEY, user_id int, collection_id int, is_deleted boolean DEFAULT false, is_active boolean DEFAULT true, is_cancelled boolean DEFAULT false, auto_renew boolean DEFAULT true, subscription_end_time timestamptz DEFAULT now() + interval '1 year', updated_at timestamptz DEFAULT now());
  `)
  const prisma = {
    async $queryRaw(stringsOrQuery: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) {
      const query = Array.isArray(stringsOrQuery) ? Prisma.sql(stringsOrQuery as TemplateStringsArray, ...values) : stringsOrQuery
      return (await pg.query(query.text, query.values)).rows
    }
  } as unknown as HyperdrivePrismaClient
  recommendationRepo = new ContentRecommendationRepo(() => prisma)
  maintenanceRepo = new VectorMaintenanceRepo(() => prisma)
})

afterAll(async () => {
  await pg.close()
})

beforeEach(async () => {
  await pg.exec(`
    TRUNCATE sr_user, sr_bookmark, sr_user_bookmark, sr_user_collection, sr_bookmark_share, sr_user_collection_subscriber RESTART IDENTITY;
    INSERT INTO sr_user(id) VALUES (1),(2),(3),(4),(7),(8);
    INSERT INTO sr_user_collection(id,owner_id,status,collection_code) VALUES (10,1,1,'own'),(20,2,1,'c20'),(30,3,1,'c30'),(40,4,1,'c40'),(6,7,1,'c6'),(8,8,1,'c8');
    INSERT INTO sr_bookmark(id,target_url,published_at) VALUES
      (10,'https://example.com/10','2026-06-01T00:00:00Z'),
      (11,'https://example.com/11','2026-06-01T00:00:00Z'),
      (12,'https://example.com/12','2026-06-01T00:00:00Z'),
      (13,'https://example.com/13','2026-06-01T00:00:00Z'),
      (100,'https://example.com/100','2026-06-01T00:00:00Z'),
      (101,'https://example.com/101','2026-06-01T00:00:00Z'),
      (102,'https://example.com/102','2026-06-01T00:00:00Z');
    INSERT INTO sr_user_bookmark(user_id,bookmark_id,is_starred) VALUES
      (2,10,true),(3,11,true),(4,12,true),(1,13,true),(7,100,true),(7,102,true),(8,101,true);
  `)
})

describe('Collection aggregation and subscription-profile contracts', () => {
  test('Collection member chunks do not multiply influence', async () => {
    const index = disposableIndex()
    index.stored.set('a:7:100', { id: 'a:7:100', values: unit(0), metadata: { kind: 'article', part_count: 3 } })
    index.stored.set('a:7:100:c:0', { id: 'a:7:100:c:0', values: unit(1) })
    index.stored.set('a:7:100:c:1', { id: 'a:7:100:c:1', values: unit(1) })
    index.stored.set('a:7:100:c:2', { id: 'a:7:100:c:2', values: unit(1) })
    index.stored.set('a:7:102', { id: 'a:7:102', values: unit(1), metadata: { kind: 'article', part_count: 1 } })
    const service = maintenance(index)
    const result = await service.refreshCollection(6)
    const actual = await vectorOf(index, 'c:6')
    const expected = [Math.SQRT1_2, Math.SQRT1_2, ...new Array(1022).fill(0)]
    const pass = result.state === 'written' && !!actual && closeVector(actual, expected) && index.get.mock.calls.every(call => call[1].every((id: string) => !id.includes(':c:')))
    expect(pass).toBe(true)
  })

  test('duplicate owner relations are grouped once', async () => {
    await pg.exec(`INSERT INTO sr_user_bookmark(user_id,bookmark_id,is_starred) VALUES (7,100,false)`)
    const index = disposableIndex()
    index.stored.set('a:7:100', { id: 'a:7:100', values: unit(0), metadata: { kind: 'article', part_count: 1 } })
    index.stored.set('a:7:102', { id: 'a:7:102', values: unit(1), metadata: { kind: 'article', part_count: 1 } })
    const service = maintenance(index)
    await service.refreshCollection(6)
    const actual = await vectorOf(index, 'c:6')
    const expected = [Math.SQRT1_2, Math.SQRT1_2, ...new Array(1022).fill(0)]
    const pass = !!actual && closeVector(actual, expected) && index.get.mock.calls[0][1].length === 2
    expect(pass).toBe(true)
  })

  test('removing one member recomputes the remaining aggregate', async () => {
    await pg.exec(`UPDATE sr_user_bookmark SET is_starred=false WHERE user_id=7 AND bookmark_id=102`)
    const index = disposableIndex()
    index.stored.set('a:7:100', { id: 'a:7:100', values: unit(0), metadata: { kind: 'article', part_count: 1 } })
    const service = maintenance(index)
    await service.refreshCollection(6)
    const actual = await vectorOf(index, 'c:6')
    const expected = [...unit(0)]
    const pass = !!actual && closeVector(actual, expected)
    expect(pass).toBe(true)
  })

  test('removing the last member deletes the Collection vector instead of retaining a zero vector', async () => {
    await pg.exec(`UPDATE sr_user_bookmark SET is_starred=false WHERE user_id=7`)
    const index = disposableIndex()
    index.stored.set('c:6', { id: 'c:6', values: unit(0) })
    const service = maintenance(index)
    const result = await service.refreshCollection(6)
    const pass = result.state === 'deleted' && !index.stored.has('c:6') && index.delete.mock.calls.some(call => call[1].includes('c:6'))
    expect(pass).toBe(true)
  })

  test('replacing a representative changes the aggregate without using chunk values', async () => {
    await pg.exec(`UPDATE sr_user_bookmark SET is_starred=false WHERE user_id=7 AND bookmark_id=102`)
    const index = disposableIndex()
    index.stored.set('a:7:100', { id: 'a:7:100', values: unit(1), metadata: { kind: 'article', part_count: 1 } })
    const service = maintenance(index)
    await service.refreshCollection(6)
    const actual = await vectorOf(index, 'c:6')
    const expected = [...unit(1)]
    const pass = !!actual && closeVector(actual, expected)
    expect(pass).toBe(true)
  })

  test('refreshing owner A does not alter owner B Collection', async () => {
    await pg.exec(`UPDATE sr_user_bookmark SET is_starred=false WHERE user_id=7 AND bookmark_id=102`)
    const index = disposableIndex()
    index.stored.set('a:7:100', { id: 'a:7:100', values: unit(0), metadata: { kind: 'article', part_count: 1 } })
    index.stored.set('a:8:101', { id: 'a:8:101', values: unit(1), metadata: { kind: 'article', part_count: 1 } })
    index.stored.set('c:8', { id: 'c:8', values: unit(1) })
    const service = maintenance(index)
    const refreshed = await service.refreshCollection(6)
    const ownerA = await vectorOf(index, 'c:6')
    const actual = await vectorOf(index, 'c:8')
    const expected = [...unit(1)]
    const pass = refreshed.state === 'written' && !!ownerA && closeVector(ownerA, unit(0)) && !!actual && closeVector(actual, expected)
    expect(pass).toBe(true)
  })
})

describe('user Collection preference contracts', () => {
  async function subscribe(collectionId: number, end = "now() + interval '1 year'") {
    await pg.exec(`INSERT INTO sr_user_collection_subscriber(user_id,collection_id,is_active,subscription_end_time) VALUES (1,${collectionId},true,${end})`)
  }

  test('subscribing to C1 writes the C1 direction only', async () => {
    await subscribe(20)
    const index = disposableIndex()
    index.stored.set('c:20', { id: 'c:20', values: unit(0) })
    const service = maintenance(index)
    const result = await service.refreshUser(1, 'collection')
    const actual = await vectorOf(index, 'u:1:collection')
    const expected = [...unit(0)]
    const pass = result.state === 'written' && !!actual && closeVector(actual, expected)
    expect(pass).toBe(true)
  })

  test('subscribing to C2 composes the normalized sum', async () => {
    await subscribe(20)
    await subscribe(30)
    const index = disposableIndex()
    index.stored.set('c:20', { id: 'c:20', values: unit(0) })
    index.stored.set('c:30', { id: 'c:30', values: unit(1) })
    await maintenance(index).refreshUser(1, 'collection')
    const actual = await vectorOf(index, 'u:1:collection')
    const expected = [Math.SQRT1_2, Math.SQRT1_2, ...new Array(1022).fill(0)]
    const pass = !!actual && closeVector(actual, expected)
    expect(pass).toBe(true)
  })

  test('cancelling C2 restores the C1 profile', async () => {
    await subscribe(20)
    await subscribe(30)
    const index = disposableIndex()
    index.stored.set('c:20', { id: 'c:20', values: unit(0) })
    index.stored.set('c:30', { id: 'c:30', values: unit(1) })
    await maintenance(index).refreshUser(1, 'collection')
    await pg.exec(`UPDATE sr_user_collection_subscriber SET is_deleted=true,is_active=false WHERE collection_id=30`)
    await maintenance(index).refreshUser(1, 'collection')
    const actual = await vectorOf(index, 'u:1:collection')
    const expected = [...unit(0)]
    const pass = !!actual && closeVector(actual, expected)
    expect(pass).toBe(true)
  })

  test('re-subscribing C2 restores the composed profile', async () => {
    await subscribe(20)
    await subscribe(30)
    const index = disposableIndex()
    index.stored.set('c:20', { id: 'c:20', values: unit(0) })
    index.stored.set('c:30', { id: 'c:30', values: unit(1) })
    await maintenance(index).refreshUser(1, 'collection')
    await pg.exec(`UPDATE sr_user_collection_subscriber SET is_deleted=false,is_active=true WHERE collection_id=30`)
    await maintenance(index).refreshUser(1, 'collection')
    const actual = await vectorOf(index, 'u:1:collection')
    const expected = [Math.SQRT1_2, Math.SQRT1_2, ...new Array(1022).fill(0)]
    const pass = !!actual && closeVector(actual, expected)
    expect(pass).toBe(true)
  })

  test('expired and own subscriptions are excluded from the profile', async () => {
    await subscribe(20)
    await subscribe(30, "now() - interval '1 day'")
    await subscribe(10)
    const index = disposableIndex()
    index.stored.set('c:20', { id: 'c:20', values: unit(0) })
    index.stored.set('c:30', { id: 'c:30', values: unit(1) })
    index.stored.set('c:10', { id: 'c:10', values: unit(1) })
    await maintenance(index).refreshUser(1, 'collection')
    const actual = await vectorOf(index, 'u:1:collection')
    const expected = [...unit(0)]
    const pass = !!actual && closeVector(actual, expected)
    expect(pass).toBe(true)
  })

  test('all expired subscriptions delete the profile without a zero vector', async () => {
    await subscribe(20, "now() - interval '1 day'")
    await subscribe(30, "now() - interval '1 day'")
    const index = disposableIndex()
    index.stored.set('u:1:collection', { id: 'u:1:collection', namespace: 'user-collection', values: unit(0) })
    const result = await maintenance(index).refreshUser(1, 'collection')
    const pass = result.state === 'deleted' && !index.stored.has('u:1:collection')
    expect(pass).toBe(true)
  })

  test('Collection profile maintenance leaves article preference and Collection vectors unchanged', async () => {
    await subscribe(20)
    const index = disposableIndex()
    index.stored.set('u:1:article', { id: 'u:1:article', namespace: 'user-article', values: unit(1) })
    index.stored.set('c:20', { id: 'c:20', values: unit(0) })
    index.stored.set('c:30', { id: 'c:30', values: unit(1) })
    const refreshed = await maintenance(index).refreshUser(1, 'collection')
    const profile = await vectorOf(index, 'u:1:collection')
    const article = await vectorOf(index, 'u:1:article')
    const collection = await vectorOf(index, 'c:20')
    const pass =
      refreshed.state === 'written' && !!profile && closeVector(profile, unit(0)) && !!article && !!collection && closeVector(article, unit(1)) && closeVector(collection, unit(0))
    expect(pass).toBe(true)
  })

  test('repeated profile refresh is idempotent', async () => {
    await subscribe(20)
    await subscribe(30)
    const index = disposableIndex()
    index.stored.set('c:20', { id: 'c:20', values: unit(0) })
    index.stored.set('c:30', { id: 'c:30', values: unit(1) })
    const service = maintenance(index)
    await service.refreshUser(1, 'collection')
    const first = await vectorOf(index, 'u:1:collection')
    await service.refreshUser(1, 'collection')
    const second = await vectorOf(index, 'u:1:collection')
    const expected = [Math.SQRT1_2, Math.SQRT1_2, ...new Array(1022).fill(0)]
    const pass = !!first && !!second && closeVector(first, expected) && closeVector(second, expected)
    expect(pass).toBe(true)
  })
})

describe('Collection recommendation and feedback contracts', () => {
  test('Collection score is the exact read-vector cosine, not the native score', async () => {
    const service = new ContentRecommendationService(
      recommendationRepo,
      collectionRuntime(
        [
          { id: 20, score: 0.9 },
          { id: 30, score: 0.8 }
        ],
        new Map(),
        async () => [1, 0],
        new Map([
          [20, [0, 1]],
          [30, [1, 0]]
        ])
      )
    )
    const result = await service.collections(1)
    const actual = result.items.map(item => ({ id: item.id, score: item.score }))
    const expected = [
      { id: 30, score: 1 },
      { id: 20, score: 0 }
    ]
    const pass = JSON.stringify(actual.map(item => item.id)) === JSON.stringify([30, 20]) && actual.every((item, index) => close(item.score, expected[index].score))
    expect(pass).toBe(true)
  })

  test('MMR with cosine similarity demotes a near-duplicate Collection', async () => {
    const service = new ContentRecommendationService(
      recommendationRepo,
      collectionRuntime(
        [
          { id: 20, score: 0.91 },
          { id: 30, score: 0.89 },
          { id: 40, score: 0.6 }
        ],
        new Map(),
        async () => [1, 0],
        new Map([
          [20, [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]],
          [30, [Math.cos((31 * Math.PI) / 180), Math.sin((31 * Math.PI) / 180)]],
          [40, [Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)]]
        ])
      )
    )
    const result = await service.collections(1)
    const actual = result.items.map(item => ({ id: item.id, score: item.score }))
    const expected = [
      { id: 20, score: Math.cos(Math.PI / 6) },
      { id: 40, score: Math.cos(Math.PI / 6) },
      { id: 30, score: Math.cos((31 * Math.PI) / 180) }
    ]
    const pass =
      JSON.stringify(actual.map(item => item.id)) === JSON.stringify([20, 40, 30]) && actual.every((item, index) => close(item.score, expected[index].score))
    expect(pass).toBe(true)
  })

  test('subscribed Collection is excluded while the paused article feed stays empty', async () => {
    await pg.exec(`INSERT INTO sr_user_collection_subscriber(user_id,collection_id,is_active,subscription_end_time) VALUES (1,20,true,now() + interval '1 year')`)
    const collections = await new ContentRecommendationService(
      recommendationRepo,
      collectionRuntime(
        [
          { id: 20, score: 0.9 },
          { id: 30, score: 0.8 }
        ],
        new Map(),
        async () => [1, 0]
      )
    ).collections(1)
    const articleVectors = articleRuntime([{ id: 10, userId: 2, score: 0.9 }], new Map([['2:10', withMean([[0, 1]])]]))
    const articles = await new ContentRecommendationService(recommendationRepo, articleVectors).articles(1)
    const expected = { collectionIds: [30], article: { items: [], preferenceKind: 'article', reason: 'no_public_candidates' } }
    const actual = { collectionIds: collections.items.map(item => item.id), article: articles }
    expect(actual).toEqual(expected)
    expect(articleVectors.queryArticles).not.toHaveBeenCalled()
    expect(articleVectors.readArticles).not.toHaveBeenCalled()
  })

  test('cold start returns no items and never queries native Collections', async () => {
    const runtime = collectionRuntime([], new Map(), async () => null)
    const result = await new ContentRecommendationService(recommendationRepo, runtime).collections(1)
    const pass = result.reason === 'cold_start' && result.items.length === 0 && vi.mocked(runtime.queryCollections).mock.calls.length === 0
    expect(pass).toBe(true)
  })

  test('revocation after recall drops the Collection before the response', async () => {
    const runtime = collectionRuntime([{ id: 30, score: 0.9 }], new Map())
    vi.mocked(runtime.readCollections).mockImplementation(async ids => {
      await pg.exec(`UPDATE sr_user_collection SET status=0 WHERE id=30`)
      return new Map(ids.map(id => [id, [1, 0]]))
    })
    const result = await new ContentRecommendationService(recommendationRepo, runtime).collections(1)
    const pass = result.items.length === 0 && vi.mocked(runtime.queryCollections).mock.calls.length === 1 && vi.mocked(runtime.readCollections).mock.calls.length === 1
    expect(pass).toBe(true)
  })

  test('subscription action composes the next profile and recommendation exclusion', async () => {
    const index = disposableIndex()
    index.stored.set('c:20', { id: 'c:20', values: unit(0) })
    index.stored.set('c:30', { id: 'c:30', values: unit(1) })
    const service = maintenance(index)
    await pg.exec(`INSERT INTO sr_user_collection_subscriber(user_id,collection_id,is_active,subscription_end_time) VALUES (1,20,true,now() + interval '1 year')`)
    await service.refreshUser(1, 'collection')
    const profileAfterC20 = await vectorOf(index, 'u:1:collection')
    const runtime = collectionRuntime(
      [
        { id: 20, score: 0.9 },
        { id: 30, score: 0.8 }
      ],
      new Map(),
      async () => service.readUser(1, 'collection')
    )
    const afterC20 = await new ContentRecommendationService(recommendationRepo, runtime).collections(1)
    await pg.exec(`INSERT INTO sr_user_collection_subscriber(user_id,collection_id,is_active,subscription_end_time) VALUES (1,30,true,now() + interval '1 year')`)
    await service.refreshUser(1, 'collection')
    const profileAfterC30 = await vectorOf(index, 'u:1:collection')
    const afterC30 = await new ContentRecommendationService(
      recommendationRepo,
      collectionRuntime(
        [
          { id: 20, score: 0.9 },
          { id: 30, score: 0.8 }
        ],
        new Map(),
        async () => service.readUser(1, 'collection')
      )
    ).collections(1)
    const expectedProfile = [Math.SQRT1_2, Math.SQRT1_2, ...new Array(1022).fill(0)]
    const pass =
      !!profileAfterC20 &&
      !!profileAfterC30 &&
      closeVector(profileAfterC20, unit(0)) &&
      closeVector(profileAfterC30, expectedProfile) &&
      JSON.stringify(afterC20.items.map(item => item.id)) === JSON.stringify([30]) &&
      afterC30.items.length === 0
    expect(pass).toBe(true)
  })
})
