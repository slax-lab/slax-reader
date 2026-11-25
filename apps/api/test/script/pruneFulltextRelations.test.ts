import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { currentRelationsQuery, pruneSql, staleMirrorRows } from '../../script/prune-fulltext-relations'

let pg: PGlite

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`CREATE TABLE sr_user_bookmark (id serial PRIMARY KEY, user_id int NOT NULL, bookmark_id int NOT NULL, deleted_at timestamptz);
    INSERT INTO sr_user_bookmark (user_id, bookmark_id, deleted_at) VALUES (1, 10, NULL), (1, 11, now()), (2, 20, NULL);`)
})
afterAll(async () => pg?.close())

describe('fulltext relation mirror pruning', () => {
  test('keeps current and trashed relations and selects only rows PostgreSQL no longer has', async () => {
    const mirror = [
      { user_id: 1, bookmark_id: 10 },
      { user_id: 1, bookmark_id: 11 },
      { user_id: 1, bookmark_id: 12 },
      { user_id: 2, bookmark_id: 20 },
      { user_id: 3, bookmark_id: 30 }
    ]
    const { rows } = await pg.query<{ user_id: number; bookmark_id: number }>(currentRelationsQuery, [[1, 2, 3]])
    expect(staleMirrorRows(mirror, rows)).toEqual([
      { user_id: 1, bookmark_id: 12 },
      { user_id: 3, bookmark_id: 30 }
    ])
  })

  test('writes per-user batched deletes and rejects non-integer identities', () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({ user_id: 7, bookmark_id: 100 + index }))
    expect(pruneSql(rows, 2)).toBe(
      'DELETE FROM slax_user_bookmark WHERE user_id = 7 AND bookmark_id IN (100,101);\nDELETE FROM slax_user_bookmark WHERE user_id = 7 AND bookmark_id IN (102);\n'
    )
    expect(pruneSql([])).toBe('')
    expect(() => pruneSql([{ user_id: 1, bookmark_id: '1; DROP TABLE x' as unknown as number }])).toThrow('invalid_mirror_row')
  })
})
