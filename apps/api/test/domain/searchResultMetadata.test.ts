import {describe, expect, test, vi} from 'vitest'
import {BookmarkRepo} from '@/infra/repository/dbBookmark'

describe('search result metadata projection', () => {
  test('adds URL and the user save time only to the final batched admission lookup', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const repo = new BookmarkRepo((() => ({})) as never, (() => ({sr_user_bookmark: {findMany}})) as never)
    await repo.getSearchEligibleBookmarks(7)
    expect(findMany).toHaveBeenLastCalledWith({where: {user_id: 7, deleted_at: null, AND: []}, select: {bookmark_id: true, uuid: true}})
    await repo.getSearchEligibleBookmarks(7, [], [11, 12])
    expect(findMany).toHaveBeenLastCalledWith({
      where: {user_id: 7, deleted_at: null, bookmark_id: {in: [11, 12]}, AND: []},
      select: {bookmark_id: true, uuid: true, created_at: true, bookmark: {select: {target_url: true}}}
    })
  })
})
