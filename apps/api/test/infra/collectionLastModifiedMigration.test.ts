import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const migration = readFileSync(new URL('../../prisma/pg_migrations/20260803060000_add_collection_stats/migration.sql', import.meta.url), 'utf8')

describe('Collection last_modified_at migration', () => {
  test('creates and backfills the activity timestamp with Collection stats', () => {
    expect(migration).toContain('"last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP')
    expect(migration).not.toContain('ALTER TABLE "sr_user_collection"')
    expect(migration).toContain('MAX(COALESCE(bookmark."starred_at", bookmark."updated_at", bookmark."created_at"))')
  })

  test('touches activity for article membership and Collection metadata only', () => {
    expect(migration).toContain('"last_modified_at" = CURRENT_TIMESTAMP')
    expect(migration).toContain('OLD."display_name" IS DISTINCT FROM NEW."display_name"')
    expect(migration).toContain('OLD."description" IS DISTINCT FROM NEW."description"')
    expect(migration).not.toContain('sr_bookmark_comment')
  })
})
