import { describe, expect, test } from 'vitest'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'

function state() {
  const bookmarks = [
    { id: 1, private_user: 7, write_version: 3 },
    { id: 2, private_user: 7, write_version: 4 },
    { id: 3, private_user: 7, write_version: 2 },
    { id: 4, private_user: 0, write_version: 0 }
  ]
  let relations = [
    { id: 10, user_id: 7, bookmark_id: 1, import_id: 90, created_target: false, write_version: 3, status: 0 },
    { id: 11, user_id: 7, bookmark_id: 2, import_id: 90, created_target: true, write_version: 3, status: 0 },
    { id: 12, user_id: 7, bookmark_id: 3, import_id: 90, created_target: true, write_version: 2, status: 0 },
    { id: 13, user_id: 7, bookmark_id: 4, import_id: 90, created_target: null, write_version: null, status: 0 },
    { id: 14, user_id: 7, bookmark_id: 3, import_id: 91, created_target: false, write_version: 2, status: 0 }
  ]
  let saved = [1, 2, 3, 4]
  const selected = (row: any, where: any) => Object.entries(where).every(([key, value]: any) => value && typeof value === 'object' ? value.in.includes(row[key]) : row[key] === value)
  const db: any = {
    $queryRaw: async (_strings: TemplateStringsArray, ...args: any[]) => bookmarks.filter(row => args.includes(row.id)),
    $executeRaw: async () => 1,
    sr_bookmark_import_relation: {
      findMany: async ({ where }: any) => relations.filter(row => selected(row, where)),
      findFirst: async ({ where }: any) => relations.find(row => selected(row, where)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: Math.max(...relations.map(item => item.id)) + 1, status: 0, write_version: null, created_target: null, ...data }
        relations.push(row)
        return row
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0
        relations = relations.map(row => { if (!selected(row, where)) return row; count++; return { ...row, ...data } })
        return { count }
      },
      deleteMany: async ({ where }: any) => { relations = relations.filter(row => !selected(row, where)); return { count: 1 } }
    },
    sr_user_bookmark: {
      deleteMany: async ({ where }: any) => { saved = saved.filter(id => !where.bookmark_id.in.includes(id)); return { count: 1 } }
    },
    sr_user_delete_bookmark: { deleteMany: async () => ({ count: 0 }) },
    sr_user_bookmark_tag: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(db)
  }
  const repo = Object.assign(Object.create(BookmarkRepo.prototype), { clientPg: () => db }) as BookmarkRepo
  return { repo, saved: () => saved, relations: () => relations }
}

describe('import lifecycle ownership', () => {
  test('retains separate accepted versions of a duplicate URL within one import while reusing retries', async () => {
    const s = state()
    const original = await s.repo.createBookmarkImportRelation(7, 99, 90, { version: 2, createdTarget: true })
    const later = await s.repo.createBookmarkImportRelation(7, 99, 90, { version: 3, createdTarget: false })
    const replay = await s.repo.createBookmarkImportRelation(7, 99, 90, { version: 3, createdTarget: false })
    expect(later.id).not.toBe(original.id)
    expect(replay.id).toBe(later.id)
    expect(s.relations().filter(row => row.bookmark_id === 99 && row.import_id === 90)).toHaveLength(2)
    expect(await s.repo.updateBookmarkImportRelationStatus(7, 99, 90, 2, 2)).toBe(true)
    expect(await s.repo.updateBookmarkImportRelationStatus(7, 99, 90, 1, 3)).toBe(true)
    expect(s.relations().find(row => row.id === later.id)?.status).toBe(1)
  })

  test('keeps a legacy unversioned relation separate from later accepted writes', async () => {
    const s = state()
    const legacy = await s.repo.createBookmarkImportRelation(7, 99, 90)
    const versioned = await s.repo.createBookmarkImportRelation(7, 99, 90, { version: 2, createdTarget: true })
    expect(legacy.write_version).toBeNull()
    expect(versioned.id).not.toBe(legacy.id)
    expect(await s.repo.updateBookmarkImportRelationStatus(7, 99, 90, 2)).toBe(true)
    expect(s.relations().find(row => row.id === versioned.id)?.status).toBe(0)
  })
  test('undo preserves pre-existing bookmarks and later re-saves while deleting only the current task additions', async () => {
    const s = state()
    await s.repo.batchDeleteBookmarksByIds(7, [1, 2, 3, 4], 90)
    expect(s.saved()).toEqual([1, 2])
    expect(s.relations()).toEqual([expect.objectContaining({ import_id: 91 })])
  })

  test('settles each accepted import version once and never changes another task', async () => {
    const s = state()
    expect(await s.repo.updateBookmarkImportRelationStatus(7, 3, 90, 1, 2)).toBe(true)
    expect(await s.repo.updateBookmarkImportRelationStatus(7, 3, 90, 1, 2)).toBe(false)
    expect(await s.repo.updateBookmarkImportRelationStatus(7, 3, 90, 2, 2)).toBe(false)
    expect(s.relations().find(row => row.import_id === 91)?.status).toBe(0)
  })

  test('does not settle an import row from a different accepted version', async () => {
    const s = state()
    expect(await s.repo.updateBookmarkImportRelationStatus(7, 2, 90, 2, 2)).toBe(false)
    expect(s.relations().find(row => row.bookmark_id === 2)?.status).toBe(0)
  })
})
