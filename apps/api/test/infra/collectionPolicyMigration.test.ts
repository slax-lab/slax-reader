import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const migration = readFileSync(new URL('../../prisma/pg_migrations/20260730120000_move_collection_policy_to_bookmark/migration.sql', import.meta.url), 'utf8')

describe('Collection policy migration', () => {
  test('reuses the existing share trigger for both metadata snapshots', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "trigger_share_update"')
    expect(migration).toContain('CREATE TRIGGER "trigger_share_increment"')
    expect(migration).toContain("'{share}'")
    expect(migration).toContain("'{collection_policy}'")
    expect(migration).not.toContain('CREATE TRIGGER "sr_user_bookmark_mirror_share_policy"')
  })

  test('removes both snapshots on delete and stores disabled policy rows', () => {
    expect(migration).toContain("- 'share' - 'collection_policy'")
    expect(migration).toContain("'show_marks', NEW.\"is_enable\" AND NEW.\"show_line\" AND NEW.\"show_comment\"")
    expect(migration).toContain("'allow_marks', NEW.\"is_enable\" AND NEW.\"allow_line\" AND NEW.\"allow_comment\"")
  })
})
