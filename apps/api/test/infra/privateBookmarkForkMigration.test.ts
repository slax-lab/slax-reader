import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('../../prisma/pg_migrations/20261019000000_private_bookmark_fork/migration.sql', import.meta.url), 'utf8')

describe('private bookmark Fork expansion migration', () => {
  it('preserves legacy rows and permits old writers to omit the new fields', async () => {
    const db = new PGlite()
    try {
      await db.exec(`
        CREATE TABLE sr_bookmark (id SERIAL PRIMARY KEY, target_url TEXT NOT NULL, private_user INTEGER NOT NULL DEFAULT 0, content_key TEXT NOT NULL DEFAULT '', UNIQUE(target_url, private_user));
        CREATE TABLE sr_bookmark_import_relation (id SERIAL PRIMARY KEY);
        CREATE TABLE sr_youtube_article_ref (id SERIAL PRIMARY KEY);
        INSERT INTO sr_bookmark (target_url, private_user, content_key) VALUES ('https://example.test/article', 0, 'historical-public');
        INSERT INTO sr_bookmark_import_relation DEFAULT VALUES;
        INSERT INTO sr_youtube_article_ref DEFAULT VALUES;
      `)
      await db.exec(migration)
      await db.exec(`
        INSERT INTO sr_bookmark (target_url, private_user, content_key) VALUES ('https://example.test/article', 7, 'private-copy');
        INSERT INTO sr_bookmark_import_relation DEFAULT VALUES;
        INSERT INTO sr_youtube_article_ref DEFAULT VALUES;
      `)
      expect((await db.query('SELECT private_user, content_key, write_version, published_version FROM sr_bookmark ORDER BY id')).rows).toEqual([
        { private_user: 0, content_key: 'historical-public', write_version: 0, published_version: 0 },
        { private_user: 7, content_key: 'private-copy', write_version: 0, published_version: 0 }
      ])
      expect((await db.query('SELECT write_version, created_target FROM sr_bookmark_import_relation')).rows).toEqual([
        { write_version: null, created_target: null }, { write_version: null, created_target: null }
      ])
      expect((await db.query('SELECT capture_version FROM sr_youtube_article_ref')).rows).toEqual([{ capture_version: 0 }, { capture_version: 0 }])

      const lineage = `INSERT INTO sr_bookmark_fork (target_bookmark_id, current_target_id, target_user_id, source_bookmark_id, source_user_id, source_uuid, write_version) VALUES (2, 2, 7, 1, 8, 'source', 1)`
      await db.exec(lineage)
      await expect(db.exec(lineage)).rejects.toThrow(/unique/i)
      await db.exec(`UPDATE sr_bookmark_fork SET status='superseded', current_target_id=NULL`)
      await db.exec(lineage)
      expect((await db.query('SELECT count(*)::integer AS count FROM sr_bookmark_fork')).rows).toEqual([{ count: 2 }])

      const operation = `INSERT INTO sr_bookmark_fork_operation (user_id, idempotency_key, source_uuid, target_bookmark_id, target_uuid, write_version, write_mode) VALUES (7, 'request', 'source', 2, 'target', 1, 'created')`
      await db.exec(operation)
      await expect(db.exec(operation)).rejects.toThrow(/unique/i)
      await db.exec(`INSERT INTO sr_bookmark_object_stage (content_key, bookmark_id, write_version, keys) VALUES ('revision', 2, 1, ARRAY['revision','text'])`)
      expect((await db.query('SELECT status, keys FROM sr_bookmark_object_stage')).rows).toEqual([{ status: 'staged', keys: ['revision', 'text'] }])
    } finally {
      await db.close()
    }
  })
})
