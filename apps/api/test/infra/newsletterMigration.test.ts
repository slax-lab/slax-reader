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

describe('independent Newsletter migration', () => {
  test('keeps the populated RSS schema and writer behavior unchanged', async () => {
    const db = await rssDatabase()
    try {
      await db.exec("INSERT INTO sr_rss_feed(id,feed_url,title) VALUES ('rss','https://rss.test','Original')")
      const schema = () =>
        db.query(
          "SELECT table_name,column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_name LIKE 'sr_rss_%' ORDER BY table_name,ordinal_position"
        )
      const before = (await schema()).rows
      await db.exec(read('20261022090000_newsletter_feed'))
      expect((await schema()).rows).toEqual(before)
      expect((await db.query('SELECT title FROM sr_rss_feed')).rows).toEqual([{ title: 'Original' }])
      await db.exec(
        "UPDATE sr_rss_feed SET title='Updated' WHERE id='rss'; INSERT INTO sr_rss_feed(id,feed_url) VALUES ('new','https://new.test'); DELETE FROM sr_rss_feed WHERE id='new'"
      )
      expect((await db.query('SELECT id,title FROM sr_rss_feed')).rows).toEqual([{ id: 'rss', title: 'Updated' }])
      expect((await db.query("SELECT tgname FROM pg_trigger WHERE tgrelid='sr_rss_feed'::regclass AND NOT tgisinternal")).rows).toEqual([])
      expect((await db.query("SELECT to_regclass('sr_feed') AS source,to_regclass('sr_newsletter_receipt') AS receipt")).rows).toEqual([{ source: null, receipt: null }])
    } finally {
      await db.close()
    }
  })
  test('keeps binding columns and normal update/delete behavior while preventing duplicate mailboxes', async () => {
    const db = await rssDatabase()
    try {
      const columns = () =>
        db.query("SELECT column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_name='sr_platform_bind' ORDER BY ordinal_position")
      const before = (await columns()).rows
      await db.exec(read('20261022090000_newsletter_feed'))
      expect((await columns()).rows).toEqual(before)
      expect((await db.query("SELECT tgname FROM pg_trigger WHERE tgrelid='sr_platform_bind'::regclass AND NOT tgisinternal")).rows).toEqual([])
      await db.exec("INSERT INTO sr_platform_bind(user_id,platform,platform_id,user_name) VALUES(1,'newsletter','feed+reader@newsletterreader.slax.dev','reader')")
      await expect(db.exec("INSERT INTO sr_platform_bind(user_id,platform,platform_id) VALUES(2,'newsletter','feed+reader@newsletterreader.slax.dev')")).rejects.toThrow()
      await db.exec("UPDATE sr_platform_bind SET user_name='Updated' WHERE platform='newsletter'")
      expect((await db.query("SELECT user_name FROM sr_platform_bind WHERE platform='newsletter'")).rows).toEqual([{ user_name: 'Updated' }])
      await db.exec("DELETE FROM sr_platform_bind WHERE platform='newsletter'")
      expect((await db.query("SELECT * FROM sr_platform_bind WHERE platform='newsletter'")).rows).toEqual([])
    } finally {
      await db.close()
    }
  })
  test('one numeric mail row enforces dedupe and ready-body consistency', async () => {
    const db = await rssDatabase()
    try {
      await db.exec(read('20261022090000_newsletter_feed'))
      await db.exec("INSERT INTO sr_newsletter_feed(user_id,source_key,sender,message_key) VALUES (1,repeat('a',64),'sender@example.com',repeat('b',64))")
      const row = (await db.query<any>('SELECT id,state,content_key FROM sr_newsletter_feed')).rows[0]
      expect(BigInt(row.id)).toBeGreaterThan(0n)
      expect(row).toMatchObject({ state: 'pending', content_key: null })
      await expect(db.exec("INSERT INTO sr_newsletter_feed(user_id,source_key,sender,message_key) VALUES (1,repeat('a',64),'sender@example.com',repeat('b',64))")).rejects.toThrow()
      await expect(db.exec("UPDATE sr_newsletter_feed SET state='ready'")).rejects.toThrow()
      await db.exec("UPDATE sr_newsletter_feed SET state='ready',content_key='newsletter-content/body.html'")
      expect(
        (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='sr_newsletter_feed' ORDER BY ordinal_position")).rows.map((r: any) => r.column_name)
      ).toEqual([
        'id',
        'user_id',
        'source_key',
        'sender',
        'sender_name',
        'message_key',
        'state',
        'title',
        'summary',
        'content_key',
        'content_truncated',
        'published_at',
        'received_at'
      ])
    } finally {
      await db.close()
    }
  })
})
