/**
 * snapshot bookmark_uid 兼容：BookmarkController 各写操作 / 读操作端点
 * 来源: src/handler/http/bookmarkController.ts（feature/snapshot-bookmark-uid-clean）
 *
 * 改动统一为：bookmark_id 与 bookmark_uid 二选一；都走 bookmarkService.getBookmarkId 解析全局 bmId，
 * 解析 < 1 一律 ErrorParam。覆盖 archive / star / alias_title / summaries / add_tag / del_tag / mark_list。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))
vi.mock('@/decorators/controller', () => ({ Controller: () => (target: any) => target }))
vi.mock('@/decorators/route', () => ({
  Get: () => (_t: any, _k: string, desc: PropertyDescriptor) => desc,
  Post: () => (_t: any, _k: string, desc: PropertyDescriptor) => desc
}))

import { createMockCtx, createMockQueryRequest } from '@test/helpers/mockFactory'

const createMockRequest = (body: unknown) => new Request('https://api.test/v1/bookmark', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-ID': 'device-test' }, body: JSON.stringify(body)
})

async function wire() {
  const { BookmarkController } = await import('@/handler/http/bookmarkController')
  const bookmarkService = {
    getUserBookmarkWithDetail: vi.fn().mockResolvedValue({ uuid: 'bm-uuid', archive_status: 0, is_starred: false, type: 0, bookmark: { target_url: 'https://example.test/article' } }),
    getBookmarkId: vi.fn().mockResolvedValue(42),
    bookmarkArchive: vi.fn().mockResolvedValue(undefined),
    bookmarkAliasTitle: vi.fn().mockResolvedValue(undefined),
    getBookmarkSummaries: vi.fn().mockResolvedValue([{ id: 1 }])
  }
  const bookmarkOrchestrator = {
    bookmarkStar: vi.fn().mockResolvedValue(undefined),
    getBookmarkMarkList: vi.fn().mockResolvedValue({ mark_list: [], user_list: [] }),
    getBookmarkBriefInfo: vi.fn().mockResolvedValue({ bookmark_id: 'enc-42', bookmark_user_uuid: 'bm-uuid' })
  }
  const tagService = {
    addBookmarkTag: vi.fn().mockResolvedValue({ id: 't1' }),
    deleteBookmarkTag: vi.fn().mockResolvedValue(undefined)
  }
  const logsService = { track: vi.fn().mockResolvedValue(undefined) }
  const ctrl = new (BookmarkController as any)()
  ;(ctrl as any).bookmarkService = bookmarkService
  ;(ctrl as any).bookmarkOrchestrator = bookmarkOrchestrator
  ;(ctrl as any).tagService = tagService
  ;(ctrl as any).logsService = logsService
  return { ctrl, bookmarkService, bookmarkOrchestrator, tagService, logsService }
}

const ctx = () => createMockCtx({ userId: 7 })
const code = async (resp: Response) => (await resp.json()).code

let env: Awaited<ReturnType<typeof wire>>
beforeEach(async () => {
  env = await wire()
})

describe('POST /archive', () => {
  test('bookmark_uid → getBookmarkId 收到 bmUId，归档成功', async () => {
    const resp = await env.ctrl.handleUserBookmarkArchiveRequest(ctx(), createMockRequest({ bookmark_uid: 'bm-uuid', status: 'archive' }))
    expect(env.bookmarkService.getBookmarkId).toHaveBeenCalledWith(expect.anything(), { bmId: undefined, bmUId: 'bm-uuid' })
    expect(env.bookmarkService.bookmarkArchive).toHaveBeenCalledWith(expect.anything(), 42, 'archive')
    expect(await code(resp)).toBe(200)
  })

  test('bookmark_id → getBookmarkId 收到 bmId', async () => {
    await env.ctrl.handleUserBookmarkArchiveRequest(ctx(), createMockRequest({ bookmark_id: 999, status: 'inbox' }))
    expect(env.bookmarkService.getBookmarkId).toHaveBeenCalledWith(expect.anything(), { bmId: 999, bmUId: undefined })
  })

  test('id 与 uid 都缺失 → ErrorParam', async () => {
    const resp = await env.ctrl.handleUserBookmarkArchiveRequest(ctx(), createMockRequest({ status: 'archive' }))
    expect(await code(resp)).not.toBe(200)
    expect(env.bookmarkService.getBookmarkId).not.toHaveBeenCalled()
  })

  test('缺 status → ErrorParam', async () => {
    const resp = await env.ctrl.handleUserBookmarkArchiveRequest(ctx(), createMockRequest({ bookmark_uid: 'bm-uuid' }))
    expect(await code(resp)).not.toBe(200)
  })

  test('getBookmarkId 解析 < 1 → ErrorParam', async () => {
    env.bookmarkService.getBookmarkId.mockResolvedValue(0)
    const resp = await env.ctrl.handleUserBookmarkArchiveRequest(ctx(), createMockRequest({ bookmark_uid: 'bad', status: 'archive' }))
    expect(await code(resp)).not.toBe(200)
    expect(env.bookmarkService.bookmarkArchive).not.toHaveBeenCalled()
  })
})

describe('POST /star', () => {
  test('bookmark_uid → bookmarkStar 收到解析后的 bmId', async () => {
    const resp = await env.ctrl.handleUserBookmarkStarRequest(ctx(), createMockRequest({ bookmark_uid: 'bm-uuid', status: 'star' }))
    expect(env.bookmarkOrchestrator.bookmarkStar).toHaveBeenCalledWith(expect.anything(), 42, 'star')
    expect(await code(resp)).toBe(200)
  })

  test('id 与 uid 都缺失 → ErrorParam', async () => {
    const resp = await env.ctrl.handleUserBookmarkStarRequest(ctx(), createMockRequest({ status: 'star' }))
    expect(await code(resp)).not.toBe(200)
  })
})

describe('POST /alias_title', () => {
  test('bookmark_uid → bookmarkAliasTitle 收到解析后的 bmId', async () => {
    const resp = await env.ctrl.handleUserBookmarkAliasTitleRequest(ctx(), createMockRequest({ bookmark_uid: 'bm-uuid', alias_title: '新标题' }))
    expect(env.bookmarkService.bookmarkAliasTitle).toHaveBeenCalledWith(expect.anything(), 42, '新标题')
    expect(await code(resp)).toBe(200)
  })

  test('缺 alias_title → ErrorParam', async () => {
    const resp = await env.ctrl.handleUserBookmarkAliasTitleRequest(ctx(), createMockRequest({ bookmark_uid: 'bm-uuid' }))
    expect(await code(resp)).not.toBe(200)
  })
})

describe('GET /summaries', () => {
  test('bookmark_uid → getBookmarkId 透传 bmUId，返回总结', async () => {
    const resp = await env.ctrl.handleUserBookmarkSummariesRequest(ctx(), createMockQueryRequest({ bookmark_uid: 'bm-uuid' }))
    expect(env.bookmarkService.getBookmarkId).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bmUId: 'bm-uuid' })
    )
    expect(env.bookmarkService.getBookmarkSummaries).toHaveBeenCalledWith(expect.anything(), 42)
    expect(await code(resp)).toBe(200)
  })

  test('所有标识都缺失 → ErrorParam', async () => {
    const resp = await env.ctrl.handleUserBookmarkSummariesRequest(ctx(), createMockQueryRequest({}))
    expect(await code(resp)).not.toBe(200)
    expect(env.bookmarkService.getBookmarkId).not.toHaveBeenCalled()
  })

  test('cb_id 但缺 collection_code 且无其它标识 → ErrorParam', async () => {
    const resp = await env.ctrl.handleUserBookmarkSummariesRequest(ctx(), createMockQueryRequest({ cb_id: 5 }))
    expect(await code(resp)).not.toBe(200)
  })
})

describe('POST /add_tag', () => {
  test('bookmark_uid → addBookmarkTag 收到解析后的 bmId', async () => {
    const resp = await env.ctrl.handleUserBookmarkAddTagRequest(ctx(), createMockRequest({ bookmark_uid: 'bm-uuid', tag_name: 'tech' }))
    expect(env.tagService.addBookmarkTag).toHaveBeenCalledWith(expect.anything(), 42, 'tech', undefined)
    expect(await code(resp)).toBe(200)
  })

  test('id 与 uid 都缺失 → ErrorParam', async () => {
    const resp = await env.ctrl.handleUserBookmarkAddTagRequest(ctx(), createMockRequest({ tag_name: 'tech' }))
    expect(await code(resp)).not.toBe(200)
  })
})

describe('POST /del_tag', () => {
  test('bookmark_uid + tag_id → deleteBookmarkTag 收到 bmId 与解码后的 tagId', async () => {
    const c = createMockCtx({ userId: 7, hashIds: { decodeId: vi.fn(() => 88) } })
    const resp = await env.ctrl.handleUserBookmarkDelTagRequest(c, createMockRequest({ bookmark_uid: 'bm-uuid', tag_id: 'enc-tag' }))
    // tag_id 仍走 hashId 解码，bookmark 走 getBookmarkId
    expect(c.hashIds.decodeId).toHaveBeenCalledWith('enc-tag')
    expect(env.tagService.deleteBookmarkTag).toHaveBeenCalledWith(expect.anything(), 42, 88)
    expect(await code(resp)).toBe(200)
  })

  test('bookmark_id 路径 + tag_id → getBookmarkId 收到 bmId，tagId 走解码', async () => {
    const c = createMockCtx({ userId: 7, hashIds: { decodeId: vi.fn(() => 88) } })
    const resp = await env.ctrl.handleUserBookmarkDelTagRequest(c, createMockRequest({ bookmark_id: 999, tag_id: 'enc-tag' }))
    expect(env.bookmarkService.getBookmarkId).toHaveBeenCalledWith(expect.anything(), { bmId: 999, bmUId: undefined })
    expect(env.tagService.deleteBookmarkTag).toHaveBeenCalledWith(expect.anything(), 42, 88)
    expect(await code(resp)).toBe(200)
  })

  test('缺 tag_id → ErrorParam', async () => {
    const resp = await env.ctrl.handleUserBookmarkDelTagRequest(ctx(), createMockRequest({ bookmark_uid: 'bm-uuid' }))
    expect(await code(resp)).not.toBe(200)
  })

  test('tagId 解码为 0 → ErrorParam', async () => {
    const c = createMockCtx({ userId: 7, hashIds: { decodeId: vi.fn(() => 0) } })
    const resp = await env.ctrl.handleUserBookmarkDelTagRequest(c, createMockRequest({ bookmark_uid: 'bm-uuid', tag_id: 'bad' }))
    expect(await code(resp)).not.toBe(200)
    expect(env.tagService.deleteBookmarkTag).not.toHaveBeenCalled()
  })
})

describe('GET /brief', () => {
  test('bookmark_uid → getBookmarkId 收到 bmUId，返回 brief', async () => {
    const resp = await env.ctrl.handleUserTestRequest(ctx(), createMockQueryRequest({ bookmark_uid: 'bm-uuid' }))
    expect(env.bookmarkService.getBookmarkId).toHaveBeenCalledWith(expect.anything(), { bmId: undefined, bmUId: 'bm-uuid' })
    expect(env.bookmarkOrchestrator.getBookmarkBriefInfo).toHaveBeenCalledWith(expect.anything(), 42)
    expect(await code(resp)).toBe(200)
  })

  // query 参数到达时是字符串（hashid 本身就是字符串，如 '1nvpG3'），getBookmarkId 原样透传给 decodeId
  test('bookmark_id 仍可用（不破坏老版本扩展）', async () => {
    const resp = await env.ctrl.handleUserTestRequest(ctx(), createMockQueryRequest({ bookmark_id: '1nvpG3' }))
    expect(env.bookmarkService.getBookmarkId).toHaveBeenCalledWith(expect.anything(), { bmId: '1nvpG3', bmUId: undefined })
    expect(await code(resp)).toBe(200)
  })

  test('id 与 uid 都缺失 → ErrorParam', async () => {
    const resp = await env.ctrl.handleUserTestRequest(ctx(), createMockQueryRequest({}))
    expect(await code(resp)).not.toBe(200)
    expect(env.bookmarkService.getBookmarkId).not.toHaveBeenCalled()
  })

  test('getBookmarkId 解析 < 1 → ErrorParam（含他人 uuid）', async () => {
    env.bookmarkService.getBookmarkId.mockResolvedValue(0)
    const resp = await env.ctrl.handleUserTestRequest(ctx(), createMockQueryRequest({ bookmark_uid: 'someone-elses-uuid' }))
    expect(await code(resp)).not.toBe(200)
    expect(env.bookmarkOrchestrator.getBookmarkBriefInfo).not.toHaveBeenCalled()
  })
})

describe('GET /mark_list', () => {
  test('bookmark_uid → getBookmarkId 解析后查 markList', async () => {
    const resp = await env.ctrl.handleUserGetBookmarkMarkListRequest(ctx(), createMockQueryRequest({ bookmark_uid: 'bm-uuid' }))
    expect(env.bookmarkService.getBookmarkId).toHaveBeenCalledWith(expect.anything(), { bmId: undefined, bmUId: 'bm-uuid' })
    expect(env.bookmarkOrchestrator.getBookmarkMarkList).toHaveBeenCalledWith(expect.anything(), 7, 42)
    expect(await code(resp)).toBe(200)
  })

  test('id 与 uid 都缺失 → ErrorParam', async () => {
    const resp = await env.ctrl.handleUserGetBookmarkMarkListRequest(ctx(), createMockQueryRequest({}))
    expect(await code(resp)).not.toBe(200)
    expect(env.bookmarkOrchestrator.getBookmarkMarkList).not.toHaveBeenCalled()
  })

  test('getBookmarkId 解析 < 1 → ErrorParam', async () => {
    env.bookmarkService.getBookmarkId.mockResolvedValue(0)
    const resp = await env.ctrl.handleUserGetBookmarkMarkListRequest(ctx(), createMockQueryRequest({ bookmark_uid: 'bad' }))
    expect(await code(resp)).not.toBe(200)
  })
})
