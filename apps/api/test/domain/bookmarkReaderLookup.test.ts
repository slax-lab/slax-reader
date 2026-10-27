import { describe, expect, it, vi } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { createMockCtx } from '../helpers/mockFactory'

describe('Reader tab saved-state lookup', () => {
  it('returns the destination UUID for a saved Reader source, without creating another save', async () => {
    const lookup = vi.fn(async () => ({ uuid: 'destination', bookmark_id: 22 }))
    const service = Object.assign(Object.create(BookmarkService.prototype), { forkService: { lookup }, bookmarkRepo: { getBookmark: vi.fn() } }) as BookmarkService
    const ctx = createMockCtx()
    ctx.env.FRONT_END_URL = 'https://reader.test'
    expect(await service.bookmarkExists(ctx, 'https://reader.test/b/1ac0b3d6-3b65-4d6b-8412-6dcccb903adc?shared=1')).toMatchObject({ exists: true, bookmark_uid: 'destination' })
    expect(lookup).toHaveBeenCalledWith(ctx, '1ac0b3d6-3b65-4d6b-8412-6dcccb903adc')
  })
})
