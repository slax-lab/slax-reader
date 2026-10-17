/**
 * Deleting a bookmark removes its YouTube article reference only when the bookmark row itself is
 * deleted. A shared bookmark from before 2026-08-19 (private_user = 0) is kept for other users,
 * and so is its reference.
 * 来源: src/domain/bookmark.ts deleteBookmark
 */
import { describe, expect, test, vi } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { createMockCtx } from '@test/helpers/mockFactory'

function wire(bookmarkRowDeleted: boolean) {
  const svc = new (BookmarkService as any)() as any
  svc.bookmarkRepo = {
    getUserBookmarkWithDetail: vi.fn().mockResolvedValue({ id: 5, deleted_at: null, bookmark: { target_url: 'https://youtu.be/dQw4w9WgXcQ' } }),
    deleteUserBookmark: vi.fn().mockResolvedValue(undefined),
    createBookmarkChangeLog: vi.fn().mockResolvedValue(undefined),
    deleteBookmarkTry: vi.fn().mockResolvedValue(bookmarkRowDeleted ? { id: 42, content_key: 'html/body/u.html', content_md_key: 'text/body/u.txt' } : null),
    getVectorShard: vi.fn().mockResolvedValue(null),
    deleteBookmarkShare: vi.fn().mockResolvedValue(undefined)
  }
  svc.bookmarkSearchRepo = { deleteUserBookmark: vi.fn().mockResolvedValue(undefined), deleteBookmarkRaw: vi.fn().mockResolvedValue(undefined) }
  svc.markRepo = { deleteByBookmarkId: vi.fn().mockResolvedValue(undefined) }
  svc.notifyMessage = { sendBookmarkChange: vi.fn().mockResolvedValue(undefined) }
  svc.bucket = () => ({ R2Bucket: { delete: vi.fn().mockResolvedValue(undefined) } })
  svc.searchService = { clearSearchCache: vi.fn().mockResolvedValue(undefined) }
  svc.youtubeArticleRepo = { unlinkBookmark: vi.fn().mockResolvedValue(1) }
  return svc
}

async function deleteAndSettle(svc: any) {
  const ctx = createMockCtx({ userId: 1 })
  await svc.deleteBookmark(ctx, 1, 42)
  await Promise.all(ctx.execution.waitUntil.mock.calls.map((c: any[]) => c[0]))
}

describe('deleteBookmark and the YouTube article reference', () => {
  test('bookmark row deleted (private to this user) → reference removed', async () => {
    const svc = wire(true)
    await deleteAndSettle(svc)
    expect(svc.youtubeArticleRepo.unlinkBookmark).toHaveBeenCalledWith(42)
  })

  test('bookmark row kept (shared with others) → reference kept', async () => {
    const svc = wire(false)
    await deleteAndSettle(svc)
    expect(svc.youtubeArticleRepo.unlinkBookmark).not.toHaveBeenCalled()
  })

  test('an unlink failure does not fail the delete', async () => {
    const svc = wire(true)
    svc.youtubeArticleRepo.unlinkBookmark.mockRejectedValue(new Error('pg down'))
    await expect(deleteAndSettle(svc)).resolves.toBeUndefined()
  })
})
