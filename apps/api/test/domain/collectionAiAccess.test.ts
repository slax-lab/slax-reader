import { describe, expect, test, vi } from 'vitest'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { BookmarkService } from '@/domain/bookmark'
import { createMockCtx } from '@test/helpers/mockFactory'

function wire(status = 0) {
  const article = { id: 42, title: 'Article', moderation_result: 0, content_md_key: 'md', target_url: 'https://example.test', private_user: 10 }
  const row = { id: 5, uuid: 'uuid', user_id: 10, bookmark_id: 42, bookmark: article, deleted_at: null, is_starred: true }
  const db = {
    sr_user_bookmark: { findFirst: vi.fn().mockResolvedValue(row) },
    sr_user_collection: { findFirst: vi.fn().mockResolvedValue({ id: 1, status, amount: 0, owner_id: 10 }) },
    sr_user: { findFirst: vi.fn().mockResolvedValue({ id: 10 }) },
    sr_user_collection_subscriber: { findFirst: vi.fn().mockImplementation(async ({ where }) => where.user_id === 20 ? { subscription_end_time: new Date(Date.now() + 60000), is_deleted: false } : null) },
    sr_bookmark_share: { findFirst: vi.fn().mockResolvedValue({ is_enable: true }) }
  }
  const repo = Object.create(BookmarkRepo.prototype) as BookmarkRepo
  ;(repo as any).prismaPg = () => db
  const service = new (BookmarkService as any)(repo, undefined, undefined, undefined, undefined, { getInfoByUserId: async () => ({ snapshot_sharing: true }) }) as BookmarkService
  service.getBookmarkById = vi.fn().mockResolvedValue(article)
  service.getBookmarkContent = vi.fn().mockResolvedValue('markdown')
  return { db, service }
}

describe('AI cbId read authorization', () => {
  test.each([10, 20])('paused free collection preserves owner/existing subscriber %s markdown access', async userId => {
    const { service, db } = wire()
    const result = await service.getBookmarkTitleContent(createMockCtx({ userId }), { cbId: 5, collectionCode: 'collection' })
    expect(result.content).toBe('markdown')
    expect(db.sr_user_collection.findFirst).toHaveBeenCalledWith({ where: { owner_id: 10, collection_code: 'collection' } })
    if (userId === 20) expect(db.sr_user_collection_subscriber.findFirst).toHaveBeenCalledWith({ where: { collection_id: 1, user_id: 20, is_deleted: false, subscription_end_time: { gt: expect.any(Date) } } })
  })

  test.each([0, 30])('paused collection denies visitor %s before reading markdown', async userId => {
    const { service } = wire()
    await expect(service.getBookmarkTitleContent(createMockCtx({ userId }), { cbId: 5, collectionCode: 'collection' })).rejects.toBeTruthy()
    expect(service.getBookmarkContent).not.toHaveBeenCalled()
  })

  test.each(['deleted-owner', 'expired-subscriber', 'disabled-share', 'wrong-code'])('denies %s', async reason => {
    const { service, db } = wire()
    if (reason === 'deleted-owner') db.sr_user.findFirst.mockResolvedValue(null)
    if (reason === 'expired-subscriber') db.sr_user_collection_subscriber.findFirst.mockResolvedValue(null)
    if (reason === 'disabled-share') db.sr_bookmark_share.findFirst.mockResolvedValue({ is_enable: false })
    if (reason === 'wrong-code') db.sr_user_collection.findFirst.mockResolvedValue(null)
    await expect(service.getBookmarkTitleContent(createMockCtx({ userId: 20 }), { cbId: 5, collectionCode: 'collection' })).rejects.toBeTruthy()
    expect(service.getBookmarkContent).not.toHaveBeenCalled()
  })
})
