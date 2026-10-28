import { describe, expect, it, vi } from 'vitest'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'

describe('capture moderation publication ownership', () => {
  it('cannot change a newer admitted capture or disable its share', async () => {
    const oldRevision = new Date('2026-01-01')
    const activeRevision = new Date('2026-01-02')
    const raw = { id: 1, status: 'parseing', updated_at: activeRevision, moderation_result: 0 }
    const update = vi.fn(async ({ data }) => Object.assign(raw, data))
    const updateMany = vi.fn(async ({ where, data }) => {
      if (where.updated_at?.getTime() !== raw.updated_at.getTime() || where.status !== raw.status) return { count: 0 }
      Object.assign(raw, data)
      return { count: 1 }
    })
    const db: any = { sr_bookmark: { update, updateMany }, sr_bookmark_share: { upsert: vi.fn() } }
    db.$transaction = (run: any) => run(db)
    const repo = Object.assign(Object.create(BookmarkRepo.prototype), { clientPg: () => db }) as BookmarkRepo
    expect(await repo.updateBookmarkModerationResult(1, 1, { revision: oldRevision, userId: 2 })).toBe(false)
    expect(raw).toMatchObject({ status: 'parseing', updated_at: activeRevision, moderation_result: 0 })
    expect(db.sr_bookmark_share.upsert).not.toHaveBeenCalled()
  })
})
