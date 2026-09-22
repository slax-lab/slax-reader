import { describe, expect, test, vi } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { MarkService } from '@/domain/mark'
import { BookmarkController } from '@/handler/http/bookmarkController'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { createMockCtx } from '@test/helpers/mockFactory'

function wire() {
  const bookmark = { id: 5, uuid: 'uuid', bookmark_id: 42, user_id: 10, deleted_at: null, bookmark: { private_user: 10, moderation_result: 0, content_key: 'secret' } }
  const repo = {
    getUserBookmarkByUuidWithDetail: vi.fn().mockResolvedValue(bookmark),
    getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue(null),
    getUserBookmarkWithDetail: vi.fn().mockResolvedValue(null),
    getBookmarkById: vi.fn()
  }
  const userRepo = { getInfoByUserId: vi.fn().mockResolvedValue({ snapshot_sharing: true }), getUserInfoList: vi.fn().mockResolvedValue([{ uuid: 'person', name: 'name', picture: 'avatar' }]) }
  const bucket = { R2Bucket: { get: vi.fn().mockImplementation(async () => ({ body: new Blob(['public content']).stream() })) } }
  const service = new (BookmarkService as any)(repo, () => bucket, undefined, undefined, undefined, userRepo) as BookmarkService
  const markRepo = { getDistinctUserIdsByUserBookmarkUuid: vi.fn().mockResolvedValue([10]) }
  const markService = new MarkService(repo as any, markRepo as any, {} as any, userRepo as any)
  return { service, markService, repo, userRepo, bucket, bookmark, markRepo }
}

describe('bookmark content and participant access', () => {
  test.each(['missing', 'deleted', 'moderated', 'disabled', 'global-off'])('rejects %s before R2 or participant queries', async reason => {
    const { service, markService, repo, userRepo, bucket, bookmark, markRepo } = wire()
    if (reason === 'missing') repo.getUserBookmarkByUuidWithDetail.mockResolvedValue(null)
    if (reason === 'deleted') repo.getUserBookmarkByUuidWithDetail.mockResolvedValue({ ...bookmark, deleted_at: new Date() })
    if (reason === 'moderated') repo.getUserBookmarkByUuidWithDetail.mockResolvedValue({ ...bookmark, bookmark: { ...bookmark.bookmark, moderation_result: 1 } })
    if (reason === 'disabled') repo.getBookmarkShareByBookmarkId.mockResolvedValue({ is_enable: false })
    if (reason === 'global-off') userRepo.getInfoByUserId.mockResolvedValue({ snapshot_sharing: false })
    for (const userId of [0, 20]) {
      const ctx = createMockCtx({ userId })
      expect(await service.getStreamBookmarkContent(ctx, 'uuid')).toBeNull()
      await expect(markService.getMarkUsersByUserBookmarkUuid(ctx, 'uuid')).rejects.toBeTruthy()
    }
    expect(bucket.R2Bucket.get).not.toHaveBeenCalled()
    expect(markRepo.getDistinctUserIdsByUserBookmarkUuid).not.toHaveBeenCalled()
  })

  test('owner can still read trashed, moderated content when sharing is disabled', async () => {
    const { service, repo, bucket, bookmark } = wire()
    repo.getUserBookmarkByUuidWithDetail.mockResolvedValue({ ...bookmark, deleted_at: new Date(), bookmark: { ...bookmark.bookmark, moderation_result: 1 } })
    repo.getBookmarkShareByBookmarkId.mockResolvedValue({ is_enable: false })
    const stream = await service.getStreamBookmarkContent(createMockCtx({ userId: 10 }), 'uuid')
    expect(await new Response(stream).text()).toBe('public content')
    expect(bucket.R2Bucket.get).toHaveBeenCalledWith('secret')
    expect(repo.getBookmarkShareByBookmarkId).not.toHaveBeenCalled()
  })

  test('preserves explicit article sharing overriding the global default', async () => {
    const { service, repo, userRepo } = wire()
    repo.getBookmarkShareByBookmarkId.mockResolvedValue({ is_enable: true })
    userRepo.getInfoByUserId.mockResolvedValue({ snapshot_sharing: false })
    const stream = await service.getStreamBookmarkContent(createMockCtx({ userId: 0 }), 'uuid')
    expect(await new Response(stream).text()).toBe('public content')
  })

  test.each(['show_line', 'show_comment', 'show_userinfo'])('hides participants when %s is off even with interaction allowed', async field => {
    const { markService, repo, markRepo } = wire()
    repo.getBookmarkShareByBookmarkId.mockResolvedValue({ is_enable: true, show_line: true, show_comment: true, show_userinfo: true, allow_line: true, allow_comment: true, [field]: false })
    expect(await markService.getMarkUsersByUserBookmarkUuid(createMockCtx({ userId: 20 }), 'uuid')).toEqual([])
    expect(markRepo.getDistinctUserIdsByUserBookmarkUuid).not.toHaveBeenCalled()
  })

  test('keeps global public snapshots accessible through the real content controller', async () => {
    const { service } = wire()
    const controller = new (BookmarkController as any)()
    controller.bookmarkService = service
    const response = await controller.handleStreamBookmarkContent(createMockCtx({ userId: 0 }), new Request('https://test/v1/bookmark/content', { method: 'POST', body: JSON.stringify({ bookmark_uid: 'uuid' }) }))
    expect(await response.text()).toBe('public content')
  })

  test('content controller does not return body after sharing is revoked', async () => {
    const { service, userRepo, bucket } = wire()
    userRepo.getInfoByUserId.mockResolvedValue({ snapshot_sharing: false })
    const controller = new (BookmarkController as any)()
    controller.bookmarkService = service
    const response = await controller.handleStreamBookmarkContent(createMockCtx({ userId: 20 }), new Request('https://test/v1/bookmark/content', { method: 'POST', body: JSON.stringify({ bookmark_uid: 'uuid' }) }))
    expect(await response.text()).not.toContain('public content')
    expect(bucket.R2Bucket.get).not.toHaveBeenCalled()
  })

  test('guessed bmId cannot read markdown through getBookmarkTitleContent', async () => {
    const { service, repo, bucket } = wire()
    await expect(service.getBookmarkTitleContent(createMockCtx({ userId: 20 }), { bmId: 42 })).rejects.toBeTruthy()
    expect(repo.getBookmarkById).not.toHaveBeenCalled()
    expect(bucket.R2Bucket.get).not.toHaveBeenCalled()
  })
})

describe('collection bookmark binding', () => {
  test('requires an active matching collection and a live starred bookmark', async () => {
    const bookmark = { id: 5, user_id: 10, bookmark_id: 42, uuid: 'uuid', bookmark: {} }
    const db = { sr_user_bookmark: { findFirst: vi.fn().mockResolvedValue(bookmark) }, sr_user: { findFirst: vi.fn().mockResolvedValue({ id: 10 }) }, sr_user_collection: { findFirst: vi.fn().mockResolvedValue(null) } }
    const repo = Object.create(BookmarkRepo.prototype) as BookmarkRepo
    ;(repo as any).prismaPg = () => db
    expect(await repo.getCollectionBookmarkById(5, 'wrong')).toBeNull()
    expect(db.sr_user_bookmark.findFirst).toHaveBeenCalledWith({ where: { id: 5, is_starred: true, deleted_at: null }, include: { bookmark: true } })
    expect(db.sr_user_collection.findFirst).toHaveBeenCalledWith({ where: { owner_id: 10, collection_code: 'wrong' } })
    db.sr_user_collection.findFirst.mockResolvedValue({ id: 1, status: 1 } as never)
    expect(await repo.getCollectionBookmarkById(5, 'correct')).toBe(bookmark)
    db.sr_user_bookmark.findFirst.mockResolvedValue(null)
    expect(await repo.getCollectionBookmarkById(5, 'correct')).toBeNull()
  })
})
