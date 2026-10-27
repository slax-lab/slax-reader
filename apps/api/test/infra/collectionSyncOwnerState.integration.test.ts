import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const describePg = process.env.RUN_PG_INTEGRATION_TESTS === '1' ? describe : describe.skip

describePg('Collection owner deletion state', () => {
  let client: pg.Client

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.HYPERDRIVE_DATABASE_URL })
    await client.connect()
  })

  afterAll(async () => {
    await client?.end()
  })

  test('fills owner_deleted on insert and owner change, and follows owner deletion and restoration', async () => {
    await client.query('BEGIN')

    try {
      const token = randomUUID()
      const owners = await client.query<{ id: number; deleted_at: Date | null }>(
        `INSERT INTO sr_user (email, last_login_at, created_at, deleted_at)
         VALUES
           ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
           ($2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, deleted_at`,
        [`owner-state-${token}@example.test`, `owner-state-deleted-${token}@example.test`]
      )
      const activeOwnerId = owners.rows[0].id
      const deletedOwnerId = owners.rows[1].id

      const activeCollection = await client.query<{ id: number; owner_deleted: boolean }>(
        `INSERT INTO sr_user_collection
           (owner_id, display_name, collection_code, status, updated_at)
         VALUES ($1, 'Owner state', $2, 1, CURRENT_TIMESTAMP)
         RETURNING id, owner_deleted`,
        [activeOwnerId, `owner-state-${token}`]
      )
      const collectionId = activeCollection.rows[0].id
      expect(activeCollection.rows[0].owner_deleted).toBe(false)

      await client.query('UPDATE sr_user SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [activeOwnerId])
      const deleted = await client.query<{ owner_deleted: boolean }>(
        'SELECT owner_deleted FROM sr_user_collection WHERE id = $1',
        [collectionId]
      )
      expect(deleted.rows[0].owner_deleted).toBe(true)

      const deletedCollection = await client.query<{ owner_deleted: boolean }>(
        `INSERT INTO sr_user_collection
           (owner_id, display_name, collection_code, status, updated_at)
         VALUES ($1, 'Created while deleted', $2, 1, CURRENT_TIMESTAMP)
         RETURNING owner_deleted`,
        [deletedOwnerId, `owner-state-deleted-collection-${token}`]
      )
      expect(deletedCollection.rows[0].owner_deleted).toBe(true)

      await client.query('UPDATE sr_user SET deleted_at = NULL WHERE id = $1', [activeOwnerId])
      const restored = await client.query<{ owner_deleted: boolean }>(
        'SELECT owner_deleted FROM sr_user_collection WHERE owner_id = $1',
        [activeOwnerId]
      )
      expect(restored.rows.map(row => row.owner_deleted)).toEqual([false])

      await client.query('UPDATE sr_user SET deleted_at = NULL WHERE id = $1', [deletedOwnerId])
      const restoredDeletedOwner = await client.query<{ owner_deleted: boolean }>(
        'SELECT owner_deleted FROM sr_user_collection WHERE owner_id = $1',
        [deletedOwnerId]
      )
      expect(restoredDeletedOwner.rows.map(row => row.owner_deleted)).toEqual([false])

      // Reassigning a collection re-derives the flag from the new owner.
      const reassignTarget = await client.query<{ id: number }>(
        `INSERT INTO sr_user (email, last_login_at, created_at, deleted_at)
         VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`,
        [`owner-state-reassign-${token}@example.test`]
      )
      const reassigned = await client.query<{ owner_deleted: boolean }>(
        'UPDATE sr_user_collection SET owner_id = $1 WHERE id = $2 RETURNING owner_deleted',
        [reassignTarget.rows[0].id, collectionId]
      )
      expect(reassigned.rows[0].owner_deleted).toBe(true)

      const reassignedBack = await client.query<{ owner_deleted: boolean }>(
        'UPDATE sr_user_collection SET owner_id = $1 WHERE id = $2 RETURNING owner_deleted',
        [activeOwnerId, collectionId]
      )
      expect(reassignedBack.rows[0].owner_deleted).toBe(false)
    } finally {
      await client.query('ROLLBACK')
    }
  })
})
