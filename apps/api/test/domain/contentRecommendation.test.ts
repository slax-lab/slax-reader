import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Prisma, PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { ContentRecommendationService } from '../../src/domain/contentRecommendation'
import type { VectorMaintenanceService } from '../../src/domain/vectorMaintenance'
import { ContentRecommendationRepo } from '../../src/infra/repository/dbContentRecommendation'
import { articleVectorId, type ArticleVectorIdentity } from '../../src/utils/vectorMaintenanceTypes'
import { cosineSimilarity, mmrSelect } from '../../src/utils/recommendationAlgorithms'
import { EMBEDDING_MEAN } from '../../src/utils/embeddingMean'

const axis = (index: number) => Array.from({ length: 1024 }, (_, position) => (position === index ? 1 : 0))
const withMean = (terms: Array<[number, number]>) => {
  const vector = [...EMBEDDING_MEAN.values]
  for (const [position, value] of terms) vector[position] += value
  return vector
}

let pg: PGlite
let db: ContentRecommendationRepo

function runtime() {
  return {
    refreshArticles: vi.fn(),
    refreshCollection: vi.fn(),
    refreshUser: vi.fn(),
    verifyRefresh: vi.fn(),
    readUser: vi.fn().mockResolvedValue([1, 0]),
    readArticleProfile: vi.fn().mockResolvedValue({ vector: axis(0), centered: axis(0), interests: [] }),
    queryArticles: vi.fn().mockResolvedValue([]),
    queryCollections: vi.fn().mockResolvedValue([]),
    readArticles: vi.fn().mockImplementation(async (identities: ArticleVectorIdentity[]) =>
      new Map(identities.map(identity => [articleVectorId(identity), axis(0)]))
    ),
    readCollections: vi.fn().mockImplementation(async (ids: number[]) => new Map(ids.map(id => [id, [1, 0]])))
  } as unknown as VectorMaintenanceService
}

const isolateArticles = async (pairs: Array<[number, number]>) => {
  const keep = pairs.map(([userId, bookmarkId]) => `(user_id=${userId} AND bookmark_id=${bookmarkId})`).join(' OR ')
  await pg.exec(`DELETE FROM sr_user_bookmark WHERE NOT (${keep})`)
}

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`
    CREATE TABLE sr_user (id int PRIMARY KEY, deleted_at timestamptz, snapshot_sharing boolean DEFAULT true);
    CREATE TABLE sr_bookmark (id int PRIMARY KEY, title text DEFAULT 'Article', target_url text, private_user int DEFAULT 0, status text DEFAULT 'success', moderation_result int DEFAULT 0, published_at timestamptz DEFAULT now());
    CREATE TABLE sr_user_bookmark (id int PRIMARY KEY, uuid text, user_id int, bookmark_id int, alias_title text DEFAULT '', is_starred boolean DEFAULT true, type int DEFAULT 0, deleted_at timestamptz, created_at timestamptz DEFAULT now(), starred_at timestamptz, UNIQUE(user_id, bookmark_id));
    CREATE TABLE sr_user_collection (id int PRIMARY KEY, owner_id int UNIQUE, collection_code text, display_name text DEFAULT 'Collection', description text DEFAULT '', status int DEFAULT 1);
    CREATE TABLE sr_bookmark_share (user_id int, bookmark_id int, is_enable boolean, UNIQUE(user_id, bookmark_id));
    CREATE TABLE sr_user_collection_subscriber (user_id int, collection_id int, is_deleted boolean DEFAULT false, is_active boolean DEFAULT true, is_cancelled boolean DEFAULT false, auto_renew boolean DEFAULT true, subscription_end_time timestamptz DEFAULT now() + interval '1 day');
  `)
  const prisma = { $queryRaw: async (query: Prisma.Sql) => (await pg.query(query.text, query.values)).rows } as unknown as HyperdrivePrismaClient
  db = new ContentRecommendationRepo(() => prisma)
})

afterAll(async () => { await pg.close() })

beforeEach(async () => {
  await pg.exec(`
    TRUNCATE sr_user, sr_bookmark, sr_user_bookmark, sr_user_collection, sr_bookmark_share, sr_user_collection_subscriber;
    INSERT INTO sr_user(id) VALUES (1), (2), (3), (4), (5), (6), (7), (8);
    INSERT INTO sr_bookmark(id, target_url) VALUES (10, 'https://example.com/public'), (11, 'https://example.com/private'), (12, 'https://example.com/saved'), (13, 'https://example.com/public'), (14, 'https://example.com/moderated'), (15, 'https://example.com/revoked'), (16, 'https://example.com/no-collection');
    INSERT INTO sr_user_collection(id, owner_id, collection_code) VALUES (20, 2, 'public'), (30, 3, 'other'), (40, 4, 'own'), (50, 5, 'closed'), (60, 6, 'deleted-owner'), (70, 7, 'no-public-members');
    UPDATE sr_user_collection SET status = 0 WHERE id = 50;
    UPDATE sr_user SET deleted_at = now() WHERE id = 6;
    INSERT INTO sr_user_bookmark(id,uuid,user_id,bookmark_id,is_starred) VALUES
      (1,'public-pair',2,10,true), (2,'private-pair',3,11,false), (3,'saved',1,12,false),
      (4,'saved-candidate',2,12,true), (5,'same-bookmark-other-owner',3,10,true),
      (6,'own',4,13,true), (7,'closed',5,10,true), (8,'deleted-owner',6,10,true),
      (9,'moderated',2,14,true), (10,'revoked',2,15,true), (11,'no-collection',8,16,true),
      (12,'no-public-members',7,11,false);
    UPDATE sr_bookmark SET moderation_result = 1 WHERE id = 14;
    INSERT INTO sr_bookmark_share VALUES (2,15,false);
    INSERT INTO sr_user_collection_subscriber(user_id,collection_id) VALUES (1,20);
  `)
})


describe('paused article feed', () => {
  test('returns an explicit empty no_public_candidates feed without preferences, retrieval, hydration or model work', async () => {
    const vectors = runtime()
    const repo = {
      getArticleCandidates: vi.fn(),
      getLatestCandidates: vi.fn(),
      getPopularCandidates: vi.fn(),
      getCollectionCandidates: vi.fn(),
      getRecentMembers: vi.fn()
    }
    const result = await new ContentRecommendationService(repo as never, vectors).articles(1, 'article', 10)
    expect(result).toEqual({ items: [], preferenceKind: 'article', reason: 'no_public_candidates' })
    for (const call of Object.values(vectors)) expect(call).not.toHaveBeenCalled()
    for (const call of Object.values(repo)) expect(call).not.toHaveBeenCalled()
  })

  test('ignores seeded saves, candidates and limits because article ranking is paused', async () => {
    await pg.exec(`
      INSERT INTO sr_user_bookmark(id,uuid,user_id,bookmark_id,is_starred) VALUES
        (101,'paused-article-1',2,10,true),(102,'paused-article-2',3,19,true) ON CONFLICT DO NOTHING;
    `)
    const vectors = runtime([{ id: 10, userId: 2, score: 0.9 }], new Map([['2:10', axis(0)]]))
    const service = new ContentRecommendationService(db, vectors)
    for (const limit of [1, 10, 50]) {
      expect(await service.articles(1, 'article', limit)).toEqual({ items: [], preferenceKind: 'article', reason: 'no_public_candidates' })
    }
    expect(vectors.readArticleProfile).not.toHaveBeenCalled()
    expect(vectors.queryArticles).not.toHaveBeenCalled()
    expect(vectors.readArticles).not.toHaveBeenCalled()
  })

  test('still rejects a mismatched preference kind before any dependency call', async () => {
    const vectors = runtime()
    await expect(new ContentRecommendationService(db, vectors).articles(1, 'collection')).rejects.toThrow('invalid_preference_kind')
    for (const call of Object.values(vectors)) expect(call).not.toHaveBeenCalled()
  })
})

describe('published-pair content recommendations', () => {
  test('returns empty candidate lists without resolving the database client', async () => {
    const client = vi.fn<() => HyperdrivePrismaClient>()
    const repo = new ContentRecommendationRepo(client)
    expect(await repo.getArticleCandidates([], 1)).toEqual([])
    expect(await repo.getCollectionCandidates([], 1)).toEqual([])
    expect(await repo.getRecentMembers([], 3)).toEqual([])
    expect(client).not.toHaveBeenCalled()
  })


  test('drops a Collection closed after vector readback and before response', async () => {
    const vectors = runtime()
    vi.mocked(vectors.queryCollections).mockResolvedValue([{ id: 30, score: 1 }])
    vi.mocked(vectors.readCollections).mockImplementation(async ids => {
      await pg.exec('UPDATE sr_user_collection SET status=0 WHERE id=30')
      return new Map(ids.map(id => [id, [1, 0]]))
    })
    expect((await new ContentRecommendationService(db, vectors).collections(1)).items).toEqual([])
    expect(vectors.readCollections).toHaveBeenCalledOnce()
  })


  test('excludes subscribed, own, closed, deleted-owner and nonpublic Collections', async () => {
    const vectors = runtime()
    vi.mocked(vectors.queryCollections).mockResolvedValue([20, 30, 40, 50, 60, 70].map(id => ({ id, score: 0.9 })))
    const subscribed = await new ContentRecommendationService(db, vectors).collections(1)
    expect(subscribed.items.map(item => item.id).sort()).toEqual([30, 40])
    const own = await new ContentRecommendationService(db, vectors).collections(4)
    expect(own.items.some(item => item.id === 40)).toBe(false)
    expect(own.items.every(item => item.articles.every(article => article.sourceUserId !== 4))).toBe(true)
  })

  test('shows at most three recent public members per Collection as a display-only preview', async () => {
    await pg.exec(`
      INSERT INTO sr_bookmark(id,target_url) VALUES (21,'https://example.com/21'),(22,'https://example.com/22'),(23,'https://example.com/23'),(24,'https://example.com/24');
      INSERT INTO sr_user_bookmark(id,uuid,user_id,bookmark_id,starred_at) VALUES
        (21,'member-21',3,21,'2026-11-01'),(22,'member-22',3,22,'2026-11-02'),(23,'member-23',3,23,'2026-11-03'),(24,'member-24',3,24,'2026-11-04');
      INSERT INTO sr_bookmark_share VALUES (3,24,false);
      UPDATE sr_user_bookmark SET starred_at='2026-10-01' WHERE user_id=3 AND bookmark_id=10;
    `)
    const vectors = runtime()
    vi.mocked(vectors.queryCollections).mockResolvedValue([{ id: 30, score: 0.8 }])
    vi.mocked(vectors.readCollections).mockResolvedValue(new Map([[30, [0.8, 0.6]]]))
    const result = await new ContentRecommendationService(db, vectors).collections(1)
    expect(result.items[0].articles.map(article => article.id)).toEqual([23, 22, 21])
    expect(result.items[0].score).toBeCloseTo(0.8, 10)
    expect(vectors.readArticles).not.toHaveBeenCalled()
  })


  test('cancelling renewal does not make an active unexpired subscription recommendable again', async () => {
    await pg.exec('UPDATE sr_user_collection_subscriber SET auto_renew=false,is_cancelled=true WHERE user_id=1 AND collection_id=20')
    const vectors = runtime()
    vi.mocked(vectors.queryCollections).mockResolvedValue([{ id:20,score:0.9 }])
    const service = new ContentRecommendationService(db, vectors)
    expect((await service.collections(1)).items).toEqual([])
    await pg.exec('UPDATE sr_user_collection_subscriber SET is_active=false WHERE user_id=1 AND collection_id=20')
    expect((await service.collections(1)).items.map(item => item.id)).toEqual([20])
    await pg.exec("UPDATE sr_user_collection_subscriber SET is_active=true,subscription_end_time=now()-interval '1 day' WHERE user_id=1 AND collection_id=20")
    expect((await service.collections(1)).items.map(item => item.id)).toEqual([20])
  })

  test('uses bounded MMR diversity and cosine rather than category guesses', () => {
    expect(cosineSimilarity([2, 0], [1, 0])).toBe(1)
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0)
    expect(
      mmrSelect(
        [
          { item: 'a', sim1: 1, vector: [1, 0] },
          { item: 'b', sim1: 0.99, vector: [1, 0] },
          { item: 'c', sim1: 0.8, vector: [0, 1] }
        ],
        2,
        0.7
      )
    ).toEqual(['a', 'c'])
  })
})

describe('Collection ranking and revocation', () => {
  test('Collection score is the mean-member cosine and preview articles carry no score', async () => {
    await pg.exec(`
      INSERT INTO sr_bookmark(id,target_url) VALUES (21,'https://example.com/21'),(22,'https://example.com/22');
      INSERT INTO sr_user_bookmark(id,uuid,user_id,bookmark_id,is_starred,starred_at) VALUES
        (21,'member-21',3,21,true,'2026-05-03'),
        (22,'member-22',3,22,true,'2026-05-04');
      UPDATE sr_user_bookmark SET starred_at='2026-05-01' WHERE user_id=3 AND bookmark_id=10;
    `)
    const vectors = runtime()
    vi.mocked(vectors.queryCollections).mockResolvedValue([{ id: 30, score: 0.8 }])
    vi.mocked(vectors.readCollections).mockResolvedValue(new Map([[30, [0.8, 0.6]]]))
    const result = await new ContentRecommendationService(db, vectors).collections(1)
    expect(result.items[0].id).toBe(30)
    expect(result.items[0].score).toBeCloseTo(0.8, 10)
    expect(result.items[0].articles.map(article => article.id)).toEqual([22, 21, 10])
    for (const article of result.items[0].articles) expect('score' in article).toBe(false)
    expect(vectors.readArticles).not.toHaveBeenCalled()
  })


  test('revokes one Collection member after recall, keeping the Collection and surviving members', async () => {
    await pg.exec(`
      INSERT INTO sr_bookmark(id,target_url) VALUES (21,'https://example.com/21'),(22,'https://example.com/22');
      INSERT INTO sr_user_bookmark(id,uuid,user_id,bookmark_id,is_starred,starred_at) VALUES
        (21,'member-21',3,21,true,'2026-05-03'),
        (22,'member-22',3,22,true,'2026-05-04');
      UPDATE sr_user_bookmark SET starred_at='2026-05-01' WHERE user_id=3 AND bookmark_id=10;
    `)
    const vectors = runtime()
    vi.mocked(vectors.queryCollections).mockResolvedValue([{ id: 30, score: 0.8 }])
    vi.mocked(vectors.readCollections).mockImplementation(async ids => {
      await pg.exec('INSERT INTO sr_bookmark_share VALUES (3,10,false) ON CONFLICT DO NOTHING')
      return new Map(ids.map(id => [id, [1, 0]]))
    })
    const result = await new ContentRecommendationService(db, vectors).collections(1)
    expect(result.items.map(item => item.id)).toEqual([30])
    expect(result.items[0].articles.map(article => article.id)).toEqual([22, 21])
  })


  test('treats a missing or zero Collection preference as explicit cold start without native queries', async () => {
    const zero = runtime()
    vi.mocked(zero.readUser).mockResolvedValue(new Array(1024).fill(0))
    expect(await new ContentRecommendationService(db, zero).collections(1)).toEqual({ items: [], preferenceKind: 'collection', reason: 'cold_start' })
    expect(zero.queryCollections).not.toHaveBeenCalled()
    const missing = runtime()
    vi.mocked(missing.readUser).mockResolvedValue(null)
    expect(await new ContentRecommendationService(db, missing).collections(1)).toEqual({ items: [], preferenceKind: 'collection', reason: 'cold_start' })
    expect(missing.queryCollections).not.toHaveBeenCalled()
  })
})
