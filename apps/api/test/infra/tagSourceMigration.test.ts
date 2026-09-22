import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const migration = readFileSync(new URL('../../prisma/pg_migrations/20260905000000_add_tag_source_and_last_used/migration.sql', import.meta.url), 'utf8')

describe('Tag source migration', () => {
  test('adds ownership, recency and attachment source with safe defaults', () => {
    expect(migration).toContain(`ALTER TABLE "sr_user_tag" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'auto'`)
    expect(migration).toContain(`ALTER TABLE "sr_user_tag" ADD COLUMN "last_used_at" TIMESTAMP(3)`)
    expect(migration).toContain(`ALTER TABLE "sr_user_bookmark_tag" ADD COLUMN "source" TEXT NOT NULL DEFAULT ''`)
  })

  test('backfills last_used_at from live links only', () => {
    expect(migration).toMatch(/UPDATE "sr_user_tag" t SET "last_used_at" = \(\s*SELECT MAX\(bt\."created_at"\)/)
    expect(migration).toContain('bt."is_deleted" = false')
  })

  test('never rewrites existing ownership', () => {
    expect(migration).not.toMatch(/SET "source" = 'mine'/)
    expect(migration).not.toContain('DROP')
  })
})
