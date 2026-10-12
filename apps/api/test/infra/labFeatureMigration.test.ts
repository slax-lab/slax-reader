import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const read = (dir: string) => readFileSync(new URL(`../../prisma/pg_migrations/${dir}/migration.sql`, import.meta.url), 'utf8')
const table = read('20260908000000_add_user_lab_feature')
const seed = read('20260908000001_seed_youtube_lab_users')

describe('Labs table migration', () => {
  test('creates the switch table with one row per user and feature', () => {
    expect(table).toContain('CREATE TABLE "sr_user_lab_feature"')
    expect(table).toContain('"enabled" BOOLEAN NOT NULL DEFAULT false')
    expect(table).toContain('CREATE UNIQUE INDEX "sr_user_lab_feature_user_id_feature_key" ON "sr_user_lab_feature"("user_id", "feature")')
    expect(table).toContain('ON "sr_user_lab_feature"("feature", "enabled")')
  })

  test('preserves the primary key and audit timestamps', () => {
    expect(table).toContain('CONSTRAINT "sr_user_lab_feature_pkey" PRIMARY KEY ("id")')
    expect(table).toContain('"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP')
    expect(table).toContain('"updated_at" TIMESTAMP(3) NOT NULL')
  })
})

describe('YouTube seed migration', () => {
  test('turns the switch on only for users who already saved YouTube', () => {
    expect(seed).toMatch(/INSERT INTO "sr_user_lab_feature" \("user_id", "feature", "enabled", "created_at", "updated_at"\)/)
    expect(seed).toContain("'youtube', true")
    expect(seed).toContain('ub."deleted_at" IS NULL')
  })

  test('catches failed crawls by URL, not only site_name', () => {
    expect(seed).toContain(`b."site_name" = 'YouTube'`)
    expect(seed).toContain(`youtube\\.com/(watch|shorts|live|embed)`)
  })

  test('is safe to run twice and never flips a switch off', () => {
    expect(seed).toContain('ON CONFLICT ("user_id", "feature") DO NOTHING')
    expect(seed).not.toMatch(/UPDATE|DELETE|false/)
  })
})
