/**
 * snapshot bookmark_uid 兼容：BookmarkService.getBookmarkId / getBookmarkTitleContent
 *
 * getBookmarkId 统一入口，按优先级解析全局 bookmark_id：
 *   bmId(hashId 解码) > shareCode > cbId(user_bookmark) > bmUId(uuid+用户) > uBmId
 * getBookmarkTitleContent 改为对象入参并透传 bmUId；title+content 齐备且无 id 时直接回传原文。
 */
import { describe, test, expect, vi } from 'vitest'

import { BookmarkService } from '@/domain/bookmark'
import { BookmarkNotFoundError } from '@/const/err'
import { createMockCtx } from '@test/helpers/mockFactory'

function wire() {
  const repo = {
    getBookmarkShareByShareCode: vi.fn(),
    getUserBookmark: vi.fn().mockResolvedValue({ uuid: 'public-uuid' }),
    getUserBookmarkByUuidWithDetail: vi.fn().mockResolvedValue({ user_id: 10, bookmark_id: 55, bookmark: { moderation_result: 0 } }),
    getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue({ is_enable: true }),
    getCollectionBookmarkById: vi.fn(),
    getUserBookmarkWithDetail: vi.fn().mockResolvedValue({ bookmark_id: 42, user_id: 7, bookmark: { private_user: 7 } }),
    getUserBookmarkByUId: vi.fn()
  }
  const svc = new (BookmarkService as any)()
  ;(svc as any).bookmarkRepo = repo
  ;(svc as any).userRepo = { getInfoByUserId: vi.fn().mockResolvedValue({ snapshot_sharing: true }) }
  return { svc: svc as BookmarkService, repo }
}

describe('BookmarkService.getBookmarkId', () => {
  test('bmId 优先：hashId 解码并校验 owner 关系', async () => {
    const { svc, repo } = wire()
    const ctx = createMockCtx({ userId: 7, hashIds: { decodeId: vi.fn(() => 42) } })
    const id = await svc.getBookmarkId(ctx, { bmId: 999 })
    expect(id).toBe(42)
    expect(ctx.hashIds.decodeId).toHaveBeenCalledWith(999)
    expect(repo.getUserBookmarkByUId).not.toHaveBeenCalled()
  })

  test('bmUId：按 uuid + 当前用户解析 bookmark_id', async () => {
    const { svc, repo } = wire()
    repo.getUserBookmarkByUId.mockResolvedValue({ bookmark_id: 88, user_id: 7, bookmark: { private_user: 7 } })
    const id = await svc.getBookmarkId(createMockCtx({ userId: 7 }), { bmUId: 'bm-uuid' })
    expect(repo.getUserBookmarkByUId).toHaveBeenCalledWith('bm-uuid', 7)
    expect(id).toBe(88)
  })

  test('bmUId 解析不到 → 返回 0', async () => {
    const { svc, repo } = wire()
    repo.getUserBookmarkByUId.mockResolvedValue(null)
    const id = await svc.getBookmarkId(createMockCtx({ userId: 7 }), { bmUId: 'missing' })
    expect(id).toBe(0)
  })

  test('uBmId（兼容别名分支）：同样按 uuid + 当前用户解析', async () => {
    const { svc, repo } = wire()
    repo.getUserBookmarkByUId.mockResolvedValue({ bookmark_id: 77, user_id: 7, bookmark: { private_user: 7 } })
    const id = await svc.getBookmarkId(createMockCtx({ userId: 7 }), { uBmId: 'u-uuid' })
    expect(repo.getUserBookmarkByUId).toHaveBeenCalledWith('u-uuid', 7)
    expect(id).toBe(77)
  })

  test('uBmId 解析不到 → 返回 0', async () => {
    const { svc, repo } = wire()
    repo.getUserBookmarkByUId.mockResolvedValue(null)
    const id = await svc.getBookmarkId(createMockCtx({ userId: 7 }), { uBmId: 'missing' })
    expect(id).toBe(0)
  })

  test('shareCode：命中分享返回 bookmark_id；未命中返回 0', async () => {
    const { svc, repo } = wire()
    repo.getBookmarkShareByShareCode.mockResolvedValue({ bookmark_id: 55 })
    expect(await svc.getBookmarkId(createMockCtx(), { shareCode: 'code' })).toBe(55)

    repo.getBookmarkShareByShareCode.mockResolvedValue(null)
    expect(await svc.getBookmarkId(createMockCtx(), { shareCode: 'bad' })).toBe(0)
  })

  test('cbId requires a matching active collection before resolving public access', async () => {
    const { svc, repo } = wire()
    repo.getCollectionBookmarkById.mockResolvedValue({ uuid: 'public-uuid' })
    const ctx = createMockCtx({ hashIds: { decodeId: vi.fn(() => 3) } })
    expect(await svc.getBookmarkId(ctx, { cbId: 300 })).toBe(0)
    expect(repo.getCollectionBookmarkById).not.toHaveBeenCalled()
    expect(await svc.getBookmarkId(ctx, { cbId: 300, collectionCode: 'collection' })).toBe(55)
    expect(repo.getCollectionBookmarkById).toHaveBeenCalledWith(3, 'collection', 1)
    repo.getCollectionBookmarkById.mockResolvedValue(null)
    expect(await svc.getBookmarkId(ctx, { cbId: 300, collectionCode: 'wrong' })).toBe(0)
  })

  test('rejects guessed global IDs with no owner relation', async () => {
    const { svc, repo } = wire()
    repo.getUserBookmarkWithDetail.mockResolvedValue(null)
    expect(await svc.getBookmarkId(createMockCtx({ userId: 7 }), { bmId: 999 })).toBe(0)
  })

  test('rejects disabled shares', async () => {
    const { svc, repo } = wire()
    repo.getBookmarkShareByShareCode.mockResolvedValue({ bookmark_id: 55, user_id: 10 })
    repo.getBookmarkShareByBookmarkId.mockResolvedValue({ is_enable: false })
    expect(await svc.getBookmarkId(createMockCtx({ userId: 7 }), { shareCode: 'code' })).toBe(0)
  })

  test('全部为空 → 返回 0', async () => {
    const { svc } = wire()
    expect(await svc.getBookmarkId(createMockCtx(), {})).toBe(0)
  })
})

describe('BookmarkService.getBookmarkTitleContent', () => {
  function svcWithStubs() {
    const svc = new (BookmarkService as any)()
    ;(svc as any).getBookmarkId = vi.fn()
    ;(svc as any).getBookmarkById = vi.fn()
    ;(svc as any).getBookmarkContent = vi.fn()
    return svc as BookmarkService & {
      getBookmarkId: ReturnType<typeof vi.fn>
      getBookmarkById: ReturnType<typeof vi.fn>
      getBookmarkContent: ReturnType<typeof vi.fn>
    }
  }

  test('无 id 且无 title/content → 抛 ErrorParam', async () => {
    const svc = svcWithStubs()
    await expect(svc.getBookmarkTitleContent(createMockCtx(), {})).rejects.toThrow()
  })

  test('无 id 但 title+content 齐备 → 直接回传原文，bmId=0', async () => {
    const svc = svcWithStubs()
    const res = await svc.getBookmarkTitleContent(createMockCtx(), { title: 'T', content: 'C' })
    expect(res).toEqual({ title: 'T', content: 'C', bmId: 0, targetUrl: '', moderationResult: 0 })
    expect(svc.getBookmarkId).not.toHaveBeenCalled()
  })

  test('bmUId 透传给 getBookmarkId，并返回书签标题 + 正文', async () => {
    const svc = svcWithStubs()
    svc.getBookmarkId.mockResolvedValue(42)
    svc.getBookmarkById.mockResolvedValue({ title: 'Real Title', content_md_key: 'md/42.md', target_url: 'https://example.com/article', moderation_result: 0 })
    svc.getBookmarkContent.mockResolvedValue('正文内容')

    const res = await svc.getBookmarkTitleContent(createMockCtx(), { bmUId: 'bm-uuid', title: 'no title', content: 'raw' })

    expect(svc.getBookmarkId).toHaveBeenCalledWith(expect.anything(), { bmId: undefined, shareCode: undefined, cbId: undefined, bmUId: 'bm-uuid' })
    // 正文必须按 content_md_key 取（而非 content_key），否则取错 key 也能蒙混返回内容
    expect(svc.getBookmarkContent).toHaveBeenCalledWith('md/42.md')
    expect(res).toEqual({ title: 'Real Title', content: '正文内容', bmId: 42, targetUrl: 'https://example.com/article', moderationResult: 0 })
  })

  test('解析到 id 但书签缺失 / 无 content_md_key → 抛 BookmarkNotFoundError', async () => {
    const svc = svcWithStubs()
    svc.getBookmarkId.mockResolvedValue(42)
    svc.getBookmarkById.mockResolvedValue({ title: 'x', content_md_key: '' })
    await expect(svc.getBookmarkTitleContent(createMockCtx(), { bmUId: 'bm-uuid' })).rejects.toThrow()
  })

  test('getBookmarkById 返回 MultiLangError 实例 → 视为未找到，抛错', async () => {
    const svc = svcWithStubs()
    svc.getBookmarkId.mockResolvedValue(42)
    svc.getBookmarkById.mockResolvedValue(BookmarkNotFoundError())
    await expect(svc.getBookmarkTitleContent(createMockCtx(), { bmUId: 'bm-uuid' })).rejects.toThrow()
    expect(svc.getBookmarkContent).not.toHaveBeenCalled()
  })

  test('正文为空 → 抛 BookmarkContentNotFoundError', async () => {
    const svc = svcWithStubs()
    svc.getBookmarkId.mockResolvedValue(42)
    svc.getBookmarkById.mockResolvedValue({ title: 'x', content_md_key: 'md/42.md' })
    svc.getBookmarkContent.mockResolvedValue('')
    await expect(svc.getBookmarkTitleContent(createMockCtx(), { bmUId: 'bm-uuid' })).rejects.toThrow()
  })

  test('getBookmarkId 解析为 0（uid 无效）→ 抛 ErrorParam', async () => {
    const svc = svcWithStubs()
    svc.getBookmarkId.mockResolvedValue(0)
    await expect(svc.getBookmarkTitleContent(createMockCtx(), { bmUId: 'missing' })).rejects.toThrow()
  })
})
