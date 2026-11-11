import { describe, test, expect, vi } from 'vitest'

import { ShareService } from '@/domain/share'
import { createMockCtx } from '@test/helpers/mockFactory'

const sharedRow = (overrides: Record<string, unknown> = {}) => ({
  allow_comment: true,
  show_comment: true,
  show_userinfo: false,
  share_code: '',
  ...overrides
})
const req = (overrides: Record<string, unknown> = {}) => ({
  show_comment_line: true,
  show_userinfo: false,
  allow_action: true,
  ...overrides
})
function wire() {
  const repo = {
    getUserBookmarkByUId: vi.fn().mockResolvedValue({ bookmark_id: 42, user_id: 10 }),
    getUserBookmark: vi.fn().mockResolvedValue({ bookmark_id: 42, user_id: 10 }),
    getBookmarkById: vi.fn().mockResolvedValue({ id: 42, moderation_result: 0 }),
    getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue(null),
    createBookmarkShare: vi.fn().mockRejectedValue(new Error('duplicate bookmark_id, user_id')),
    saveBookmarkShare: vi.fn().mockResolvedValue(sharedRow())
  }
  const svc = new ShareService(repo as never, {} as never)
  return { svc, repo }
}

describe('ShareService.updateBookmarkShare', () => {
  test('saves through an atomic write despite a stale absent share result', async () => {
    const { svc, repo } = wire()
    const result = await svc.updateBookmarkShare(createMockCtx({ userId: 10 }), req({ bookmark_uid: 'bm-uuid' }))
    expect(repo.getUserBookmarkByUId).toHaveBeenCalledWith('bm-uuid', 10)
    expect(repo.saveBookmarkShare).toHaveBeenCalledWith('', 10, 42, true, false, true)
    expect(repo.getBookmarkShareByBookmarkId).not.toHaveBeenCalled()
    expect(repo.createBookmarkShare).not.toHaveBeenCalled()
    expect(result).toEqual({ allow_action: true, show_comment_line: true, show_userinfo: false, share_code: '' })
  })

  test('immediately saves off then on without an existence read', async () => {
    const { svc, repo } = wire()
    repo.saveBookmarkShare.mockResolvedValueOnce(sharedRow({ allow_comment: false, show_comment: false }))
    const ctx = createMockCtx({ userId: 10 })
    const closed = await svc.updateBookmarkShare(ctx, req({ bookmark_uid: 'bm-uuid', allow_action: false, show_comment_line: false }))
    const opened = await svc.updateBookmarkShare(ctx, req({ bookmark_uid: 'bm-uuid' }))
    expect(closed.allow_action).toBe(false)
    expect(opened.allow_action).toBe(true)
    expect(repo.saveBookmarkShare).toHaveBeenNthCalledWith(1, '', 10, 42, false, false, false)
    expect(repo.saveBookmarkShare).toHaveBeenNthCalledWith(2, '', 10, 42, true, false, true)
    expect(repo.getBookmarkShareByBookmarkId).not.toHaveBeenCalled()
  })

  test('rejects a UID that does not belong to the current user', async () => {
    const { svc, repo } = wire()
    repo.getUserBookmarkByUId.mockResolvedValue(null as never)
    await expect(svc.updateBookmarkShare(createMockCtx({ userId: 10 }), req({ bookmark_uid: 'missing' }))).rejects.toMatchObject({ errCode: 404 })
    expect(repo.saveBookmarkShare).not.toHaveBeenCalled()
  })

  test('rejects an invalid legacy ID', async () => {
    const { svc, repo } = wire()
    await expect(svc.updateBookmarkShare(createMockCtx({ userId: 10 }), req({ bookmark_id: 0 }))).rejects.toThrow()
    expect(repo.saveBookmarkShare).not.toHaveBeenCalled()
  })

  test('rejects a missing owner bookmark', async () => {
    const { svc, repo } = wire()
    repo.getUserBookmark.mockResolvedValue(null as never)
    await expect(svc.updateBookmarkShare(createMockCtx({ userId: 10 }), req({ bookmark_id: 42 }))).rejects.toMatchObject({ errCode: 404 })
    expect(repo.saveBookmarkShare).not.toHaveBeenCalled()
  })

  test('generates a legacy insertion candidate but returns the saved share code', async () => {
    const { svc, repo } = wire()
    repo.saveBookmarkShare.mockResolvedValue(sharedRow({ share_code: 'kept-code' }))
    const digest = vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new Uint8Array(16).buffer)
    try {
      const result = await svc.updateBookmarkShare(createMockCtx({ userId: 10 }), req({ bookmark_id: 42 }))
      const [code, userId, bookmarkId] = repo.saveBookmarkShare.mock.calls[0]
      expect(code).toMatch(/^TC.+/)
      expect([userId, bookmarkId]).toEqual([10, 42])
      expect(result.share_code).toBe('kept-code')
      expect(repo.getBookmarkShareByBookmarkId).not.toHaveBeenCalled()
    } finally {
      digest.mockRestore()
    }
  })

  test('propagates database errors instead of reporting a missing bookmark', async () => {
    const { svc, repo } = wire()
    const error = new Error('database unavailable')
    repo.saveBookmarkShare.mockRejectedValue(error)
    await expect(svc.updateBookmarkShare(createMockCtx({ userId: 10 }), req({ bookmark_uid: 'bm-uuid' }))).rejects.toBe(error)
  })

  test('rejects moderated content without writing share settings', async () => {
    const { svc, repo } = wire()
    repo.getBookmarkById.mockResolvedValue({ id: 42, moderation_result: 1 })
    await expect(svc.updateBookmarkShare(createMockCtx({ userId: 10 }), req({ bookmark_uid: 'bm-uuid' }))).rejects.toMatchObject({ name: 'SHARE_CONTENT_NOT_SUPPORTED' })
    expect(repo.saveBookmarkShare).not.toHaveBeenCalled()
  })
})
