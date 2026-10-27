import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, test } from 'vitest'

const read = (name: string) => readFileSync(new URL(`../../prisma/pg_migrations/${name}/migration.sql`, import.meta.url), 'utf8')
const revision = read('20261027100000_newsletter_review_revision')
async function oldDatabase() {
  const db = new PGlite()
  // Execute the actual original platform binding DDL and indexes.
  const initial = read('20250911063331_init_database')
  await db.exec(initial.match(/CREATE TABLE "public"\."sr_platform_bind" \([\s\S]*?\n\);/)![0])
  for (const sql of initial.matchAll(/CREATE (?:UNIQUE )?INDEX[^;]*ON "public"\."sr_platform_bind"[^;]*;/g)) await db.exec(sql[0])
  await db.exec(read('20260923042657_reset_rss_labs_shared_feed'))
  await db.exec(read('20260923065020'))
  await db.exec(read('20261019090000_rss_local_first'))
  await db.exec(read('20261022090000_newsletter_feed'))
  return db
}
async function address(db: PGlite, id = 'address', user = 1, domain = 'mail.test') {
  await db.query(`INSERT INTO sr_newsletter_address(id,user_id,domain,local_part) VALUES ($1,$2,$3,'reader')`, [id, user, domain])
}

describe('Newsletter expand migration against old PostgreSQL schema', () => {
  test('clones every feed field and keeps both old feed kinds authoritative', async () => {
    const db = await oldDatabase()
    try {
      await db.exec(
        `INSERT INTO sr_rss_feed(id,feed_url,kind,lease_token,history_seen) VALUES ('rss','https://rss.test','rss','old',ARRAY['first']),('mail','newsletter://mail','newsletter',NULL,ARRAY[]::text[])`
      )
      await expect(db.exec(`SELECT * FROM sr_feed`)).rejects.toThrow('does not exist')
      await db.exec(revision)
      expect((await db.query(`SELECT * FROM sr_feed ORDER BY id`)).rows).toEqual((await db.query(`SELECT * FROM sr_rss_feed ORDER BY id`)).rows)
      await db.exec(
        `UPDATE sr_rss_feed SET title='fresh', site_url='https://site', etag='etag', last_modified='modified', last_checked_at=now(), last_success_at=now(), next_fetch_at=now(), next_allowed_at=now(), error='retry', failure_count=3, lease_token='new', lease_until=now(), history_url='history', history_seen=ARRAY['a','b'], history_checked_at=now(), history_retry_at=now(), icon_url='icon'`
      )
      expect((await db.query(`SELECT * FROM sr_feed ORDER BY id`)).rows).toEqual((await db.query(`SELECT * FROM sr_rss_feed ORDER BY id`)).rows)
      await db.exec(`DELETE FROM sr_rss_feed WHERE id='rss'; INSERT INTO sr_rss_feed(id,feed_url) VALUES ('late','https://late')`)
      expect((await db.query(`SELECT id FROM sr_feed ORDER BY id`)).rows).toEqual([{ id: 'late' }, { id: 'mail' }])
      await expect(db.exec(`INSERT INTO sr_feed(feed_url,kind) VALUES ('invalid','other')`)).rejects.toThrow()
    } finally {
      await db.close()
    }
  })

  test('preserves UUID receipt queries and maps overlapping old writers to stable bindings', async () => {
    const db = await oldDatabase()
    try {
      await address(db)
      await db.exec(
        `INSERT INTO sr_newsletter_receipt(id,user_id,address_id,source_key,message_key,raw_key,attempts,lease_token) VALUES ('legacy',1,'address','source','message','raw',4,'lease')`
      )
      await db.exec(`UPDATE sr_newsletter_address SET created_at='2025-01-02', retired_at='2026-01-02' WHERE id='address'`)
      await db.exec(revision)
      const binding = (await db.query<{ id: number }>(`SELECT * FROM sr_platform_bind WHERE uuid='address'`)).rows[0]
      const receipt = (await db.query<any>(`SELECT * FROM sr_newsletter_receipt WHERE id='legacy'`)).rows[0]
      expect((await db.query<any>(`SELECT created_at,retired_at FROM sr_platform_bind WHERE uuid='address'`)).rows).toEqual(
        (await db.query<any>(`SELECT created_at,retired_at FROM sr_newsletter_address WHERE id='address'`)).rows
      )
      expect(receipt).toMatchObject({ id: 'legacy', binding_id: binding.id, attempts: 4, lease_token: 'lease' })
      expect(Number(receipt.receipt_id)).toBeGreaterThan(0)
      await db.exec(`INSERT INTO sr_newsletter_receipt(user_id,address_id,source_key,message_key,raw_key) VALUES (1,'address','source','old-worker','raw')`)
      expect((await db.query<any>(`SELECT binding_id FROM sr_newsletter_receipt WHERE message_key='old-worker'`)).rows[0].binding_id).toBe(binding.id)
      await db.query(`INSERT INTO sr_newsletter_receipt(user_id,binding_id,source_key,message_key,raw_key) VALUES (1,$1,'source','new-worker','newsletter-staged/payload')`, [
        binding.id
      ])
      await expect(
        db.query(`INSERT INTO sr_newsletter_receipt(user_id,binding_id,source_key,message_key,raw_key) VALUES (2,$1,'source','wrong-owner','raw')`, [binding.id])
      ).rejects.toThrow()
      await db.exec(`INSERT INTO sr_platform_bind(user_id,platform) VALUES (1,'telegram'); DELETE FROM sr_platform_bind WHERE user_id=1`)
      expect((await db.query(`SELECT id FROM sr_platform_bind WHERE platform='telegram'`)).rows).toEqual([])
      expect((await db.query<any>(`SELECT * FROM sr_platform_bind WHERE uuid='address'`)).rows[0]).toMatchObject({
        platform_id: 'feed+reader@mail.test',
        user_name: 'feed+reader@mail.test'
      })
      expect((await db.query<any>(`SELECT retired_at FROM sr_platform_bind WHERE uuid='address'`)).rows[0].retired_at).not.toBeNull()
      await expect(db.exec(`UPDATE sr_platform_bind SET platform='other' WHERE uuid='address'`)).rejects.toThrow()
      await expect(db.exec(`UPDATE sr_platform_bind SET platform_id='feed+changed@mail.test' WHERE uuid='address'`)).rejects.toThrow()
      await expect(db.exec(`UPDATE sr_platform_bind SET retired_at=NULL WHERE uuid='address'`)).rejects.toThrow()
      await expect(db.exec(`INSERT INTO sr_platform_bind(user_id,platform,platform_id) VALUES (9,'newsletter','feed+reader@mail.test')`)).rejects.toThrow()
      await expect(address(db, 'stolen', 2)).rejects.toThrow()
      await address(db, 'new-address', 3, 'other.test')
      expect((await db.query<any>(`SELECT uuid FROM sr_platform_bind WHERE user_id=3`)).rows).toEqual([{ uuid: 'new-address' }])
      await db.exec(`DELETE FROM sr_newsletter_address WHERE id='new-address'`)
      expect((await db.query<any>(`SELECT retired_at FROM sr_newsletter_address WHERE id='new-address'`)).rows[0].retired_at).not.toBeNull()
    } finally {
      await db.close()
    }
  })

  test.each(['multiple', 'ownership', 'receipt'])('aborts atomically on %s conflicts', async conflict => {
    const db = await oldDatabase()
    try {
      await address(db)
      if (conflict === 'multiple') await address(db, 'second', 1, 'other.test')
      if (conflict === 'ownership') await db.exec(`INSERT INTO sr_platform_bind(user_id,platform,platform_id) VALUES (2,'newsletter','feed+reader@mail.test')`)
      if (conflict === 'receipt')
        await db.exec(`INSERT INTO sr_newsletter_receipt(user_id,address_id,source_key,message_key,raw_key) VALUES (2,'address','source','message','raw')`)
      await expect(db.exec(revision)).rejects.toThrow()
      await db.exec('ROLLBACK')
      expect((await db.query(`SELECT to_regclass('sr_feed') AS name`)).rows).toEqual([{ name: null }])
    } finally {
      await db.close()
    }
  })
})

describe('Newsletter overlapping worker projection', () => {
  test('projects new bindings, old address writes, retirement and receipt joins in both directions', async () => {
    const db = await oldDatabase()
    try {
      await db.exec(revision)
      await db.exec(read('20261027141709_newsletter_review_revision_check'))
      // A binding created between rollout migrations also requires backfill.
      await db.exec(
        `INSERT INTO sr_platform_bind(uuid,user_id,platform,platform_id,user_name) VALUES ('between',10,'newsletter','feed+between@mail.test','feed+between@mail.test')`
      )
      await db.exec(read('20261027150000_newsletter_overlap_projection'))
      expect((await db.query(`SELECT id FROM sr_newsletter_address WHERE user_id=10`)).rows).toEqual([{ id: 'between' }])
      await db.exec(`INSERT INTO sr_platform_bind(uuid,user_id,platform,platform_id,user_name) VALUES ('new-binding',11,'newsletter','feed+new@mail.test','feed+new@mail.test')`)
      // This is the registry predicate used by the overlapping old recipient path.
      expect((await db.query(`SELECT id,user_id FROM sr_newsletter_address WHERE local_part='new' AND domain='mail.test' AND retired_at IS NULL`)).rows).toEqual([
        { id: 'new-binding', user_id: 11 }
      ])
      const binding = (await db.query<{ id: number }>(`SELECT id FROM sr_platform_bind WHERE uuid='new-binding'`)).rows[0]
      await db.query(`INSERT INTO sr_newsletter_receipt(user_id,binding_id,source_key,message_key,raw_key) VALUES (11,$1,'source','new-worker','newsletter-staged/cleaned-mime')`, [
        binding.id
      ])
      expect(
        (await db.query(`SELECT r.address_id,a.user_id FROM sr_newsletter_receipt r JOIN sr_newsletter_address a ON a.id=r.address_id WHERE r.message_key='new-worker'`)).rows
      ).toEqual([{ address_id: 'new-binding', user_id: 11 }])
      await db.exec(`UPDATE sr_platform_bind SET retired_at='2026-10-27' WHERE uuid='new-binding'`)
      await db.exec(`DELETE FROM sr_platform_bind WHERE uuid='between'`)
      expect((await db.query<any>(`SELECT retired_at FROM sr_newsletter_address WHERE id='between'`)).rows[0].retired_at).not.toBeNull()
      expect((await db.query(`SELECT uuid FROM sr_platform_bind WHERE uuid='between'`)).rows).toEqual([{ uuid: 'between' }])
      expect((await db.query<any>(`SELECT retired_at FROM sr_newsletter_address WHERE id='new-binding'`)).rows[0].retired_at).not.toBeNull()
      await address(db, 'old-binding', 12, 'old.test')
      expect((await db.query(`SELECT uuid FROM sr_platform_bind WHERE user_id=12`)).rows).toEqual([{ uuid: 'old-binding' }])
      await db.exec(`DELETE FROM sr_newsletter_address WHERE id='old-binding'`)
      expect((await db.query<any>(`SELECT retired_at FROM sr_platform_bind WHERE uuid='old-binding'`)).rows[0].retired_at).not.toBeNull()
      await db.exec(`INSERT INTO sr_newsletter_receipt(user_id,address_id,source_key,message_key,raw_key) VALUES (12,'old-binding','source','old-worker','legacy')`)
      expect((await db.query<any>(`SELECT binding_id FROM sr_newsletter_receipt WHERE message_key='old-worker'`)).rows[0].binding_id).toBeGreaterThan(0)
    } finally {
      await db.close()
    }
  })
})
