import { describe, test, expect, vi } from 'vitest'
import { ShareService } from '@/domain/share'
import { ShareController } from '@/handler/http/shareController'
import { createMockCtx } from '@test/helpers/mockFactory'

function wire() {
  const bookmark = { uuid: 'bm-uuid', bookmark_id: 42, user_id: 10, deleted_at: null, bookmark: { moderation_result: 0 } }
  const share = { is_enable: true, allow_comment: true, show_comment: true, show_userinfo: true, share_code: 'abc123', user_id: 10 }
  const owner = { snapshot_sharing: true, deleted_at: null }
  const repo = {
    getUserBookmarkByUuidWithDetail: vi.fn().mockResolvedValue(bookmark),
    getUserBookmark: vi.fn().mockResolvedValue(bookmark),
    getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue(share)
  }
  const users = { getInfoByUserId: vi.fn().mockResolvedValue(owner) }
  const svc = new ShareService(repo as never, users as never)
  const controller = new ShareController(svc, {} as never)
  return { svc, controller, repo, users, bookmark, share, owner }
}

const query = () => new Request('https://test/v1/share/exists?bookmark_uid=bm-uuid')

describe('ShareService.checkBookmarkShareExists authorization', () => {
  test.each([0, 20])('authorized public viewer %s receives flags through controller', async userId => {
    const { controller, repo } = wire()
    const response = await controller.existsShare(createMockCtx({ userId }), query())
    const payload = await response.text()
    expect(payload).toContain('abc123')
    expect(payload).toContain('"show_comment_line":true')
    expect(repo.getBookmarkShareByBookmarkId).toHaveBeenCalledWith(42, 10)
  })

  test.each(['missing', 'deleted', 'moderated', 'disabled', 'global-off', 'owner-deleted', 'owner-missing'])('denies %s without returning share code', async reason => {
    const { controller, repo, users, bookmark, share, owner } = wire()
    if (reason === 'missing') repo.getUserBookmarkByUuidWithDetail.mockResolvedValue(null)
    if (reason === 'deleted') repo.getUserBookmarkByUuidWithDetail.mockResolvedValue({ ...bookmark, deleted_at: new Date() })
    if (reason === 'moderated') repo.getUserBookmarkByUuidWithDetail.mockResolvedValue({ ...bookmark, bookmark: { moderation_result: 1 } })
    if (reason === 'disabled') repo.getBookmarkShareByBookmarkId.mockResolvedValue({ ...share, is_enable: false })
    if (reason === 'global-off') {
      repo.getBookmarkShareByBookmarkId.mockResolvedValue(null)
      users.getInfoByUserId.mockResolvedValue({ ...owner, snapshot_sharing: false })
    }
    if (reason === 'owner-deleted') users.getInfoByUserId.mockResolvedValue({ ...owner, deleted_at: new Date() })
    if (reason === 'owner-missing') users.getInfoByUserId.mockResolvedValue(null)
    for (const userId of [0, 20]) await expect(controller.existsShare(createMockCtx({ userId }), query())).rejects.toBeTruthy()
  })

  test('explicit share overrides the live owner global default', async () => {
    const { svc, users, owner } = wire()
    users.getInfoByUserId.mockResolvedValue({ ...owner, snapshot_sharing: false })
    await expect(svc.checkBookmarkShareExists(createMockCtx({ userId: 0 }), { bmUId: 'bm-uuid' })).resolves.toMatchObject({ share_code: 'abc123' })
  })

  test.each([0, 10])('public global snapshot and owner %s retain default flags', async userId => {
    const { svc, repo } = wire()
    repo.getBookmarkShareByBookmarkId.mockResolvedValue(null)
    await expect(svc.checkBookmarkShareExists(createMockCtx({ userId }), { bmUId: 'bm-uuid' })).resolves.toEqual({ allow_action: true, show_comment_line: true, show_userinfo: true, share_code: '' })
  })

  test('owner can edit disabled sharing even for trashed or moderated bookmarks', async () => {
    const { svc, repo, bookmark, share, users } = wire()
    repo.getUserBookmarkByUuidWithDetail.mockResolvedValue({ ...bookmark, deleted_at: new Date(), bookmark: { moderation_result: 1 } })
    repo.getBookmarkShareByBookmarkId.mockResolvedValue({ ...share, is_enable: false })
    await expect(svc.checkBookmarkShareExists(createMockCtx({ userId: 10 }), { bmUId: 'bm-uuid' })).resolves.toEqual({ allow_action: false, show_comment_line: false, show_userinfo: false, share_code: '' })
    expect(users.getInfoByUserId).not.toHaveBeenCalled()
  })

  test('legacy numeric ID is decoded and requires current user ownership', async () => {
    const { svc, repo } = wire()
    const ctx = createMockCtx({ userId: 10, hashIds: { decodeId: vi.fn(() => 42) } })
    await expect(svc.checkBookmarkShareExists(ctx, { bmId: '999' as never })).resolves.toMatchObject({ share_code: 'abc123' })
    expect(repo.getUserBookmark).toHaveBeenCalledWith(42, 10)
    expect(ctx.hashIds.decodeId).toHaveBeenCalledWith('999')
    repo.getUserBookmark.mockResolvedValue(null)
    await expect(svc.checkBookmarkShareExists(ctx, { bmId: 999 })).rejects.toBeTruthy()
    await expect(svc.checkBookmarkShareExists(createMockCtx({ userId: 0 }), { bmId: 999 })).rejects.toBeTruthy()
    await expect(svc.checkBookmarkShareExists(ctx, {})).rejects.toBeTruthy()
  })
})
