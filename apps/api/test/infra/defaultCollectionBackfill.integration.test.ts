import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { enumeratePage } from '../../script/vector-refresh'

const migration = readFileSync(new URL('../../prisma/pg_migrations/20261111000000_default_public_starred_collections/migration.sql', import.meta.url), 'utf8')
const migrationBody = migration.replace(/^(?:BEGIN|COMMIT);$/gm, '')
const describePg = process.env.RUN_PG_INTEGRATION_TESTS === '1' ? describe : describe.skip

describePg('Default starred collection backfill', () => {
  let client: pg.Client

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.HYPERDRIVE_DATABASE_URL })
    await client.connect()
  })

  afterAll(async () => {
    await client?.end()
  })

  test('inserts only missing active-user collections with stable defaults and initialized stats', async () => {
    await client.query('BEGIN')

    try {
      const token = randomUUID()
      const users = await client.query<{ id: number }>(
        `INSERT INTO sr_user (email, name, lang, deleted_at, last_login_at, created_at)
         VALUES
           ($1, ' Existing Reader ', 'en', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
           ($2, '', 'zh-CN', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
           ($3, 'Closed Curator', 'en', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
           ($4, 'Deleted Reader', 'en', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`,
        [`english-${token}@example.test`, `chinese-${token}@example.test`, `closed-${token}@example.test`, `deleted-${token}@example.test`]
      )
      const [englishId, chineseId, closedId, deletedId] = users.rows.map(row => row.id)

      const articles = await client.query<{ id: number }>(
        `INSERT INTO sr_bookmark (title, target_url, private_user, created_at, updated_at, published_at)
         SELECT 'Backfill ' || value, $1 || value, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         FROM generate_series(1, 2) AS value
         RETURNING id`,
        [`https://backfill-${token}.example/`, englishId]
      )
      await client.query(
        `INSERT INTO sr_user_bookmark (user_id, bookmark_id, is_starred, updated_at)
         SELECT $1, id, true, CURRENT_TIMESTAMP FROM unnest($2::integer[]) AS id`,
        [englishId, articles.rows.map(row => row.id)]
      )

      await client.query(
        `INSERT INTO sr_user_collection (owner_id, display_name, description, collection_code, status, updated_at)
         VALUES ($1, 'Curator choice', 'Keep private', $2, 0, CURRENT_TIMESTAMP)`,
        [closedId, `closed-${token}`]
      )
      const cutoffResult = await client.query<{ cutoff: number }>('SELECT COALESCE(MAX(id), 0)::int AS cutoff FROM sr_user_collection')
      const cutoff = cutoffResult.rows[0]!.cutoff

      await client.query(migrationBody)

      const english = await client.query(
        `SELECT c.display_name, c.collection_code, c.status, c.show_marks, c.allow_marks, c.show_profile,
                stats.starred_count, stats.subscriber_count
         FROM sr_user_collection c JOIN sr_user_collection_stats stats ON stats.collection_id = c.id
         WHERE c.owner_id = $1`,
        [englishId]
      )
      expect(english.rows).toEqual([
        {
          display_name: 'Existing Reader\'s Reading Recommendations',
          collection_code: expect.stringMatching(/^[a-f0-9]{32}$/),
          status: 1,
          show_marks: true,
          allow_marks: true,
          show_profile: true,
          starred_count: 2,
          subscriber_count: 0
        }
      ])

      const chinese = await client.query('SELECT display_name, collection_code FROM sr_user_collection WHERE owner_id = $1', [chineseId])
      expect(chinese.rows[0]).toEqual({ display_name: '我的阅读推荐', collection_code: expect.stringMatching(/^[a-f0-9]{32}$/) })
      expect(chinese.rows[0]!.collection_code).not.toBe(english.rows[0]!.collection_code)

      const closed = await client.query('SELECT display_name, description, collection_code, status FROM sr_user_collection WHERE owner_id = $1', [closedId])
      expect(closed.rows).toEqual([{ display_name: 'Curator choice', description: 'Keep private', collection_code: `closed-${token}`, status: 0 }])
      expect((await client.query('SELECT COUNT(*)::int AS count FROM sr_user_collection WHERE owner_id = $1', [deletedId])).rows[0]!.count).toBe(0)

      const countBeforeRetry = (await client.query('SELECT COUNT(*)::int AS count FROM sr_user_collection')).rows[0]!.count
      await client.query(migrationBody)
      expect((await client.query('SELECT COUNT(*)::int AS count FROM sr_user_collection')).rows[0]!.count).toBe(countBeforeRetry)
      expect((await client.query('SELECT collection_code FROM sr_user_collection WHERE owner_id = $1', [englishId])).rows[0]!.collection_code).toBe(english.rows[0]!.collection_code)

      const refresh = await enumeratePage(client, 'collection', cutoff, { afterId: cutoff, batch: 50, dryRun: true })
      expect(refresh.rows.map(row => row.cursor)).toEqual([
        (await client.query('SELECT id FROM sr_user_collection WHERE owner_id = $1', [englishId])).rows[0]!.id,
        (await client.query('SELECT id FROM sr_user_collection WHERE owner_id = $1', [chineseId])).rows[0]!.id
      ])
    } finally {
      await client.query('ROLLBACK')
    }
  })
})
