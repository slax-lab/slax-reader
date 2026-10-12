/**
 * snapshot bookmark_uid 兼容：ShareController /exists 与 /mark_list
 * 来源: src/handler/http/shareController.ts（feature/snapshot-bookmark-uid-clean）
 *
 * - /exists：接受 bookmark_id 或 bookmark_uid，透传给 shareService.checkBookmarkShareExists({bmId,bmUId})
 * - /mark_list：bookmark_uid 走 getBookmarkShareMarkListByUid；否则按 share_code 走旧逻辑
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

async function wire() {
  const { ShareController } = await import('@/handler/http/shareController')
  const shareService = {
    checkBookmarkShareExists: vi.fn().mockResolvedValue({ allow_action: true, show_comment_line: true, show_userinfo: true, share_code: 'abc' })
  }
  const shareOrchestrator = {
    getBookmarkShareMarkList: vi.fn().mockResolvedValue({ mark_list: ['by-code'], user_list: [] }),
    getBookmarkShareMarkListByUid: vi.fn().mockResolvedValue({ mark_list: ['by-uid'], user_list: [] })
  }
  const ctrl = new (ShareController as any)()
  ;(ctrl as any).shareService = shareService
  ;(ctrl as any).shareOrchestrator = shareOrchestrator
  return { ctrl, shareService, shareOrchestrator }
}

const ctx = () => createMockCtx({ userId: 7 })
const body = async (resp: Response) => await resp.json()

let env: Awaited<ReturnType<typeof wire>>
beforeEach(async () => {
  env = await wire()
})

describe('GET /v1/share/exists', () => {
  test('bookmark_uid → 透传 { bmUId } 给 checkBookmarkShareExists', async () => {
    const resp = await env.ctrl.existsShare(ctx(), createMockQueryRequest({ bookmark_uid: 'bm-uuid' }))
    expect(env.shareService.checkBookmarkShareExists).toHaveBeenCalledWith(expect.anything(), { bmId: undefined, bmUId: 'bm-uuid' })
    expect((await body(resp)).code).toBe(200)
  })

  test('bookmark_id → 透传 { bmId } 给 checkBookmarkShareExists', async () => {
    await env.ctrl.existsShare(ctx(), createMockQueryRequest({ bookmark_id: 999 }))
    // query 解析出来是字符串
    expect(env.shareService.checkBookmarkShareExists).toHaveBeenCalledWith(expect.anything(), { bmId: '999', bmUId: undefined })
  })

  test('id 与 uid 都缺失 → ErrorParam，不调用 service', async () => {
    const resp = await env.ctrl.existsShare(ctx(), createMockQueryRequest({}))
    expect((await body(resp)).code).not.toBe(200)
    expect(env.shareService.checkBookmarkShareExists).not.toHaveBeenCalled()
  })
})

describe('GET /v1/share/mark_list', () => {
  test('bookmark_uid → 走 getBookmarkShareMarkListByUid', async () => {
    const resp = await env.ctrl.getMarkList(ctx(), createMockQueryRequest({ bookmark_uid: 'bm-uuid' }))
    expect(env.shareOrchestrator.getBookmarkShareMarkListByUid).toHaveBeenCalledWith(expect.anything(), 'bm-uuid')
    expect(env.shareOrchestrator.getBookmarkShareMarkList).not.toHaveBeenCalled()
    expect((await body(resp)).data.mark_list).toEqual(['by-uid'])
  })

  test('share_code → 走旧的 getBookmarkShareMarkList', async () => {
    const resp = await env.ctrl.getMarkList(ctx(), createMockQueryRequest({ share_code: 'code123' }))
    expect(env.shareOrchestrator.getBookmarkShareMarkList).toHaveBeenCalledWith(expect.anything(), 'code123')
    expect(env.shareOrchestrator.getBookmarkShareMarkListByUid).not.toHaveBeenCalled()
    expect((await body(resp)).data.mark_list).toEqual(['by-code'])
  })

  test('uid 优先于 share_code（两者同时存在时取 uid 分支）', async () => {
    await env.ctrl.getMarkList(ctx(), createMockQueryRequest({ share_code: 'code123', bookmark_uid: 'bm-uuid' }))
    expect(env.shareOrchestrator.getBookmarkShareMarkListByUid).toHaveBeenCalledWith(expect.anything(), 'bm-uuid')
    expect(env.shareOrchestrator.getBookmarkShareMarkList).not.toHaveBeenCalled()
  })

  test('share_code 与 uid 都缺失 → ErrorParam', async () => {
    const resp = await env.ctrl.getMarkList(ctx(), createMockQueryRequest({}))
    expect((await body(resp)).code).not.toBe(200)
    expect(env.shareOrchestrator.getBookmarkShareMarkList).not.toHaveBeenCalled()
    expect(env.shareOrchestrator.getBookmarkShareMarkListByUid).not.toHaveBeenCalled()
  })
})
