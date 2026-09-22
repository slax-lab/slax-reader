/**
 * snapshot bookmark_uid 兼容：ShareService.updateBookmarkShare
 *
 * 关键改动：
 * 1. 支持 bookmark_uid：按 uuid+当前用户解析 bookmark_id（找不到抛 BookmarkNotFoundError）
 * 2. 经 uid 新建分享时写空 share_code（share_code 后续弃用）；经 bmId 才生成 timeCode+hash
 * 3. Bugfix：updateBookmarkShare 失败时必须 throw（旧代码 return 错误对象会被丢弃，
 *    导致 res=undefined 后取 res.allow_comment 抛 500）
 *
 * 注：经 bmId 的"新建"分支会调用 hashMD5（crypto.subtle MD5），Workers 运行时支持但 Node 不支持，
 * 故此处仅在 uid 分支测试新建（code=''，跳过 MD5），bmId 分支只测更新/校验/错误分支。
 */
import { describe, test, expect, vi } from 'vitest'

import { ShareService } from '@/domain/share'
import { createMockCtx } from '@test/helpers/mockFactory'

const sharedRow = (o: Record<string, any> = {}) => ({
  allow_comment: true,
  show_comment: true,
  show_userinfo: false,
  share_code: '',
  user_id: 10,
  is_enable: true,
  ...o
})

const req = (o: Record<string, any> = {}) => ({
  show_comment_line: true,
  show_userinfo: false,
  allow_action: true,
  ...o
})

function wire() {
  const repo = {
    getUserBookmarkByUId: vi.fn(),
    getUserBookmark: vi.fn().mockResolvedValue({ id: 1, bookmark_id: 42, user_id: 10 }),
    getBookmarkById: vi.fn().mockResolvedValue({ id: 42, moderation_result: 0 }),
    getBookmarkShareByBookmarkId: vi.fn(),
    updateBookmarkShare: vi.fn(),
    createBookmarkShare: vi.fn()
  }
  const svc = new (ShareService as any)()
  ;(svc as any).bookmarkRepo = repo
  return { svc: svc as ShareService, repo }
}

describe('ShareService.updateBookmarkShare', () => {
  test('bookmark_uid 新建分享 → share_code 写空串，按 uuid+用户解析 bmId', async () => {
    const { svc, repo } = wire()
    repo.getUserBookmarkByUId.mockResolvedValue({ id: 1, bookmark_id: 42, user_id: 10 })
    repo.getBookmarkShareByBookmarkId.mockResolvedValue(null) // 尚无分享 → 走 createShare
    repo.createBookmarkShare.mockResolvedValue(sharedRow({ share_code: '' }))

    const res = await svc.updateBookmarkShare(createMockCtx({ userId: 10 }), req({ bookmark_uid: 'bm-uuid' }))

    expect(repo.getUserBookmarkByUId).toHaveBeenCalledWith('bm-uuid', 10)
    // 经 uid 建分享：share_code 传空串
    expect(repo.createBookmarkShare).toHaveBeenCalledWith('', 10, 42, true, false, true)
    expect(repo.updateBookmarkShare).not.toHaveBeenCalled()
    expect(res).toEqual({ allow_action: true, show_comment_line: true, show_userinfo: false, share_code: '' })
  })

  test('bookmark_uid 解析不到 user_bookmark → 抛 BookmarkNotFoundError', async () => {
    const { svc, repo } = wire()
    repo.getUserBookmarkByUId.mockResolvedValue(null)
    await expect(svc.updateBookmarkShare(createMockCtx({ userId: 10 }), req({ bookmark_uid: 'missing' }))).rejects.toThrow()
    expect(repo.getUserBookmark).not.toHaveBeenCalled()
  })

  test('bmId 路径 + 已有自己的分享 → 走更新，不生成 share_code', async () => {
    const { svc, repo } = wire()
    repo.getBookmarkShareByBookmarkId.mockResolvedValue(sharedRow({ user_id: 10 }))
    repo.updateBookmarkShare.mockResolvedValue(sharedRow({ share_code: 'kept-code', show_userinfo: true }))
    const ctx = createMockCtx({ userId: 10, hashIds: { decodeId: vi.fn(() => 42) } })

    const res = await svc.updateBookmarkShare(ctx, req({ bookmark_id: 999 }))

    expect(repo.updateBookmarkShare).toHaveBeenCalledWith(42, 10, true, false, true)
    expect(repo.createBookmarkShare).not.toHaveBeenCalled()
    expect(res).toEqual({ allow_action: true, show_comment_line: true, show_userinfo: true, share_code: 'kept-code' })
  })

  test('bmId 解码 < 1 → 抛 ErrorParam', async () => {
    const { svc } = wire()
    const ctx = createMockCtx({ userId: 10, hashIds: { decodeId: vi.fn(() => 0) } })
    await expect(svc.updateBookmarkShare(ctx, req({ bookmark_id: 0 }))).rejects.toThrow()
  })

  test('用户书签不存在 → 抛 BookmarkNotFoundError', async () => {
    const { svc, repo } = wire()
    repo.getUserBookmark.mockResolvedValue(null)
    const ctx = createMockCtx({ userId: 10, hashIds: { decodeId: vi.fn(() => 42) } })
    await expect(svc.updateBookmarkShare(ctx, req({ bookmark_id: 999 }))).rejects.toThrow()
  })

  test('分享归属他人（share.user_id !== userId）→ 抛 BookmarkNotFoundError', async () => {
    const { svc, repo } = wire()
    repo.getBookmarkShareByBookmarkId.mockResolvedValue(sharedRow({ user_id: 999 }))
    const ctx = createMockCtx({ userId: 10, hashIds: { decodeId: vi.fn(() => 42) } })
    await expect(svc.updateBookmarkShare(ctx, req({ bookmark_id: 999 }))).rejects.toThrow()
  })

  test('Bugfix：更新失败时 throw BookmarkNotFoundError（而非 return 致 res=undefined 取值抛 TypeError）', async () => {
    const { svc, repo } = wire()
    repo.getBookmarkShareByBookmarkId.mockResolvedValue(sharedRow({ user_id: 10 }))
    repo.updateBookmarkShare.mockRejectedValue(new Error('db boom'))
    const ctx = createMockCtx({ userId: 10, hashIds: { decodeId: vi.fn(() => 42) } })

    // 关键：必须抛出领域错误（errCode=404），而不是旧实现 return 后在映射阶段抛的 TypeError。
    // 仅断言 rejects.toThrow() 无法区分两者——旧 bug 也会 reject（TypeError）。
    const err: any = await svc.updateBookmarkShare(ctx, req({ bookmark_id: 999 })).catch((e: any) => e)
    expect(err).toBeDefined()
    expect(err).not.toBeInstanceOf(TypeError)
    expect(err.errCode).toBe(404)
  })

  test('bmId 路径 + 无分享 → 新建并生成非空 share_code（timeCode+hashMD5）', async () => {
    const { svc, repo } = wire()
    repo.getBookmarkShareByBookmarkId.mockResolvedValue(null) // 走 createShare
    repo.createBookmarkShare.mockImplementation(async (code: string) => sharedRow({ share_code: code }))
    // Node 的 WebCrypto 不支持 MD5（仅 Workers 运行时支持），此处打桩 digest 让 createShare 的生成逻辑跑通
    const digestSpy = vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new Uint8Array(16).buffer)
    const ctx = createMockCtx({ userId: 10, hashIds: { decodeId: vi.fn(() => 42), generateTimeCode: vi.fn(() => 'TC') } })

    try {
      const res = await svc.updateBookmarkShare(ctx, req({ bookmark_id: 999 }))

      expect(ctx.hashIds.generateTimeCode).toHaveBeenCalled()
      expect(repo.updateBookmarkShare).not.toHaveBeenCalled()
      // 经 bmId 新建：code = timeCode + md5(...).slice(0,7)，必须非空且以 timeCode 开头
      const [codeArg, userIdArg, bmIdArg] = repo.createBookmarkShare.mock.calls[0]
      expect(codeArg).toMatch(/^TC/)
      expect(codeArg.length).toBeGreaterThan(2)
      expect(userIdArg).toBe(10)
      expect(bmIdArg).toBe(42)
      expect(res.share_code).toBe(codeArg)
    } finally {
      digestSpy.mockRestore()
    }
  })

  test('新建返回空 → 抛 ServerError', async () => {
    const { svc, repo } = wire()
    repo.getUserBookmarkByUId.mockResolvedValue({ id: 1, bookmark_id: 42, user_id: 10 })
    repo.getBookmarkShareByBookmarkId.mockResolvedValue(null)
    repo.createBookmarkShare.mockResolvedValue(null)
    await expect(svc.updateBookmarkShare(createMockCtx({ userId: 10 }), req({ bookmark_uid: 'bm-uuid' }))).rejects.toThrow()
  })

  test('命中内容审核（moderation_result>0）→ 抛 SHARE_CONTENT_NOT_SUPPORTED，不建/不更新分享', async () => {
    const { svc, repo } = wire()
    repo.getBookmarkById.mockResolvedValue({ id: 42, moderation_result: 1 })
    const ctx = createMockCtx({ userId: 10, hashIds: { decodeId: vi.fn(() => 42) } })

    const err: any = await svc.updateBookmarkShare(ctx, req({ bookmark_id: 999 })).catch((e: any) => e)
    expect(err).toBeDefined()
    expect(err.name).toBe('SHARE_CONTENT_NOT_SUPPORTED')
    expect(repo.createBookmarkShare).not.toHaveBeenCalled()
    expect(repo.updateBookmarkShare).not.toHaveBeenCalled()
  })
})
