import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import type { PrismaClient } from '@prisma/hyperdrive-client'
import { BookmarkRepo, type bookmarkShardPO } from '@/infra/repository/dbBookmark'

let db: PGlite
let repo: BookmarkRepo

// Execute the production tagged SQL against PostgreSQL constraints, without mocking upsert.
const query = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
  const sql = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '')
  return (await db.query<bookmarkShardPO>(sql, values)).rows
})

beforeAll(async () => {
  db = new PGlite({
    parsers: { 1114: value => new Date(value.replace(' ', 'T') + 'Z') },
    serializers: { 1114: value => (value instanceof Date ? value.toISOString().replace('T', ' ').replace('Z', '') : String(value)) }
  })
  const migration = await readFile(new URL('../../prisma/pg_migrations/20250911063331_init_database/migration.sql', import.meta.url), 'utf8')
  const table = migration.match(/CREATE TABLE "public"\."sr_bookmark_vector_shard" \([\s\S]*?\n\);/)
  const index = migration.match(/CREATE UNIQUE INDEX "sr_bookmark_vector_shard_bookmark_id_key"[^;]+;/)
  if (!table || !index) throw new Error('Vector shard table or unique index missing from migration')
  await db.exec(`${table[0]}\n${index[0]}`)
  repo = new BookmarkRepo(
    () => {
      throw new Error('Vector shard allocation must not access D1')
    },
    () => ({ $queryRaw: query }) as unknown as PrismaClient
  )
}, 30_000)

beforeEach(async () => {
  query.mockClear()
  await db.exec('TRUNCATE public.sr_bookmark_vector_shard RESTART IDENTITY')
})

afterAll(async () => {
  await db?.close()
})

describe('bookmark vector shard mapping', () => {
  test('creates and returns the requested mapping in one database call', async () => {
    const shard = await repo.upsertVectorShard(276747, 3)

    expect(shard).toEqual({ id: 1, bookmark_id: 276747, bucket_idx: 3, created_at: expect.any(Date) })
    expect(query).toHaveBeenCalledOnce()
    expect((await db.query('SELECT * FROM public.sr_bookmark_vector_shard')).rows).toEqual([shard])
  })

  test('refreshes an existing mapping without moving its bucket or changing its identity', async () => {
    const oldTimestamp = new Date('2000-01-01T00:00:00.000Z')
    await db.query('INSERT INTO public.sr_bookmark_vector_shard (id, bookmark_id, bucket_idx, created_at) VALUES ($1, $2, $3, $4)', [42, 276747, 1, oldTimestamp])

    const shard = await repo.upsertVectorShard(276747, 4)

    expect(shard).toMatchObject({ id: 42, bookmark_id: 276747, bucket_idx: 1 })
    expect(shard.created_at.getTime()).toBeGreaterThan(oldTimestamp.getTime())
    expect(query).toHaveBeenCalledOnce()
    expect((await db.query('SELECT * FROM public.sr_bookmark_vector_shard')).rows).toEqual([shard])
  })

  test('returns one persisted mapping for overlapping requests proposing different buckets', async () => {
    // PGlite serializes queries; separate-connection concurrency is validated with native PostgreSQL.
    const shards = await Promise.all(Array.from({ length: 20 }, (_, index) => repo.upsertVectorShard(276747, index % 5)))
    const [stored] = (await db.query<bookmarkShardPO>('SELECT * FROM public.sr_bookmark_vector_shard')).rows

    expect(stored).toBeDefined()
    for (const shard of shards) {
      expect(shard).toMatchObject({ id: stored.id, bookmark_id: 276747, bucket_idx: stored.bucket_idx })
    }
    expect((await db.query('SELECT * FROM public.sr_bookmark_vector_shard')).rows).toHaveLength(1)
  })

  test('propagates database errors to the indexing caller', async () => {
    const error = new Error('Database connection unavailable')
    query.mockRejectedValueOnce(error)

    await expect(repo.upsertVectorShard(276747, 2)).rejects.toBe(error)
  })
})
