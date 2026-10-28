import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, test } from 'vitest'

const read = (name: string) => readFileSync(new URL(`../../prisma/pg_migrations/${name}/migration.sql`, import.meta.url), 'utf8')
async function rssDatabase() {
  const db = new PGlite()
  const initial = read('20250911063331_init_database')
  await db.exec(initial.match(/CREATE TABLE "public"\."sr_platform_bind" \([\s\S]*?\n\);/)![0])
  for (const sql of initial.matchAll(/CREATE (?:UNIQUE )?INDEX[^;]*ON "public"\."sr_platform_bind"[^;]*;/g)) await db.exec(sql[0])
  for (const name of ['20260923042657_reset_rss_labs_shared_feed', '20260923065020', '20261019090000_rss_local_first']) await db.exec(read(name))
  return db
}

describe('first Newsletter release migration', () => {
  test('creates only platform-owned receiving identities and numeric receipt IDs', async () => {
    const db = await rssDatabase()
    try {
      await db.exec(read('20261022090000_newsletter_feed'))
      expect((await db.query("SELECT to_regclass('sr_newsletter_address') AS name")).rows).toEqual([{ name: null }])
      await db.exec(
        "INSERT INTO sr_platform_bind(user_id,platform,platform_id,user_name) VALUES (1,'newsletter','feed+reader@newsletterreader.slax.dev','feed+reader@newsletterreader.slax.dev')"
      )
      const binding = (await db.query<{ id: number }>("SELECT id FROM sr_platform_bind WHERE platform='newsletter'")).rows[0]
      await db.query("INSERT INTO sr_newsletter_receipt(user_id,binding_id,source_key,message_key,payload_key) VALUES (1,$1,'sender','mail','newsletter-staged/payload')", [
        binding.id
      ])
      const row = (await db.query<{ id: number }>('SELECT id FROM sr_newsletter_receipt')).rows[0]
      expect(Number(row.id)).toBeGreaterThan(0)
      const columns = (await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name='sr_newsletter_receipt'")).rows.map(
        r => r.column_name
      )
      expect(columns).not.toContain('address_id')
      expect(columns).not.toContain('legacy_id')
      expect(columns).not.toContain('receipt_id')
      expect(columns).not.toContain('raw_key')
      await expect(
        db.query("INSERT INTO sr_newsletter_receipt(user_id,binding_id,source_key,message_key,payload_key) VALUES (2,$1,'sender','foreign','payload')", [binding.id])
      ).rejects.toThrow()
      await expect(
        db.exec(
          "INSERT INTO sr_platform_bind(user_id,platform,platform_id,user_name) VALUES (2,'newsletter','feed+reader@newsletterreader.slax.dev','feed+reader@newsletterreader.slax.dev')"
        )
      ).rejects.toThrow()
      await db.exec("INSERT INTO sr_platform_bind(user_id,platform) VALUES (1,'telegram'); DELETE FROM sr_platform_bind WHERE user_id=1")
      expect((await db.query('SELECT platform,retired_at FROM sr_platform_bind')).rows).toEqual([{ platform: 'newsletter', retired_at: expect.any(Date) }])
      await expect(db.exec("UPDATE sr_platform_bind SET platform_id='reassigned' WHERE platform='newsletter'")).rejects.toThrow()
      await expect(db.exec("UPDATE sr_platform_bind SET retired_at=NULL WHERE platform='newsletter'")).rejects.toThrow()
    } finally {
      await db.close()
    }
  })
  test('backfills existing RSS IDs and mirrors every refreshed field and deletion', async () => {
    const db = await rssDatabase()
    try {
      await db.exec(
        "INSERT INTO sr_rss_feed(id,feed_url,lease_token,history_seen) VALUES ('rss','https://rss.test','lease',ARRAY['old']),('delete','https://delete.test',NULL,ARRAY[]::text[])"
      )
      await db.exec(read('20261022090000_newsletter_feed'))
      expect((await db.query('SELECT * FROM sr_feed ORDER BY id')).rows).toEqual((await db.query('SELECT * FROM sr_rss_feed ORDER BY id')).rows)
      await db.exec(
        "UPDATE sr_rss_feed SET title='fresh',site_url='https://site',etag='etag',last_modified='modified',last_checked_at=now(),last_success_at=now(),next_fetch_at=now(),next_allowed_at=now(),error='retry',failure_count=3,lease_token='new',lease_until=now(),history_url='history',history_seen=ARRAY['a','b'],history_checked_at=now(),history_retry_at=now(),icon_url='icon'"
      )
      expect((await db.query('SELECT * FROM sr_feed ORDER BY id')).rows).toEqual((await db.query('SELECT * FROM sr_rss_feed ORDER BY id')).rows)
      await db.exec("DELETE FROM sr_rss_feed WHERE id='delete'; INSERT INTO sr_rss_feed(id,feed_url) VALUES ('late','https://late')")
      expect((await db.query('SELECT id FROM sr_feed ORDER BY id')).rows).toEqual([{ id: 'late' }, { id: 'rss' }])
      await expect(db.exec("INSERT INTO sr_feed(feed_url,kind) VALUES ('invalid','other')")).rejects.toThrow()
    } finally {
      await db.close()
    }
  })
})
