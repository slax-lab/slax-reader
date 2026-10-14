import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const describePg = process.env.RUN_PG_INTEGRATION_TESTS === '1' ? describe : describe.skip

describePg('Collection PostgreSQL triggers', () => {
  let client: pg.Client

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.HYPERDRIVE_DATABASE_URL })
    await client.connect()
  })

  afterAll(async () => {
    await client?.end()
  })

  test('preserves metadata behavior and aggregates Collection stats writes', async () => {
    await client.query('BEGIN')

    try {
      const token = randomUUID()
      const ownerResult = await client.query<{ id: number }>(
        `INSERT INTO sr_user (email, last_login_at, created_at)
         VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`,
        [`trigger-owner-${token}@example.test`]
      )
      const ownerId = ownerResult.rows[0].id

      const collectionResult = await client.query<{ id: number }>(
        `INSERT INTO sr_user_collection
           (owner_id, display_name, description, collection_code, status, updated_at)
         VALUES ($1, 'Trigger test', 'Initial', $2, 1, CURRENT_TIMESTAMP)
         RETURNING id`,
        [ownerId, `trigger-${token}`]
      )
      const collectionId = collectionResult.rows[0].id

      await client.query(`
        CREATE TEMP TABLE stats_update_audit (owner_id INTEGER) ON COMMIT DROP;
        CREATE OR REPLACE FUNCTION pg_temp.audit_stats_update()
        RETURNS TRIGGER AS $$
        BEGIN
          INSERT INTO stats_update_audit(owner_id) VALUES (NEW.owner_id);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER test_stats_update_audit
        AFTER UPDATE ON sr_user_collection_stats
        FOR EACH ROW EXECUTE FUNCTION pg_temp.audit_stats_update();

        CREATE TEMP TABLE bookmark_stats_change_audit (operation TEXT, bookmark_uuid TEXT) ON COMMIT DROP;
        CREATE OR REPLACE FUNCTION pg_temp.audit_bookmark_stats_change()
        RETURNS TRIGGER AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            INSERT INTO bookmark_stats_change_audit(operation, bookmark_uuid) VALUES (TG_OP, OLD.bookmark_uuid);
            RETURN OLD;
          END IF;
          INSERT INTO bookmark_stats_change_audit(operation, bookmark_uuid) VALUES (TG_OP, NEW.bookmark_uuid);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER test_bookmark_stats_change_audit
        AFTER INSERT OR UPDATE OR DELETE ON sr_user_bookmark_stats
        FOR EACH ROW EXECUTE FUNCTION pg_temp.audit_bookmark_stats_change();

        CREATE TEMP TABLE bookmark_update_audit (bookmark_id INTEGER) ON COMMIT DROP;
        CREATE OR REPLACE FUNCTION pg_temp.audit_bookmark_update()
        RETURNS TRIGGER AS $$
        BEGIN
          INSERT INTO bookmark_update_audit(bookmark_id) VALUES (NEW.bookmark_id);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER test_bookmark_update_audit
        AFTER UPDATE ON sr_user_bookmark
        FOR EACH ROW EXECUTE FUNCTION pg_temp.audit_bookmark_update();
      `)

      const rawResult = await client.query<{ id: number; uuid: string }>(
        `INSERT INTO sr_bookmark
           (title, target_url, private_user, created_at, updated_at, published_at)
         SELECT 'Raw ' || value, $1 || value, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         FROM generate_series(1, 3) AS value
         RETURNING id, uuid`,
        [`https://trigger-${token}.example/`, ownerId]
      )
      const rawIds = rawResult.rows.map(row => row.id)

      await client.query(
        `INSERT INTO sr_user_bookmark (user_id, bookmark_id, is_starred, updated_at)
         SELECT $1, id, true, CURRENT_TIMESTAMP
         FROM unnest($2::integer[]) AS id`,
        [ownerId, rawIds]
      )

      const initialStats = await client.query<{ starred_count: number; writes: number }>(
        `SELECT stats.starred_count,
                (SELECT COUNT(*)::int FROM stats_update_audit) AS writes
         FROM sr_user_collection_stats AS stats
         WHERE stats.collection_id = $1`,
        [collectionId]
      )
      expect(initialStats.rows[0]).toEqual({ starred_count: 3, writes: 1 })

      const initialBookmarkStats = await client.query<{ count: number; collection_ids: number[] }>(
        `SELECT COUNT(*)::int AS count,
                ARRAY_AGG(DISTINCT collection_id)::integer[] AS collection_ids
         FROM sr_user_bookmark_stats
         WHERE owner_id = $1`,
        [ownerId]
      )
      expect(initialBookmarkStats.rows[0]).toEqual({ count: 3, collection_ids: [collectionId] })

      const userBookmarks = await client.query<{ id: number; uuid: string; bookmark_id: number }>(
        `SELECT id, uuid, bookmark_id
         FROM sr_user_bookmark
         WHERE user_id = $1 AND bookmark_id = ANY($2::integer[])
         ORDER BY bookmark_id`,
        [ownerId, rawIds]
      )
      const firstUserBookmark = userBookmarks.rows[0]
      const firstRaw = rawResult.rows.find(row => row.id === firstUserBookmark.bookmark_id)!

      await client.query(
        `INSERT INTO sr_bookmark_comment
           (user_bookmark_uuid, user_id, bookmark_id, type, source, comment,
            approx_source, content, source_type, source_id, updated_at)
         VALUES
           ($1, $2, $3, 2, '[]', 'first comment', '[]', 'first highlight', 'collection', $1, CURRENT_TIMESTAMP),
           ($1, $2, $3, 1, '[]', '', '[]', 'second highlight', 'collection', $1, CURRENT_TIMESTAMP)`,
        [firstUserBookmark.uuid, ownerId, firstUserBookmark.id]
      )

      await client.query('TRUNCATE bookmark_update_audit')
      const shareResult = await client.query<{ id: number }>(
        `INSERT INTO sr_bookmark_share
           (share_code, user_id, bookmark_id, show_line, show_comment,
            show_userinfo, allow_comment, allow_line, is_enable)
         VALUES ($1, $2, $3, true, true, true, true, true, true)
         RETURNING id`,
        [`share-${token}`, ownerId, firstRaw.id]
      )
      const shareId = shareResult.rows[0].id

      let metadataResult = await client.query<{ metadata: Record<string, any>; writes: number }>(
        `SELECT metadata,
                (SELECT COUNT(*)::int FROM bookmark_update_audit) AS writes
         FROM sr_user_bookmark WHERE id = $1`,
        [firstUserBookmark.id]
      )
      expect(metadataResult.rows[0].writes).toBe(1)
      expect(metadataResult.rows[0].metadata.share.is_enable).toBe(true)
      expect(metadataResult.rows[0].metadata.collection_policy).toBeUndefined()

      await client.query('TRUNCATE bookmark_stats_change_audit')
      await client.query('UPDATE sr_bookmark_share SET show_line = false WHERE id = $1', [shareId])
      let syncedStats = await client.query<{ comment_count: number; collection_id: number | null; first_content: string; first_comment: string }>(
        `SELECT stats.comment_count,
                stats.collection_id,
                stats.first_comment->>'content' AS first_content,
                stats.first_comment->>'comment' AS first_comment
         FROM sr_user_bookmark_stats AS stats
         INNER JOIN sr_user_bookmark AS bookmark
           ON bookmark.uuid = stats.bookmark_uuid
          AND bookmark.user_id = stats.owner_id
         WHERE stats.bookmark_uuid = $1`,
        [firstUserBookmark.uuid]
      )
      expect(syncedStats.rows).toEqual([
        { comment_count: 0, collection_id: collectionId, first_content: null, first_comment: null }
      ])

      await client.query(
        `INSERT INTO sr_bookmark_comment
           (user_bookmark_uuid, user_id, bookmark_id, type, source, comment,
            approx_source, content, source_type, source_id, updated_at)
         VALUES ($1, $2, $3, 2, '[]', 'hidden comment', '[]', 'hidden highlight', 'collection', $1, CURRENT_TIMESTAMP)`,
        [firstUserBookmark.uuid, ownerId, firstUserBookmark.id]
      )
      expect((await client.query('SELECT COUNT(*)::int AS count FROM sr_user_bookmark_stats WHERE bookmark_uuid = $1', [firstUserBookmark.uuid])).rows[0].count).toBe(1)
      expect((await client.query("SELECT operation FROM bookmark_stats_change_audit")).rows).toEqual([{ operation: 'UPDATE' }])

      await client.query('TRUNCATE bookmark_stats_change_audit')
      await client.query('UPDATE sr_bookmark_share SET show_line = true WHERE id = $1', [shareId])
      syncedStats = await client.query(
        `SELECT stats.comment_count,
                stats.collection_id,
                stats.first_comment->>'content' AS first_content,
                stats.first_comment->>'comment' AS first_comment
         FROM sr_user_bookmark_stats AS stats
         INNER JOIN sr_user_bookmark AS bookmark
           ON bookmark.uuid = stats.bookmark_uuid
          AND bookmark.user_id = stats.owner_id
         WHERE stats.bookmark_uuid = $1`,
        [firstUserBookmark.uuid]
      )
      expect(syncedStats.rows).toEqual([
        { comment_count: 3, collection_id: collectionId, first_content: 'first highlight', first_comment: 'first comment' }
      ])
      expect((await client.query("SELECT operation FROM bookmark_stats_change_audit")).rows).toEqual([{ operation: 'UPDATE' }])

      await client.query('TRUNCATE bookmark_update_audit')
      await client.query('UPDATE sr_bookmark_share SET allow_line = false WHERE id = $1', [shareId])
      metadataResult = await client.query(
        `SELECT metadata,
                (SELECT COUNT(*)::int FROM bookmark_update_audit) AS writes
         FROM sr_user_bookmark WHERE id = $1`,
        [firstUserBookmark.id]
      )
      expect(metadataResult.rows[0].writes).toBe(1)
      expect(metadataResult.rows[0].metadata.share.allow_line).toBe(false)
      expect(metadataResult.rows[0].metadata.collection_policy).toBeUndefined()

      await client.query('TRUNCATE bookmark_update_audit')
      await client.query('UPDATE sr_bookmark_share SET is_enable = false WHERE id = $1', [shareId])
      metadataResult = await client.query(
        `SELECT metadata,
                (SELECT COUNT(*)::int FROM bookmark_update_audit) AS writes
         FROM sr_user_bookmark WHERE id = $1`,
        [firstUserBookmark.id]
      )
      expect(metadataResult.rows[0].writes).toBe(1)
      expect(metadataResult.rows[0].metadata.share).toMatchObject({
        is_enable: false,
        show_line: true,
        show_comment: true,
        show_userinfo: true
      })
      expect(metadataResult.rows[0].metadata.collection_policy).toBeUndefined()

      await client.query('TRUNCATE bookmark_update_audit')
      await client.query('DELETE FROM sr_bookmark_share WHERE id = $1', [shareId])
      metadataResult = await client.query(
        `SELECT metadata,
                (SELECT COUNT(*)::int FROM bookmark_update_audit) AS writes
         FROM sr_user_bookmark WHERE id = $1`,
        [firstUserBookmark.id]
      )
      expect(metadataResult.rows[0].writes).toBe(1)
      expect(metadataResult.rows[0].metadata.share).toBeUndefined()
      expect(metadataResult.rows[0].metadata.collection_policy).toBeUndefined()

      await client.query('TRUNCATE bookmark_update_audit')
      await client.query('UPDATE sr_bookmark SET moderation_result = 1 WHERE id = $1', [firstRaw.id])
      expect((await client.query('SELECT COUNT(*)::int AS count FROM bookmark_update_audit')).rows[0].count).toBe(0)

      await client.query('UPDATE sr_bookmark SET title = $1 WHERE id = $2', ['Updated title', firstRaw.id])
      const bookmarkMetadata = await client.query<{ title: string; writes: number }>(
        `SELECT metadata->'bookmark'->>'title' AS title,
                (SELECT COUNT(*)::int FROM bookmark_update_audit) AS writes
         FROM sr_user_bookmark WHERE id = $1`,
        [firstUserBookmark.id]
      )
      expect(bookmarkMetadata.rows[0]).toEqual({ title: 'Updated title', writes: 1 })

      const commentResult = await client.query<{ metadata: Record<string, any> }>(
        `INSERT INTO sr_bookmark_comment
           (user_bookmark_uuid, user_id, bookmark_id, type, content,
            approx_source, source_type, source_id, updated_at)
         VALUES ($1, $2, $3, 2, '[]', '[]', 'collection', $1, CURRENT_TIMESTAMP)
         RETURNING metadata`,
        [firstUserBookmark.uuid, ownerId, firstUserBookmark.id]
      )
      expect(commentResult.rows[0].metadata.bookmark_id).toBe(firstRaw.uuid)
      expect(commentResult.rows[0].metadata.source_type).toBe('collection')
      expect(commentResult.rows[0].metadata.source_id).toBe(firstUserBookmark.uuid)

      await client.query('TRUNCATE stats_update_audit')
      await client.query(
        `UPDATE sr_user_bookmark
         SET is_starred = false, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [firstUserBookmark.id]
      )
      let state = await client.query<{ starred_count: number; collection_id: number | null; starred_at: Date | null; writes: number }>(
        `SELECT stats.starred_count, bookmark_stats.collection_id, bookmark.starred_at,
                (SELECT COUNT(*)::int FROM stats_update_audit) AS writes
         FROM sr_user_collection_stats AS stats
         JOIN sr_user_bookmark AS bookmark ON bookmark.id = $2
         JOIN sr_user_bookmark_stats AS bookmark_stats ON bookmark_stats.bookmark_uuid = bookmark.uuid
         WHERE stats.collection_id = $1`,
        [collectionId, firstUserBookmark.id]
      )
      expect(state.rows[0]).toEqual({ starred_count: 2, collection_id: null, starred_at: null, writes: 1 })

      await client.query('TRUNCATE stats_update_audit')
      await client.query(
        `UPDATE sr_user_bookmark
         SET is_starred = true, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [firstUserBookmark.id]
      )
      state = await client.query(
        `SELECT stats.starred_count, stats.collection_id, bookmark.starred_at,
                (SELECT COUNT(*)::int FROM stats_update_audit) AS writes
         FROM sr_user_collection_stats AS stats
         JOIN sr_user_bookmark AS bookmark ON bookmark.id = $2
         WHERE stats.collection_id = $1`,
        [collectionId, firstUserBookmark.id]
      )
      expect(state.rows[0].starred_count).toBe(3)
      expect(state.rows[0].collection_id).toBe(collectionId)
      expect(state.rows[0].starred_at).not.toBeNull()
      expect(state.rows[0].writes).toBe(1)

      await client.query('TRUNCATE stats_update_audit')
      await client.query('UPDATE sr_user_bookmark SET archive_status = 1 WHERE id = $1', [firstUserBookmark.id])
      const archiveState = await client.query<{ archived_at: Date | null; writes: number }>(
        `SELECT archived_at,
                (SELECT COUNT(*)::int FROM stats_update_audit) AS writes
         FROM sr_user_bookmark WHERE id = $1`,
        [firstUserBookmark.id]
      )
      expect(archiveState.rows[0].archived_at).not.toBeNull()
      expect(archiveState.rows[0].writes).toBe(0)

      await client.query(`UPDATE sr_user_collection_stats SET last_modified_at = '2000-01-01' WHERE collection_id = $1`, [collectionId])
      await client.query('TRUNCATE stats_update_audit')
      await client.query('UPDATE sr_user_collection SET display_name = $1 WHERE id = $2', ['Renamed', collectionId])
      let collectionState = await client.query<{ changed: boolean; writes: number }>(
        `SELECT last_modified_at > '2000-01-01'::timestamp AS changed,
                (SELECT COUNT(*)::int FROM stats_update_audit) AS writes
         FROM sr_user_collection_stats WHERE collection_id = $1`,
        [collectionId]
      )
      expect(collectionState.rows[0]).toEqual({ changed: true, writes: 1 })

      await client.query(`UPDATE sr_user_collection_stats SET last_modified_at = '2000-01-01' WHERE collection_id = $1`, [collectionId])
      await client.query('TRUNCATE stats_update_audit')
      await client.query('UPDATE sr_user_collection SET status = 0 WHERE id = $1', [collectionId])
      collectionState = await client.query(
        `SELECT last_modified_at > '2000-01-01'::timestamp AS changed,
                (SELECT COUNT(*)::int FROM stats_update_audit) AS writes
         FROM sr_user_collection_stats WHERE collection_id = $1`,
        [collectionId]
      )
      expect(collectionState.rows[0]).toEqual({ changed: false, writes: 0 })

      const closedCollectionAssociation = await client.query<{ collection_id: number | null }>(
        `SELECT collection_id
         FROM sr_user_bookmark_stats
         WHERE bookmark_uuid = $1`,
        [firstUserBookmark.uuid]
      )
      expect(closedCollectionAssociation.rows[0].collection_id).toBe(collectionId)

      await client.query('UPDATE sr_user_bookmark SET is_starred = false WHERE id = $1', [firstUserBookmark.id])
      expect(
        (await client.query<{ collection_id: number | null }>('SELECT collection_id FROM sr_user_bookmark_stats WHERE bookmark_uuid = $1', [firstUserBookmark.uuid])).rows[0]
          .collection_id
      ).toBeNull()

      await client.query('UPDATE sr_user_bookmark SET is_starred = true WHERE id = $1', [firstUserBookmark.id])
      expect(
        (await client.query<{ collection_id: number | null }>('SELECT collection_id FROM sr_user_bookmark_stats WHERE bookmark_uuid = $1', [firstUserBookmark.uuid])).rows[0]
          .collection_id
      ).toBe(collectionId)

      await client.query('TRUNCATE bookmark_stats_change_audit')
      await client.query('UPDATE sr_user_collection SET status = 1 WHERE id = $1', [collectionId])
      expect((await client.query('SELECT COUNT(*)::int AS count FROM bookmark_stats_change_audit')).rows[0].count).toBe(0)
      const reopenedCollectionAssociation = await client.query<{ collection_id: number | null }>(
        `SELECT collection_id
         FROM sr_user_bookmark_stats
         WHERE bookmark_uuid = $1`,
        [firstUserBookmark.uuid]
      )
      expect(reopenedCollectionAssociation.rows[0].collection_id).toBe(collectionId)

      const noCollectionOwner = await client.query<{ id: number }>(
        `INSERT INTO sr_user (email, last_login_at, created_at)
         VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`,
        [`no-collection-owner-${token}@example.test`]
      )
      const noCollectionOwnerId = noCollectionOwner.rows[0].id
      const noCollectionBookmark = await client.query<{ id: number }>(
        `INSERT INTO sr_bookmark
           (title, target_url, private_user, created_at, updated_at, published_at)
         VALUES ('No Collection', $1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`,
        [`https://no-collection-${token}.example/`, noCollectionOwnerId]
      )
      const noCollectionUserBookmark = await client.query<{ uuid: string; id: number }>(
        `INSERT INTO sr_user_bookmark
           (user_id, bookmark_id, is_starred, updated_at)
         VALUES ($1, $2, true, CURRENT_TIMESTAMP)
         RETURNING uuid, id`,
        [noCollectionOwnerId, noCollectionBookmark.rows[0].id]
      )
      await client.query(
        `INSERT INTO sr_bookmark_comment
           (user_bookmark_uuid, user_id, bookmark_id, type, source, comment,
            approx_source, content, source_type, source_id, updated_at)
         VALUES ($1, $2, $3, 2, '[]', 'no collection comment', '[]', 'no collection highlight', 'collection', $1, CURRENT_TIMESTAMP)`,
        [noCollectionUserBookmark.rows[0].uuid, noCollectionOwnerId, noCollectionUserBookmark.rows[0].id]
      )
      const noCollectionStats = await client.query<{ collection_id: number | null }>(
        `SELECT collection_id
         FROM sr_user_bookmark_stats
         WHERE bookmark_uuid = $1`,
        [noCollectionUserBookmark.rows[0].uuid]
      )
      expect(noCollectionStats.rows[0].collection_id).toBeNull()

      const disabledCollection = await client.query<{ id: number }>(
        `INSERT INTO sr_user_collection
           (owner_id, display_name, collection_code, status, updated_at)
         VALUES ($1, 'Disabled Collection', $2, 0, CURRENT_TIMESTAMP)
         RETURNING id`,
        [noCollectionOwnerId, `disabled-${token}`]
      )
      await client.query('UPDATE sr_user_collection SET status = 1 WHERE id = $1', [disabledCollection.rows[0].id])
      const enabledCollectionStats = await client.query<{ collection_id: number | null }>(
        `SELECT collection_id
         FROM sr_user_bookmark_stats
         WHERE bookmark_uuid = $1`,
        [noCollectionUserBookmark.rows[0].uuid]
      )
      expect(enabledCollectionStats.rows[0].collection_id).toBe(disabledCollection.rows[0].id)

      await client.query(`UPDATE sr_user_collection_stats SET last_modified_at = '2000-01-01' WHERE collection_id = $1`, [collectionId])
      const subscriberUsers = await client.query<{ id: number }>(
        `INSERT INTO sr_user (email, last_login_at, created_at)
         SELECT $1 || value || '@example.test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         FROM generate_series(1, 3) AS value
         RETURNING id`,
        [`trigger-subscriber-${token}-`]
      )
      const subscriberIds = subscriberUsers.rows.map(row => row.id)

      await client.query('TRUNCATE stats_update_audit')
      await client.query(
        `INSERT INTO sr_user_collection_subscriber
           (user_id, collection_id, owner_id, subscription_end_time,
            next_invoice_time, updated_at)
         SELECT id, $1, $2, '2999-01-01', '2999-01-01', CURRENT_TIMESTAMP
         FROM unnest($3::integer[]) AS id`,
        [collectionId, ownerId, subscriberIds]
      )
      let subscriberState = await client.query<{ subscriber_count: number; writes: number; changed: boolean }>(
        `SELECT subscriber_count,
                (SELECT COUNT(*)::int FROM stats_update_audit) AS writes,
                last_modified_at > '2000-01-01'::timestamp AS changed
         FROM sr_user_collection_stats WHERE collection_id = $1`,
        [collectionId]
      )
      expect(subscriberState.rows[0]).toEqual({ subscriber_count: 3, writes: 1, changed: false })

      await client.query('TRUNCATE stats_update_audit')
      await client.query('DELETE FROM sr_user_collection_subscriber WHERE user_id = ANY($1::integer[])', [subscriberIds])
      subscriberState = await client.query(
        `SELECT subscriber_count,
                (SELECT COUNT(*)::int FROM stats_update_audit) AS writes,
                last_modified_at > '2000-01-01'::timestamp AS changed
         FROM sr_user_collection_stats WHERE collection_id = $1`,
        [collectionId]
      )
      expect(subscriberState.rows[0]).toEqual({ subscriber_count: 0, writes: 1, changed: false })

      await client.query('TRUNCATE stats_update_audit')
      await client.query('DELETE FROM sr_user_bookmark WHERE id = ANY($1::integer[])', [userBookmarks.rows.map(row => row.id)])
      const deletedState = await client.query<{ starred_count: number; writes: number }>(
        `SELECT starred_count,
                (SELECT COUNT(*)::int FROM stats_update_audit) AS writes
         FROM sr_user_collection_stats WHERE collection_id = $1`,
        [collectionId]
      )
      expect(deletedState.rows[0]).toEqual({ starred_count: 0, writes: 1 })

      await client.query('DELETE FROM sr_user_collection WHERE id = $1', [collectionId])
      expect((await client.query('SELECT COUNT(*)::int AS count FROM sr_user_collection_stats WHERE collection_id = $1', [collectionId])).rows[0].count).toBe(0)
    } finally {
      await client.query('ROLLBACK')
    }
  })
})
