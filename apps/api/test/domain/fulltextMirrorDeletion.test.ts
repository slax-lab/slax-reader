import { describe, expect, test, vi } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { bookmarkParseStatus } from '@/infra/repository/dbBookmark'

function service(bookmarkRepo: object, bookmarkSearchRepo: object) {
  return Object.assign(Object.create(BookmarkService.prototype), { bookmarkRepo, bookmarkData: bookmarkRepo, bookmarkSearchRepo }) as BookmarkService
}

describe('fulltext relation mirror follows PostgreSQL relation deletes', () => {
  test('the import-failure batch delete removes the mirror rows of every batch', async () => {
    const ids = Array.from({ length: 51 }, (_, index) => index + 1)
    const repo = { validateImportBookmarkIds: vi.fn().mockResolvedValue(ids), batchDeleteBookmarksByIds: vi.fn().mockResolvedValue(undefined) }
    const search = { deleteUserBookmarks: vi.fn().mockResolvedValue(0) }
    await service(repo, search).batchDeleteFailedImportBookmarkRelations(7, 3, ids, false)
    expect(search.deleteUserBookmarks.mock.calls).toEqual([
      [7, ids.slice(0, 50)],
      [7, ids.slice(50)]
    ])
  })

  test('covering a failed bookmark removes its mirror row with the relation', async () => {
    const repo = {
      getBookmark: vi.fn().mockResolvedValue({ bookmark_id: 42, status: bookmarkParseStatus.FAILED }),
      deleteUserBookmark: vi.fn().mockResolvedValue(null)
    }
    const search = { deleteUserBookmark: vi.fn().mockResolvedValue(1) }
    await service(repo, search).checkAndCoverFailBookmark('https://example.com', 7, 0)
    expect(repo.deleteUserBookmark).toHaveBeenCalledWith(42, 7)
    expect(search.deleteUserBookmark).toHaveBeenCalledWith(7, 42)
  })

  test('a successful bookmark is not covered', async () => {
    const repo = { getBookmark: vi.fn().mockResolvedValue({ bookmark_id: 42, status: bookmarkParseStatus.SUCCESS }), deleteUserBookmark: vi.fn() }
    const search = { deleteUserBookmark: vi.fn() }
    await service(repo, search).checkAndCoverFailBookmark('https://example.com', 7, 0)
    expect(repo.deleteUserBookmark).not.toHaveBeenCalled()
    expect(search.deleteUserBookmark).not.toHaveBeenCalled()
  })
})
