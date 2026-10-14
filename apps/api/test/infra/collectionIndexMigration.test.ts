import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const migration = readFileSync(new URL('../../prisma/pg_migrations/20260803050000_optimize_collection_sync_indexes/migration.sql', import.meta.url), 'utf8')

describe('Collection index migration', () => {
  test('adds both bookmark read paths and removes the obsolete subscriber path', () => {
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "sr_user_bookmark_collection_visible_created_at_idx"')
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "sr_user_bookmark_bookmark_id_idx"')
    expect(migration).toContain('DROP INDEX IF EXISTS "sr_user_collection_subscriber_is_active_subscription_end_ti_idx"')
  })
})
