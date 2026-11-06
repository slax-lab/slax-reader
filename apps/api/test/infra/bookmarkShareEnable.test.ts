import { describe, expect, test, vi } from 'vitest'
import { BookmarkRepo } from '../../src/infra/repository/dbBookmark'

function setup() {
  const update = vi.fn()
  const create = vi.fn()
  const prisma = { sr_bookmark_share: { update, create } }
  const repo = new (BookmarkRepo as any)(() => null, () => prisma) as BookmarkRepo
  return { repo, update, create }
}

describe('BookmarkRepo.updateBookmarkShareIsEnable', () => {
  test('disabling a missing share is an idempotent no-op and never creates one', async () => {
    const { repo, update, create } = setup()
    update.mockRejectedValue({ code: 'P2025' })
    await expect(repo.updateBookmarkShareIsEnable(12, 7, false)).resolves.toBeNull()
    expect(update).toHaveBeenCalledExactlyOnceWith({
      where: { bookmark_id_user_id: { bookmark_id: 12, user_id: 7 } },
      data: { is_enable: false }
    })
    expect(create).not.toHaveBeenCalled()
  })

  test('disabling an existing share returns the updated record unchanged', async () => {
    const { repo, update, create } = setup()
    const record = { id: 5, bookmark_id: 12, user_id: 7, is_enable: false }
    update.mockResolvedValue(record)
    await expect(repo.updateBookmarkShareIsEnable(12, 7, false)).resolves.toBe(record)
    expect(update).toHaveBeenCalledWith({ where: { bookmark_id_user_id: { bookmark_id: 12, user_id: 7 } }, data: { is_enable: false } })
    expect(create).not.toHaveBeenCalled()
  })

  test('enabling an existing share returns the updated record', async () => {
    const { repo, update, create } = setup()
    const record = { id: 5, bookmark_id: 12, user_id: 7, is_enable: true }
    update.mockResolvedValue(record)
    await expect(repo.updateBookmarkShareIsEnable(12, 7, true)).resolves.toBe(record)
    expect(update).toHaveBeenCalledWith({ where: { bookmark_id_user_id: { bookmark_id: 12, user_id: 7 } }, data: { is_enable: true } })
    expect(create).not.toHaveBeenCalled()
  })

  test('enabling a missing share propagates P2025 instead of fabricating a record', async () => {
    const { repo, update, create } = setup()
    const missing = Object.assign(new Error('Record to update not found'), { code: 'P2025' })
    update.mockRejectedValue(missing)
    await expect(repo.updateBookmarkShareIsEnable(12, 7, true)).rejects.toBe(missing)
    expect(create).not.toHaveBeenCalled()
  })

  test.each(['P2002', 'P1001', 'UNKNOWN'])('disabling rethrows non-P2025 %s failures', async code => {
    const { repo, update } = setup()
    const failure = Object.assign(new Error('database failure'), { code })
    update.mockRejectedValue(failure)
    await expect(repo.updateBookmarkShareIsEnable(12, 7, false)).rejects.toBe(failure)
  })

  test('a plain error while disabling is not swallowed', async () => {
    const { repo, update } = setup()
    const failure = new Error('connection reset')
    update.mockRejectedValue(failure)
    await expect(repo.updateBookmarkShareIsEnable(12, 7, false)).rejects.toBe(failure)
  })
})
