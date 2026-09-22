import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const migration = readFileSync(
  new URL('../../prisma/pg_migrations/20260814100000_reduce_collection_sync_buckets/migration.sql', import.meta.url),
  'utf8'
)

describe('Collection sync bucket migration', () => {
  test('maintains the association with one focused function', () => {
    expect(migration).toContain('CREATE FUNCTION "sr_user_bookmark_stats_maintain_collection_id"')
    expect(migration).toContain('SET "collection_id" = NULL')
    expect(migration).toContain('AFTER INSERT OR UPDATE OF "is_starred", "deleted_at", "user_id"')
    expect(migration.match(/CREATE TRIGGER/g)).toHaveLength(1)
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION')
  })

  test('does not replace the existing Collection lifecycle trigger', () => {
    expect(migration).not.toContain('sr_user_collection_stats_maintain_collection')
    expect(migration).not.toContain('ON "sr_user_collection"')
  })
})
