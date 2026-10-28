import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { LabRepo } from '@/infra/repository/dbLab'
import { NewsletterRepo } from '@/infra/repository/dbNewsletter'

export let db: PGlite
export let repo: NewsletterRepo
export const adapter = (db: any): any => {
  const query = async (parts: TemplateStringsArray, ...values: unknown[]) =>
    (
      await db.query(
        parts.reduce((sql, s, i) => sql + (i ? '$' + i : '') + s, ''),
        values
      )
    ).rows
  return {
    sr_user_lab_feature: {
      upsert: async ({ create }: any) =>
        (
          await db.query(
            'INSERT INTO sr_user_lab_feature(user_id,feature,enabled) VALUES($1,$2,$3) ON CONFLICT(user_id,feature) DO UPDATE SET enabled=EXCLUDED.enabled RETURNING *',
            [create.user_id, create.feature, create.enabled]
          )
        ).rows[0]
    },
    sr_user: {
      update: ({ where, data }: any) => db.query('UPDATE sr_user SET deleted_at=$1 WHERE id=$2', [data.deleted_at, where.id])
    },
    sr_user_api_key: { deleteMany: async () => ({ count: 0 }) },
    $queryRaw: query,
    $executeRaw: query,
    $transaction: (fn: any) => db.transaction((tx: any) => fn(adapter(tx)))
  }
}
beforeAll(async () => {
  db = new PGlite({
    parsers: { 1114: x => new Date(x.replace(' ', 'T') + 'Z') }
  })
  await db.exec(`CREATE TABLE sr_user(id INT PRIMARY KEY, uuid TEXT DEFAULT gen_random_uuid()::text, account TEXT DEFAULT '', deleted_at TIMESTAMP);
    CREATE TABLE sr_user_lab_feature(user_id INT,feature TEXT,enabled BOOLEAN,UNIQUE(user_id,feature));
    CREATE TABLE sr_platform_bind(id SERIAL PRIMARY KEY,uuid TEXT UNIQUE DEFAULT gen_random_uuid()::text,user_id INT,platform TEXT,platform_id TEXT,user_name TEXT,created_at TIMESTAMP DEFAULT now(),UNIQUE(user_id,platform));`)
  for (const path of [
    '20260923042657_reset_rss_labs_shared_feed',
    '20260923044137_add_rss_timeline_index',
    '20260923065020',
    '20261019090000_rss_local_first',
    '20261028142946_newsletter_feed'
  ])
    await db.exec(await readFile(new URL('../../../prisma/pg_migrations/' + path + '/migration.sql', import.meta.url), 'utf8'))
  repo = new NewsletterRepo(() => adapter(db))
})
beforeEach(async () => {
  await db.exec(`TRUNCATE sr_user,sr_user_lab_feature,sr_platform_bind,sr_newsletter_feed,sr_rss_entry,sr_rss_feed,sr_rss_subscription;
    INSERT INTO sr_user(id,account) VALUES(1,'Jane.Doe'),(2,'other');
    INSERT INTO sr_user_lab_feature VALUES(1,'newsletter',true),(2,'newsletter',true);`)
})
afterAll(async () => {
  await db?.close()
})
export const recipient = async () => {
  await repo.address(1, 'newsletterreader.slax.dev', true)
  return (await repo.recipient('newsletterreader.slax.dev', 'jane.doe'))!
}
