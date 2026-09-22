import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const migration = readFileSync(
  new URL('../../prisma/pg_migrations/20260804010000_refresh_bookmark_stats_on_share_policy_change/migration.sql', import.meta.url),
  'utf8'
)

describe('Collection policy stats refresh migration', () => {
  test('removes hidden derived stats and reuses the share trigger', () => {
    expect(migration).toContain('DELETE FROM "sr_user_bookmark_stats" AS stats')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "sr_user_bookmark_stats_restore"')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "trigger_share_update"')
    expect(migration).toContain('stats."bookmark_uuid" = bookmark."uuid"')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "sr_user_bookmark_stats_insert_comment"')
    expect(migration).toContain("COALESCE((ub.metadata->'collection_policy'->>'show_marks')::boolean, true)")
    expect(migration).not.toContain('ADD COLUMN "show_marks"')
    expect(migration).not.toContain('CREATE TRIGGER')
  })
})
