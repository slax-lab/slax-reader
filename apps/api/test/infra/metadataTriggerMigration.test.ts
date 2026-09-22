import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const migration = readFileSync(new URL('../../prisma/pg_migrations/20260803070000_optimize_metadata_triggers/migration.sql', import.meta.url), 'utf8')

describe('Metadata trigger optimization migration', () => {
  test('skips bookmark fan-out when mirrored fields are unchanged', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "trigger_bookmark_update"')
    expect(migration).toContain('IS NOT DISTINCT FROM ROW')
    expect(migration).not.toMatch(/OLD\."moderation_result"|NEW\."moderation_result"/)
  })

  test('resolves comment bookmark metadata through sr_user_bookmark', () => {
    expect(migration).toContain('WHERE user_bookmark."id" = NEW."bookmark_id"')
    expect(migration).toContain('ON bookmark."id" = user_bookmark."bookmark_id"')
    expect(migration).toContain("'source_type', NEW.\"source_type\"")
    expect(migration).not.toContain('FROM "sr_bookmark" WHERE "id" = NEW."bookmark_id"')
  })
})
