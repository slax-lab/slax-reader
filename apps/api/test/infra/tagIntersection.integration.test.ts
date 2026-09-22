/**
 * Real Postgres: the tag trigger keeps metadata.tags in step with soft deletes, and the
 * containment / untagged / candidate-count queries return what the list routes rely on.
 * Runs only with RUN_PG_INTEGRATION_TESTS=1 against HYPERDRIVE_DATABASE_URL after migrations.
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const describePg = process.env.RUN_PG_INTEGRATION_TESTS === '1' ? describe : describe.skip

describePg('Tag intersection queries', () => {
  let client: pg.Client

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.HYPERDRIVE_DATABASE_URL })
    await client.connect()
  })

  afterAll(async () => {
    await client?.end()
  })

  test('containment, untagged and candidate counts agree with the link table', async () => {
    await client.query('BEGIN')
    try {
      const token = randomUUID()
      const { rows: [{ id: userId }] } = await client.query<{ id: number }>(
        `INSERT INTO sr_user (email, last_login_at, created_at) VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
        [`tag-${token}@example.test`]
      )

      const tagIds: number[] = []
      const tagUuids: string[] = []
      for (const name of ['a', 'b', 'c']) {
        const { rows: [t] } = await client.query<{ id: number; uuid: string }>(
          `INSERT INTO sr_user_tag (user_id, tag_name) VALUES ($1, $2) RETURNING id, uuid`,
          [userId, `${name}-${token}`]
        )
        tagIds.push(t.id)
        tagUuids.push(t.uuid)
      }

      const bookmarkIds: number[] = []
      for (let i = 0; i < 3; i++) {
        const { rows: [b] } = await client.query<{ id: number }>(
          `INSERT INTO sr_bookmark (target_url, title, created_at, updated_at, published_at) VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
          [`https://example.test/${token}/${i}`, `t${i}`]
        )
        bookmarkIds.push(b.id)
        await client.query(`INSERT INTO sr_user_bookmark (user_id, bookmark_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)`, [userId, b.id])
      }

      const link = (bm: number, tag: number, source = 'user') =>
        client.query(
          `INSERT INTO sr_user_bookmark_tag (user_id, bookmark_id, tag_id, tag_name, source)
           SELECT $1, $2, $3, tag_name, $4 FROM sr_user_tag WHERE id = $3`,
          [userId, bm, tag, source]
        )
      // bm0: a,b ; bm1: a,b,c ; bm2: none
      await link(bookmarkIds[0], tagIds[0])
      await link(bookmarkIds[0], tagIds[1])
      await link(bookmarkIds[1], tagIds[0], 'ai')
      await link(bookmarkIds[1], tagIds[1])
      await link(bookmarkIds[1], tagIds[2])

      const contains = async (uuids: string[]) =>
        (
          await client.query<{ bookmark_id: number }>(
            `SELECT bookmark_id FROM sr_user_bookmark WHERE user_id = $1 AND deleted_at IS NULL AND metadata->'tags' @> $2::jsonb ORDER BY bookmark_id`,
            [userId, JSON.stringify(uuids)]
          )
        ).rows.map(r => r.bookmark_id)

      expect(await contains([tagUuids[0], tagUuids[1]])).toEqual([bookmarkIds[0], bookmarkIds[1]])
      expect(await contains([tagUuids[0], tagUuids[2]])).toEqual([bookmarkIds[1]])

      const untagged = await client.query<{ bookmark_id: number }>(
        `SELECT bookmark_id FROM sr_user_bookmark WHERE user_id = $1 AND deleted_at IS NULL
           AND (jsonb_typeof(metadata->'tags') IS DISTINCT FROM 'array' OR metadata->'tags' = '[]'::jsonb)`,
        [userId]
      )
      expect(untagged.rows.map(r => r.bookmark_id)).toEqual([bookmarkIds[2]])

      const candidates = await client.query<{ tag_id: number; count: number }>(
        `SELECT bt.tag_id, COUNT(DISTINCT bt.bookmark_id)::int AS count
         FROM sr_user_bookmark_tag bt
         JOIN sr_user_bookmark ub ON ub.bookmark_id = bt.bookmark_id AND ub.user_id = bt.user_id
         WHERE bt.user_id = $1 AND bt.is_deleted = false AND ub.deleted_at IS NULL
           AND ub.metadata->'tags' @> $2::jsonb AND bt.tag_id NOT IN ($3, $4)
         GROUP BY bt.tag_id`,
        [userId, JSON.stringify([tagUuids[0], tagUuids[1]]), tagIds[0], tagIds[1]]
      )
      expect(candidates.rows).toEqual([{ tag_id: tagIds[2], count: 1 }])

      // soft delete drops the uuid from metadata through the trigger
      await client.query(`UPDATE sr_user_bookmark_tag SET is_deleted = true WHERE user_id = $1 AND bookmark_id = $2 AND tag_id = $3`, [userId, bookmarkIds[1], tagIds[2]])
      expect(await contains([tagUuids[2]])).toEqual([])

      // the AI-path upsert must not revive a hidden tag
      await client.query(`UPDATE sr_user_tag SET display = false WHERE id = $1`, [tagIds[2]])
      await client.query(
        `INSERT INTO sr_user_tag(user_id, tag_name, display, source) SELECT $1, tag_name, true, 'mine' FROM UNNEST($2::text[]) AS tag_name
         ON CONFLICT(user_id, tag_name) DO UPDATE SET display = CASE WHEN $3 THEN true ELSE sr_user_tag.display END RETURNING id`,
        [userId, [`c-${token}`], false]
      )
      const { rows: [hidden] } = await client.query<{ display: boolean; source: string }>(`SELECT display, source FROM sr_user_tag WHERE id = $1`, [tagIds[2]])
      expect(hidden).toEqual({ display: false, source: 'auto' })
    } finally {
      await client.query('ROLLBACK')
    }
  })
})
