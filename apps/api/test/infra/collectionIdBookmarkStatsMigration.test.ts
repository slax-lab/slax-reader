import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const migration = readFileSync(
  new URL('../../prisma/pg_migrations/20260805010000_add_collection_id_to_bookmark_stats/migration.sql', import.meta.url),
  'utf8'
)

describe('Bookmark stats Collection association migration', () => {
  test('adds and backfills the nullable association without adding another trigger', () => {
    expect(migration).toContain('ADD COLUMN "collection_id" INTEGER')
    expect(migration).toContain('CREATE INDEX "sr_user_bookmark_stats_collection_id_idx"')
    expect(migration).toContain('WHERE stats."collection_id" IS NULL')
    expect(migration).toContain('collection."status" = 1')
    expect(migration).toContain('bookmark."is_starred" = true')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "trigger_user_bookmark_before_update"')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "sr_user_collection_stats_after_bookmark_insert"')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "trigger_share_update"')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "sr_user_collection_stats_maintain_collection"')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "sr_user_bookmark_stats_insert_comment"')
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION "sr_user_bookmark_stats_restore"')
    expect(migration).toContain('ON CONFLICT ("bookmark_uuid") DO UPDATE')
    expect(migration).toContain("'{share}'")
    expect(migration).not.toContain("'{collection_policy}'")
    expect(migration).not.toContain("metadata->'collection_policy'")
    const shareTrigger = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION "trigger_share_update"'))
    expect(shareTrigger).not.toContain('collection_policy')
    const commentTrigger = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION "sr_user_bookmark_stats_insert_comment"'))
    expect(commentTrigger).toContain('("bookmark_uuid", "comment_count", "first_comment", "owner_id", "created_at")')
    expect(commentTrigger).not.toContain('collection_id')
    expect(commentTrigger).not.toMatch(/\sOR\s+\(/)
    expect(migration).not.toContain('CREATE TRIGGER')
  })
})
