import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'

let db: PGlite
let repo: BookmarkRepo
const statements: string[] = []
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE TABLE sr_bookmark_share (
    id SERIAL PRIMARY KEY, uuid TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    share_code TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL, bookmark_id INTEGER NOT NULL,
    show_line BOOLEAN NOT NULL DEFAULT false, show_comment BOOLEAN NOT NULL DEFAULT false,
    show_userinfo BOOLEAN NOT NULL DEFAULT false, allow_comment BOOLEAN NOT NULL DEFAULT false,
    allow_line BOOLEAN NOT NULL DEFAULT false, is_enable BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(bookmark_id, user_id)
  )`)
  const client = {
    $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.reduce((text, part, i) => text + (i ? '$' + i : '') + part, '')
      statements.push(sql)
      return (await db.query(sql, values)).rows
    }
  }
  repo = new BookmarkRepo((() => ({})) as never, (() => client) as never)
})
beforeEach(async () => {
  await db.exec('TRUNCATE sr_bookmark_share')
  statements.length = 0
})
afterAll(async () => {
  await db.close()
})
const rows = async () => (await db.query('SELECT * FROM sr_bookmark_share ORDER BY id')).rows as Array<Record<string, unknown>>

describe('BookmarkRepo.saveBookmarkShare with PostgreSQL', () => {
  test('initializes closed settings and immediately reopens the same row', async () => {
    const closed = await repo.saveBookmarkShare('', 10, 42, false, true, false)
    const before = (await rows())[0]
    const opened = await repo.saveBookmarkShare('', 10, 42, true, true, true)
    const saved = await rows()
    expect(closed).toMatchObject({ allow_comment: false, show_comment: false, share_code: '' })
    expect(opened).toMatchObject({ allow_comment: true, show_comment: true, share_code: '' })
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ id: before.id, uuid: before.uuid, created_at: before.created_at, allow_line: true, show_line: true, is_enable: true })
    expect(statements).toHaveLength(2)
    expect(statements.every(sql => /ON CONFLICT \(bookmark_id, user_id\)\s+DO UPDATE/.test(sql) && /RETURNING/.test(sql))).toBe(true)
  })

  test('preserves existing identity, timestamp and code while re-enabling a disabled share', async () => {
    await db.exec(`INSERT INTO sr_bookmark_share (user_id, bookmark_id, share_code, is_enable, created_at)
      VALUES (10, 42, 'original-code', false, '2020-01-01')`)
    const before = (await rows())[0]
    const result = await repo.saveBookmarkShare('unused-code', 10, 42, false, false, true)
    expect(result).toMatchObject({ share_code: 'original-code', show_comment: false, show_userinfo: false, allow_comment: true })
    expect((await rows())[0]).toMatchObject({ id: before.id, uuid: before.uuid, created_at: before.created_at, is_enable: true, allow_line: true })
  })

  test('overlapping initial saves retain one record', async () => {
    await Promise.all(Array.from({ length: 8 }, () => repo.saveBookmarkShare('', 10, 42, true, true, true)))
    expect(await rows()).toHaveLength(1)
  })

  test('keeps different owners separate and binds share codes as parameters', async () => {
    const code = "code'); DROP TABLE sr_bookmark_share; --"
    await repo.saveBookmarkShare(code, 10, 42, true, true, true)
    await repo.saveBookmarkShare('', 20, 42, false, false, false)
    expect(await rows()).toHaveLength(2)
    expect((await rows())[0].share_code).toBe(code)
    expect(statements[0]).not.toContain(code)
  })
})
