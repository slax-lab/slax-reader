/**
 * snapshot bookmark_uid 兼容：ShareOrchestrator.getBookmarkShareMarkListByUid
 *
 * 公开快照页 /b/[id] 通过 bookmark_uid 读取划线列表，权限按 sr_bookmark_share 闸控：
 * - owner（ub.user_id === 当前用户）：直接返回，跳过分享校验
 * - 非 owner：无分享记录需全局快照开启；否则需 is_enable && allow_comment && allow_line && show_comment && show_line
 * - 解析不到 user_bookmark：返回空列表
 * 命中时统一 isShowMarks=true 调 markService.getBookmarkMarkList
 */
import { describe, test, expect, vi } from 'vitest'

import { ShareOrchestrator } from '@/domain/orchestrator/share'
import { createMockCtx } from '@test/helpers/mockFactory'
import { resolveBookmarkReadAccess } from '@/utils/bookmarkAccess'

const EMPTY = { mark_list: [], user_list: [] }
const MARKS = { mark_list: [{ id: 1 }], user_list: [{ id: 9 }] }

const ub = (o: Record<string, any> = {}) => ({ id: 5, user_id: 10, bookmark_id: 42, bookmark: { moderation_result: 0 }, ...o })
const share = (o: Record<string, any> = {}) => ({ is_enable: true, show_comment: true, show_line: true, allow_comment: false, allow_line: false, ...o })

function wire() {
  const bookmarkService = {
    getUserBookmarkByUuidWithDetail: vi.fn(),
    getBookmarkShareByBookmarkId: vi.fn()
  }
  const userRepo = { getInfoByUserId: vi.fn().mockResolvedValue({ snapshot_sharing: true }) }
  const markService = { getBookmarkMarkList: vi.fn().mockResolvedValue(MARKS) }
  const orch = new (ShareOrchestrator as any)()
  ;(orch as any).bookmarkService = {
    getBookmarkReadAccess: (ctx: any, uuid: string) => resolveBookmarkReadAccess(bookmarkService as any, userRepo as any, ctx.getUserId(), uuid)
  }
  ;(orch as any).markService = markService
  return { orch: orch as ShareOrchestrator, bookmarkService, markService, userRepo }
}

describe('ShareOrchestrator.getBookmarkShareMarkListByUid', () => {
  test('owner → 跳过分享校验，直接返回划线', async () => {
    const { orch, bookmarkService, markService } = wire()
    bookmarkService.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ user_id: 10 }))

    const res = await orch.getBookmarkShareMarkListByUid(createMockCtx({ userId: 10 }), 'bm-uuid')

    expect(bookmarkService.getBookmarkShareByBookmarkId).not.toHaveBeenCalled()
    expect(markService.getBookmarkMarkList).toHaveBeenCalledWith(expect.anything(), { id: 5, isShowMarks: true })
    expect(res).toBe(MARKS)
  })

  test('解析不到 user_bookmark → 返回空列表', async () => {
    const { orch, bookmarkService, markService } = wire()
    bookmarkService.getUserBookmarkByUuidWithDetail.mockResolvedValue(null)

    const res = await orch.getBookmarkShareMarkListByUid(createMockCtx({ userId: 0 }), 'missing')
    expect(res).toEqual(EMPTY)
    expect(markService.getBookmarkMarkList).not.toHaveBeenCalled()
  })

  test('访客 + 无分享记录（全局快照）→ 放行', async () => {
    const { orch, bookmarkService, markService } = wire()
    bookmarkService.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ user_id: 10 }))
    bookmarkService.getBookmarkShareByBookmarkId.mockResolvedValue(null)

    const res = await orch.getBookmarkShareMarkListByUid(createMockCtx({ userId: 0 }), 'bm-uuid')
    expect(bookmarkService.getBookmarkShareByBookmarkId).toHaveBeenCalledWith(42, 10)
    // 放行时统一按 user_bookmark.id(=5) 查询且 isShowMarks=true（而非全局 bookmark_id=42）
    expect(markService.getBookmarkMarkList).toHaveBeenCalledWith(expect.anything(), { id: 5, isShowMarks: true })
    expect(res).toBe(MARKS)
  })

  test.each([true, false])('访客 + 分享允许互动及展示 → 放行，遵循 show_userinfo=%s', async showUserinfo => {
    const { orch, bookmarkService, markService } = wire()
    bookmarkService.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ user_id: 10 }))
    bookmarkService.getBookmarkShareByBookmarkId.mockResolvedValue(share({ allow_comment: true, allow_line: true, show_userinfo: showUserinfo }))

    const res = await orch.getBookmarkShareMarkListByUid(createMockCtx({ userId: 0 }), 'bm-uuid')
    expect(res).toEqual(showUserinfo ? MARKS : { ...MARKS, user_list: {} })
    expect(markService.getBookmarkMarkList).toHaveBeenCalledWith(expect.anything(), { id: 5, isShowMarks: true })
  })

  test.each(['allow_line', 'allow_comment'])('访客 + %s=false → 空列表，即使允许展示', async field => {
    const { orch, bookmarkService, markService } = wire()
    bookmarkService.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub())
    bookmarkService.getBookmarkShareByBookmarkId.mockResolvedValue(share({ allow_line: true, allow_comment: true, [field]: false }))
    expect(await orch.getBookmarkShareMarkListByUid(createMockCtx({ userId: 0 }), 'bm-uuid')).toEqual(EMPTY)
    expect(markService.getBookmarkMarkList).not.toHaveBeenCalled()
  })

  test('访客 + 分享未开启（is_enable=false）→ 空列表', async () => {
    const { orch, bookmarkService, markService } = wire()
    bookmarkService.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ user_id: 10 }))
    bookmarkService.getBookmarkShareByBookmarkId.mockResolvedValue(share({ is_enable: false, allow_comment: true, allow_line: true }))

    const res = await orch.getBookmarkShareMarkListByUid(createMockCtx({ userId: 0 }), 'bm-uuid')
    expect(res).toEqual(EMPTY)
    expect(markService.getBookmarkMarkList).not.toHaveBeenCalled()
  })

  test.each(['show_line', 'show_comment'])('访客 + %s=false → 空列表，即使允许互动', async field => {
    const { orch, bookmarkService, markService } = wire()
    bookmarkService.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub())
    bookmarkService.getBookmarkShareByBookmarkId.mockResolvedValue(share({ [field]: false, allow_line: true, allow_comment: true }))
    expect(await orch.getBookmarkShareMarkListByUid(createMockCtx({ userId: 0 }), 'bm-uuid')).toEqual(EMPTY)
    expect(markService.getBookmarkMarkList).not.toHaveBeenCalled()
  })

  test.each(['deleted', 'global-off'])('访客 + %s → 不读取标注', async reason => {
    const { orch, bookmarkService, markService, userRepo } = wire()
    bookmarkService.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ deleted_at: reason === 'deleted' ? new Date() : null }))
    if (reason === 'global-off') userRepo.getInfoByUserId.mockResolvedValue({ snapshot_sharing: false })
    expect(await orch.getBookmarkShareMarkListByUid(createMockCtx({ userId: 0 }), 'bm-uuid')).toEqual(EMPTY)
    expect(markService.getBookmarkMarkList).not.toHaveBeenCalled()
  })

  test('访客 + 命中内容审核（moderation_result>0）→ 空列表，不查分享', async () => {
    const { orch, bookmarkService, markService } = wire()
    bookmarkService.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ user_id: 10, bookmark: { moderation_result: 1 } }))

    const res = await orch.getBookmarkShareMarkListByUid(createMockCtx({ userId: 0 }), 'bm-uuid')
    expect(res).toEqual(EMPTY)
    expect(bookmarkService.getBookmarkShareByBookmarkId).not.toHaveBeenCalled()
    expect(markService.getBookmarkMarkList).not.toHaveBeenCalled()
  })

  test('owner 命中内容审核 → 仍可访问', async () => {
    const { orch, bookmarkService, markService } = wire()
    bookmarkService.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ user_id: 10, bookmark: { moderation_result: 1 } }))

    const res = await orch.getBookmarkShareMarkListByUid(createMockCtx({ userId: 10 }), 'bm-uuid')
    expect(res).toBe(MARKS)
    expect(markService.getBookmarkMarkList).toHaveBeenCalledWith(expect.anything(), { id: 5, isShowMarks: true })
  })
})
