import { describe, expect, it, vi } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { createMockCtx } from '../helpers/mockFactory'

function setup() {
  const bookmarkRepo = {
    getBookmarkForkForVersion: vi.fn().mockResolvedValue({
      source_uuid: 'source-uuid',
      show_userinfo: true,
      display_name: 'Alice',
      source_user_id: 7
    })
  }
  const service = Object.assign(Object.create(BookmarkService.prototype), { bookmarkRepo }) as BookmarkService
  return { service, bookmarkRepo }
}

describe('BookmarkService.getForkInfo', () => {
  it('does not query lineage for legacy bookmarks without a published version', async () => {
    const { service, bookmarkRepo } = setup()

    await expect(service.getForkInfo(10, createMockCtx(), 0)).resolves.toBeNull()
    expect(bookmarkRepo.getBookmarkForkForVersion).not.toHaveBeenCalled()
  })

  it('loads lineage for a versioned bookmark', async () => {
    const { service, bookmarkRepo } = setup()
    const ctx = createMockCtx()

    await expect(service.getForkInfo(10, ctx, 3)).resolves.toEqual({
      bookmark_uid: 'source-uuid',
      display_name: 'Alice',
      user_id: 'enc_7'
    })
    expect(bookmarkRepo.getBookmarkForkForVersion).toHaveBeenCalledWith(10, 3)
  })
})
