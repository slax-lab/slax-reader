import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const migration = readFileSync(new URL('../../prisma/pg_migrations/20260803060000_add_collection_stats/migration.sql', import.meta.url), 'utf8')

describe('Collection stats migration', () => {
  test('creates the Prisma-backed Collection stats table', () => {
    expect(migration).toContain('CREATE TABLE "sr_user_collection_stats"')
    expect(migration).toContain('"starred_count" INTEGER NOT NULL DEFAULT 0')
    expect(migration).toContain('"subscriber_count" INTEGER NOT NULL DEFAULT 0')
    expect(migration).toContain('"last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP')
    expect(migration).toContain('sr_user_collection_stats_collection_id_key')
    expect(migration).toContain('sr_user_collection_stats_owner_id_key')
  })

  test('aggregates batch inserts and deletes with transition tables', () => {
    expect(migration).toContain('REFERENCING NEW TABLE AS inserted_bookmarks')
    expect(migration).toContain('REFERENCING OLD TABLE AS deleted_bookmarks')
    expect(migration).toContain('REFERENCING NEW TABLE AS inserted_subscribers')
    expect(migration).toContain('REFERENCING OLD TABLE AS deleted_subscribers')
    expect(migration).not.toContain('FOR EACH ROW\n+EXECUTE FUNCTION "sr_user_collection_stats_after_subscriber')
  })

  test('reuses existing bookmark triggers and keeps subscriber changes out of last_modified_at', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "trigger_user_bookmark_before_update"')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "sr_user_bookmark_stats_delete_with_bookmark"')
    expect(migration).toContain('BEFORE UPDATE OF "is_starred", "archive_status", "deleted_at", "user_id"')
    expect(migration).not.toMatch(/subscriber[\s\S]{0,500}"last_modified_at" = CURRENT_TIMESTAMP/)
    expect(migration).not.toContain('CREATE TRIGGER "sr_user_collection_stats_subscriber_update"')
  })

  test('uses one Collection trigger for lifecycle and metadata changes', () => {
    expect(migration).toContain('CREATE TRIGGER "sr_user_collection_stats_maintain_collection"')
    expect(migration).toContain('AFTER INSERT OR UPDATE OR DELETE ON "sr_user_collection"')
    expect(migration).not.toContain('CREATE TRIGGER "sr_user_collection_stats_init"')
    expect(migration).not.toContain('CREATE TRIGGER "sr_user_collection_stats_drop"')
  })
})
