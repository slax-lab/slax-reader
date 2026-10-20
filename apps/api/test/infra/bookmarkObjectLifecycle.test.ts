import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '@prisma/hyperdrive-client'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'
import { deletePrivateBookmarkBatch, retireBookmarkObjects, type StoredBookmarkObjects } from '@/infra/repository/bookmarkObjectLifecycle'

const forkMigration = readFileSync(new URL('../../prisma/pg_migrations/20261019000000_private_bookmark_fork/migration.sql', import.meta.url), 'utf8')
const lifecycleMigration = readFileSync(new URL('../../prisma/pg_migrations/20261020000000_bookmark_fork_lifecycle_indexes/migration.sql', import.meta.url), 'utf8')

type Connection = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; affectedRows: number }>
  transaction: (fn: (tx: Connection) => Promise<unknown>) => Promise<unknown>
}

/** Adapt Prisma tagged templates to PGlite's text/$1-values API without reimplementing production SQL. */
function adapter(connection: Connection): any {
  const query = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const statement = Prisma.sql(parts, ...values)
    return connection.query(statement.text, statement.values)
  }
  return {
    $queryRaw: async (...args: any[]) => (await query(args[0], ...args.slice(1))).rows,
    $executeRaw: async (...args: any[]) => (await query(args[0], ...args.slice(1))).affectedRows,
    $transaction: (fn: (tx: any) => Promise<unknown>) => connection.transaction(tx => fn(adapter(tx)))
  }
}

const db = new PGlite()
const forkRepo = new BookmarkForkRepo(() => adapter(db))

async function tx<T>(work: (connection: any) => Promise<T>) {
  return db.transaction(connection => work(adapter(connection))) as Promise<T>
}

async function rows<T = any>(sql: string, values: unknown[] = []) {
  return (await db.query<T>(sql, values)).rows
}

async function exec(sql: string, values: unknown[] = []) {
  return values.length ? db.query(sql, values) : db.exec(sql)
}

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE sr_bookmark (
      id SERIAL PRIMARY KEY,
      target_url TEXT NOT NULL DEFAULT '',
      private_user INTEGER NOT NULL DEFAULT 0,
      content_key TEXT NOT NULL DEFAULT '',
      content_md_key TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE sr_bookmark_import_relation (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL DEFAULT 0, bookmark_id INTEGER NOT NULL DEFAULT 0, import_id INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sr_bookmark_vector_shard (id SERIAL PRIMARY KEY, bookmark_id INTEGER NOT NULL UNIQUE, bucket_idx INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sr_youtube_article_ref (id SERIAL PRIMARY KEY, bookmark_id INTEGER NOT NULL DEFAULT 0);
  `)
  await db.exec(forkMigration)
  await db.exec(lifecycleMigration)
})

beforeEach(async () => {
  await db.exec(`TRUNCATE
    sr_bookmark_object_stage,
    sr_bookmark_fork,
    sr_bookmark_fork_operation,
    sr_bookmark_save_receipt,
    sr_bookmark_vector_shard,
    sr_bookmark_import_relation,
    sr_bookmark,
    sr_youtube_article_ref
    RESTART IDENTITY`)
})

afterAll(async () => {
  await db.close()
})

describe('bookmark object lifecycle against production SQL', () => {
  it('retires private legacy keys, preserves public keys, and protects current keys', async () => {
    await exec(`
      INSERT INTO sr_bookmark(id, private_user, content_key, content_md_key, published_version)
      VALUES
        (1, 7, 'new/body', 'new/text', 2),
        (2, 8, 'new/pdf', 'new/pdf-text', 4),
        (3, 0, 'public/body', 'public/text', 1),
        (4, 9, 'new/legacy', 'new/legacy-text', 2)
    `)
    await exec(`
      INSERT INTO sr_bookmark_object_stage(content_key, bookmark_id, write_version, keys, status, indexed_at, index_attempted_at)
      VALUES
        ('new/body', 1, 2, ARRAY['new/body', 'new/text'], 'published', NULL, NULL),
        ('old/body', 1, 1, ARRAY['old/body', 'old/text'], 'published', NULL, NOW()),
        ('public/old-body', 3, 1, ARRAY['public/old-body', 'public/old-text'], 'published', NULL, NOW())
    `)

    const privatePrevious: StoredBookmarkObjects = {
      id: 1,
      private_user: 7,
      write_version: 1,
      published_version: 1,
      content_key: 'old/body',
      content_md_key: 'old/text'
    }
    const pdfPrevious: StoredBookmarkObjects = {
      id: 2,
      private_user: 8,
      write_version: 3,
      published_version: 3,
      content_key: 'pdf/body/old.pdf',
      content_md_key: 'text/pdf/old.txt'
    }
    const publicPrevious: StoredBookmarkObjects = {
      id: 3,
      private_user: 0,
      write_version: 1,
      published_version: 1,
      content_key: 'public/body',
      content_md_key: 'public/text'
    }
    const legacyPrevious: StoredBookmarkObjects = {
      id: 4,
      private_user: 9,
      write_version: 1,
      published_version: 1,
      content_key: 'legacy/body',
      content_md_key: 'legacy/text'
    }

    await tx(connection => retireBookmarkObjects(connection, privatePrevious, { content_key: 'new/body', content_md_key: 'new/text' }))
    await tx(connection => retireBookmarkObjects(connection, pdfPrevious, { content_key: 'new/pdf', content_md_key: 'new/pdf-text' }))
    await tx(connection => retireBookmarkObjects(connection, publicPrevious, { content_key: 'new/public', content_md_key: 'new/public-text' }))
    await tx(connection => retireBookmarkObjects(connection, legacyPrevious, { content_key: 'new/legacy', content_md_key: 'new/legacy-text' }))

    const stages = await rows<{ content_key: string; bookmark_id: number; keys: string[]; status: string }>(
      `SELECT content_key,bookmark_id,keys,status FROM sr_bookmark_object_stage ORDER BY bookmark_id,content_key`
    )
    expect(stages).toEqual([
      { content_key: 'new/body', bookmark_id: 1, keys: ['new/body', 'new/text'], status: 'published' },
      { content_key: 'old/body', bookmark_id: 1, keys: ['old/body', 'old/text'], status: 'retired' },
      { content_key: 'pdf/body/old.pdf', bookmark_id: 2, keys: ['pdf/body/old.pdf', 'text/pdf/old.txt', 'pdf/meta/old.json'], status: 'retired' },
      { content_key: 'public/old-body', bookmark_id: 3, keys: ['public/old-body', 'public/old-text'], status: 'published' },
      { content_key: 'legacy/body', bookmark_id: 4, keys: ['legacy/body', 'legacy/text'], status: 'retired' }
    ])
  })

  it('deletes at most 100 private targets and leaves another user fork independent', async () => {
    await exec(`
      INSERT INTO sr_bookmark(id,target_url,private_user,content_key,content_md_key,published_version)
      SELECT g,'https://private.test/'||g,7,'body/'||g,'text/'||g,1 FROM generate_series(1,105) g;
      INSERT INTO sr_bookmark(id,target_url,private_user,content_key,content_md_key,published_version)
      VALUES (1001,'https://other.test/article',8,'body/other','text/other',1);
      INSERT INTO sr_bookmark_object_stage(content_key,bookmark_id,write_version,keys,status,indexed_at)
      SELECT 'body/'||g,g,1,ARRAY['body/'||g,'text/'||g],'published',NOW() FROM generate_series(1,105) g;
      INSERT INTO sr_bookmark_vector_shard(bookmark_id,bucket_idx)
      SELECT g, g % 3 FROM generate_series(1,105) g;
      INSERT INTO sr_youtube_article_ref(bookmark_id)
      SELECT g FROM generate_series(1,105) g;
      INSERT INTO sr_bookmark_object_stage(content_key,bookmark_id,write_version,keys,status,indexed_at)
      VALUES ('body/other',1001,1,ARRAY['body/other','text/other'],'published',NOW());
      INSERT INTO sr_bookmark_fork(target_bookmark_id,target_user_id,source_bookmark_id,source_user_id,source_uuid,write_version,status)
      SELECT g,7,g,7,'source-'||g,1,'current' FROM generate_series(1,105) g;
      INSERT INTO sr_bookmark_fork(target_bookmark_id,target_user_id,source_bookmark_id,source_user_id,source_uuid,write_version,status)
      VALUES (1001,8,1,7,'source-of-other-copy',1,'current');
      INSERT INTO sr_bookmark_save_receipt(user_id,operation_key,target_bookmark_id,target_uuid,write_version)
      SELECT 7,'receipt-'||g,g,'target-'||g,1 FROM generate_series(1,105) g;
      INSERT INTO sr_bookmark_fork_operation(user_id,idempotency_key,source_uuid,target_bookmark_id,target_uuid,write_version,write_mode)
      SELECT 7,'operation-'||g,'source-'||g,g,'target-'||g,1,'created' FROM generate_series(1,105) g;
      INSERT INTO sr_bookmark_import_relation(user_id,bookmark_id,import_id,status,write_version)
      SELECT 7,g,g,1,1 FROM generate_series(1,105) g;
    `)

    const deleted = await tx(connection => deletePrivateBookmarkBatch(connection, 7, 100))
    expect(deleted).toHaveLength(100)
    expect((await rows<{ count: number }>('SELECT count(*)::int AS count FROM sr_bookmark WHERE private_user=7'))[0].count).toBe(5)
    expect((await rows<{ count: number }>('SELECT count(*)::int AS count FROM sr_bookmark WHERE private_user=8'))[0].count).toBe(1)
    expect((await rows<{ count: number }>('SELECT count(*)::int AS count FROM sr_bookmark_fork WHERE target_bookmark_id=1001'))[0].count).toBe(1)
    expect((await rows<{ count: number }>('SELECT count(*)::int AS count FROM sr_bookmark_fork WHERE target_bookmark_id <= 100'))[0].count).toBe(0)
    expect((await rows<{ count: number }>('SELECT count(*)::int AS count FROM sr_bookmark_import_relation WHERE user_id=7'))[0].count).toBe(5)
    expect((await rows<{ count: number }>('SELECT count(*)::int AS count FROM sr_bookmark_vector_shard WHERE bookmark_id <= 100'))[0].count).toBe(100)
    expect((await rows<{ count: number }>('SELECT count(*)::int AS count FROM sr_youtube_article_ref WHERE bookmark_id <= 100'))[0].count).toBe(0)
    expect((await rows<{ count: number }>(`SELECT count(*)::int AS count FROM sr_bookmark_object_stage WHERE status='retired' AND bookmark_id <= 100`))[0].count).toBe(100)
    expect((await rows<{ count: number }>(`SELECT count(*)::int AS count FROM sr_bookmark_object_stage WHERE bookmark_id=1001 AND status='published'`))[0].count).toBe(1)
  })

  it('claims disjoint bounded cleanup batches sequentially on one connection', async () => {
    await exec(`
      INSERT INTO sr_bookmark_object_stage(content_key,bookmark_id,write_version,keys,status,cleanup_after)
      SELECT 'orphan/'||g,g,1,ARRAY['orphan/'||g],'deleted',NOW()-interval '2 hours' FROM generate_series(1,105) g;
      INSERT INTO sr_bookmark(id,private_user,content_key,content_md_key)
      VALUES (1001,7,'current/body','current/text');
      INSERT INTO sr_bookmark_object_stage(content_key,bookmark_id,write_version,keys,status,indexed_at,cleanup_after)
      VALUES ('blocked/unindexed',1001,1,ARRAY['blocked/unindexed'],'retired',NULL,NOW()-interval '2 hours');
      INSERT INTO sr_bookmark_object_stage(content_key,bookmark_id,write_version,keys,status,indexed_at,cleanup_after)
      VALUES ('eligible/retired',1001,1,ARRAY['eligible/retired'],'retired',NOW(),NOW()-interval '2 hours');
    `)

    // This uses one PGlite connection; it verifies the same SQL's disjoint claiming state, not true concurrent scheduling.
    const first = await forkRepo.claimStaleStages(100)
    const second = await forkRepo.claimStaleStages(100)
    const third = await forkRepo.claimStaleStages(100)
    expect(first).toHaveLength(100)
    expect(second).toHaveLength(6)
    expect(third).toEqual([])
    expect(new Set(first.map(row => row.id)).size).toBe(100)
    expect(new Set(second.map(row => row.id)).size).toBe(6)
    const secondIds = new Set(second.map(row => row.id))
    expect(first.filter(row => secondIds.has(row.id))).toHaveLength(0)
    expect(new Set(first.map(row => row.cleanup_token)).size).toBe(1)
    expect(new Set(second.map(row => row.cleanup_token)).size).toBe(1)
    expect((await rows<{ status: string }>(`SELECT status FROM sr_bookmark_object_stage WHERE content_key='blocked/unindexed'`))[0].status).toBe('retired')
  })

  it('does not delete a staged object still referenced by another bookmark', async () => {
    await exec(`
      INSERT INTO sr_bookmark(id,private_user,content_key,content_md_key)
      VALUES (3001,7,'shared/body','shared/text');
      INSERT INTO sr_bookmark_object_stage(content_key,bookmark_id,write_version,keys,status,cleanup_after)
      VALUES ('shared/body',3000,1,ARRAY['shared/body','shared/text'],'deleted',NOW()-interval '2 hours');
    `)

    const claimed = await forkRepo.claimStaleStages(10)
    expect(claimed).toHaveLength(1)
    expect(await forkRepo.getUnreferencedStageKeys(claimed[0].keys)).toEqual([])
  })

  it('keeps failed cleanups retryable, fences stale tokens, and purges tombstones after 24 hours', async () => {
    await exec(`
      INSERT INTO sr_bookmark_object_stage(content_key,bookmark_id,write_version,keys,status,cleanup_after)
      VALUES ('retry/me',2000,1,ARRAY['retry/me'],'deleted',NOW()-interval '2 hours');
    `)
    const first = (await forkRepo.claimStaleStages(1))[0]
    expect(first).toBeTruthy()
    const originalToken = first.cleanup_token

    await forkRepo.completeStageCleanup(first.id, 'wrong-token', 'deleted')
    expect((await rows<{ status: string; cleanup_token: string }>('SELECT status,cleanup_token FROM sr_bookmark_object_stage WHERE id=$1', [first.id]))[0]).toEqual({
      status: 'cleaning',
      cleanup_token: originalToken
    })

    await forkRepo.completeStageCleanup(first.id, originalToken, 'cleaning')
    expect((await rows<{ status: string; cleanup_token: string }>('SELECT status,cleanup_token FROM sr_bookmark_object_stage WHERE id=$1', [first.id]))[0]).toEqual({
      status: 'cleaning',
      cleanup_token: null
    })

    await exec(`UPDATE sr_bookmark_object_stage SET cleanup_after=NOW()-interval '2 hours' WHERE id=$1`, [first.id])
    const retried = (await forkRepo.claimStaleStages(1))[0]
    expect(retried.id).toBe(first.id)

    await forkRepo.completeStageCleanup(first.id, originalToken, 'deleted')
    expect((await rows<{ status: string; cleanup_token: string }>('SELECT status,cleanup_token FROM sr_bookmark_object_stage WHERE id=$1', [first.id]))[0].status).toBe('cleaning')
    await forkRepo.completeStageCleanup(first.id, retried.cleanup_token, 'deleted')
    expect(
      (await rows<{ status: string; cleanup_completed_at: Date | null }>('SELECT status,cleanup_completed_at FROM sr_bookmark_object_stage WHERE id=$1', [first.id]))[0].status
    ).toBe('deleted')

    await exec(`UPDATE sr_bookmark_object_stage SET cleanup_after=NOW()-interval '2 hours', cleanup_completed_at=NOW()-interval '25 hours' WHERE id=$1`, [first.id])
    const purgeClaim = (await forkRepo.claimStaleStages(1))[0]
    await forkRepo.completeStageCleanup(first.id, purgeClaim.cleanup_token, 'deleted')
    expect(await rows('SELECT id FROM sr_bookmark_object_stage WHERE id=$1', [first.id])).toEqual([])
  })
})
