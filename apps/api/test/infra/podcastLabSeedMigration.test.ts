import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const migration = readFileSync(new URL('../../prisma/pg_migrations/20261022140000_seed_podcast_lab_users/migration.sql', import.meta.url), 'utf8')

describe('Podcast Labs seed migration', () => {
  test('enables podcast for accounts that already saved a recognised episode link', () => {
    expect(migration).toContain('INSERT INTO "sr_user_lab_feature"')
    expect(migration).toContain("'podcast', true")
    expect(migration).toContain('xiaoyuzhoufm\\.com/episode/[A-Za-z0-9]+')
    expect(migration).toContain('podcasts\\.apple\\.com/[^?#]*/id[0-9]+[^#]*[?&]i=[0-9]+')
    expect(migration).toContain('open\\.spotify\\.com/(intl-[a-z-]+/)?episode/[A-Za-z0-9]+')
    expect(migration).toContain('/[^?#]*\\.(mp3|m4a|aac|ogg|oga|opus|wav)([?#]|$)')
  })

  test('never overwrites an explicit choice', () => {
    expect(migration).toContain('ON CONFLICT ("user_id", "feature") DO NOTHING')
  })
})
