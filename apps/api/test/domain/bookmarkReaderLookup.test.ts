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

  it('uses the separate Reader receipt path without readiness lookup', async () => {
    const saveReceipt = vi.fn().mockResolvedValue(true)
    const lookup = vi.fn()
    const hasActiveSave = vi.fn()
    const service = Object.assign(Object.create(BookmarkService.prototype), { forkService: { saveReceipt, lookup }, bookmarkRepo: { hasActiveSave } }) as BookmarkService
    const ctx = createMockCtx()
    ctx.env.FRONT_END_URL = 'https://reader.test'
    expect(await service.saveReceipt(ctx, 'https://reader.test/b/1ac0b3d6-3b65-4d6b-8412-6dcccb903adc?shared=1')).toBe(true)
    expect(saveReceipt).toHaveBeenCalledWith(ctx, '1ac0b3d6-3b65-4d6b-8412-6dcccb903adc')
    expect(lookup).not.toHaveBeenCalled()
    expect(hasActiveSave).not.toHaveBeenCalled()
  })

  it.each([
    ['https://x.com/user/status/123?s=20', 'https://x.com/user/status/123'],
    ['https://x.com/user/status/123?s=20&ref=home', 'https://x.com/user/status/123?ref=home'],
    ['https://twitter.com/user/status/456?s=20', 'https://twitter.com/user/status/456'],
    ['https://mp.weixin.qq.com/s?__biz=MzA3&mid=123&poc_token=temporary', 'https://mp.weixin.qq.com/s?__biz=MzA3&mid=123'],
    ['https://example.com/page?id=1&ref=home', 'https://example.com/page?id=1&ref=home'],
    ['https://www.example.com/page', 'https://www.example.com/page']
  ])('uses creation normalization for %s', async (input, expected) => {
    const hasActiveSave = vi.fn().mockResolvedValue(true)
    const resolveFinalUrl = vi.fn()
    const service = Object.assign(Object.create(BookmarkService.prototype), { bookmarkRepo: { hasActiveSave }, crawlService: { resolveFinalUrl } }) as BookmarkService
    const ctx = createMockCtx()
    expect(await service.saveReceipt(ctx, input)).toBe(true)
    expect(hasActiveSave).toHaveBeenCalledExactlyOnceWith(ctx.getUserId(), expected)
    expect(resolveFinalUrl).not.toHaveBeenCalled()
  })

  it('preserves ordinary legacy exists results for a trashed relation', async () => {
    const getBookmark = vi.fn().mockResolvedValue({ bookmark_id: 22 })
    const getUserBookmark = vi.fn().mockResolvedValue({ uuid: 'trashed', deleted_at: new Date() })
    const hasActiveSave = vi.fn().mockResolvedValue(false)
    const service = Object.assign(Object.create(BookmarkService.prototype), { bookmarkRepo: { getBookmark, getUserBookmark, hasActiveSave } }) as BookmarkService
    const ctx = createMockCtx()
    expect(await service.bookmarkExists(ctx, 'https://example.com/page')).toMatchObject({ exists: true, bookmark_uid: 'trashed' })
    expect(await service.saveReceipt(ctx, 'https://example.com/page')).toBe(false)
    expect(getUserBookmark).toHaveBeenCalledExactlyOnceWith(22, ctx.getUserId())
  })

  it('does not disguise a repository failure as an absent receipt', async () => {
    const error = new Error('database unavailable')
    const service = Object.assign(Object.create(BookmarkService.prototype), { bookmarkRepo: { hasActiveSave: vi.fn().mockRejectedValue(error) } }) as BookmarkService
    await expect(service.saveReceipt(createMockCtx(), 'https://example.com/page')).rejects.toBe(error)
  })
})
