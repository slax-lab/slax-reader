/**
 * snapshot bookmark_uid 兼容：AigcController /v1/aigc/summaries 与 /v1/aigc/chat
 *
 * - /summaries：!force && (bm_id || bookmark_uid) 时先查缓存命中（getUserBookmarkSummary 透传 bmUId），
 *   命中直接返回 summary.content，不再生成；未命中/force 时把 bookmark_uid 透传给 getBookmarkTitleContent。
 * - /chat：bookmark_uid 透传给 getBookmarkTitleContent。
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

import { createMockCtx } from '@test/helpers/mockFactory'

function mockReq(body: any) {
  const payload = {
    json: () => Promise.resolve(body),
    url: 'https://api.test/v1/aigc',
    cf: { country: 'US', continent: 'NA' },
    headers: { get: () => '' }
  } as unknown as Request
  return { ...payload, clone: () => payload } as unknown as Request
}

async function wire() {
  const { AigcController } = await import('@/handler/http/aigcController')
  const aigcService = {
    recordChunks: vi.fn(),
    bookmarkSummary: vi.fn().mockResolvedValue(undefined),
    bookmarkChat: vi.fn().mockResolvedValue(undefined)
  }
  const userService = {
    getUserInfo: vi.fn().mockResolvedValue({ ai_lang: 'en', lang: 'en' }),
    getUserSubscriptionInfo: vi.fn().mockResolvedValue({ subscription_end_at: new Date('2099-01-01T00:00:00Z') })
  }
  const bookmarkService = {
    getUserBookmarkSummary: vi.fn(),
    getBookmarkTitleContent: vi.fn().mockResolvedValue({ title: 'T', content: 'C', bmId: 42 }),
    saveSummary: vi.fn().mockResolvedValue(undefined)
  }
  const ctrl = new (AigcController as any)()
  ;(ctrl as any).aigcService = aigcService
  ;(ctrl as any).userService = userService
  ;(ctrl as any).bookmarkService = bookmarkService
  ;(ctrl as any).userSvc = userService
  ;(ctrl as any).logsSvc = { track: vi.fn().mockResolvedValue(undefined) }
  return { ctrl, aigcService, userService, bookmarkService }
}

let env: Awaited<ReturnType<typeof wire>>
beforeEach(async () => {
  env = await wire()
})

describe('POST /v1/aigc/summaries', () => {
  test('bookmark_uid + 命中缓存 → 直接返回 summary 内容，不再生成', async () => {
    env.bookmarkService.getUserBookmarkSummary.mockResolvedValue({ content: 'cached summary' })

    const resp = await env.ctrl.handleSummariesRequest(createMockCtx({ userId: 7 }), mockReq({ bookmark_uid: 'bm-uuid', force: false }))

    expect(env.bookmarkService.getUserBookmarkSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bmUId: 'bm-uuid' })
    )
    // 命中缓存：不应再调用 getBookmarkTitleContent / 生成总结
    expect(env.bookmarkService.getBookmarkTitleContent).not.toHaveBeenCalled()
    expect(env.aigcService.bookmarkSummary).not.toHaveBeenCalled()
    expect(await resp.text()).toBe('cached summary')
  })

  test('bookmark_uid + 未命中缓存 → bookmark_uid 透传给 getBookmarkTitleContent 并生成', async () => {
    env.bookmarkService.getUserBookmarkSummary.mockResolvedValue(null)

    await env.ctrl.handleSummariesRequest(createMockCtx({ userId: 7 }), mockReq({ bookmark_uid: 'bm-uuid', force: false }))

    expect(env.bookmarkService.getBookmarkTitleContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bmUId: 'bm-uuid' })
    )
    expect(env.aigcService.bookmarkSummary).toHaveBeenCalled()
  })

  test('force=true → 跳过缓存查询，直接透传 bookmark_uid 生成', async () => {
    await env.ctrl.handleSummariesRequest(createMockCtx({ userId: 7 }), mockReq({ bookmark_uid: 'bm-uuid', force: true }))

    expect(env.bookmarkService.getUserBookmarkSummary).not.toHaveBeenCalled()
    expect(env.bookmarkService.getBookmarkTitleContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bmUId: 'bm-uuid' })
    )
  })

  test('moderation_result>0 → 抛 PROHIBITED_CONTENT 错误，不生成总结', async () => {
    env.bookmarkService.getUserBookmarkSummary.mockResolvedValue(null)
    env.bookmarkService.getBookmarkTitleContent.mockResolvedValue({ title: 'T', content: 'C', bmId: 42, targetUrl: 'https://example.com/x', moderationResult: 1 })

    await expect(env.ctrl.handleSummariesRequest(createMockCtx({ userId: 7 }), mockReq({ bookmark_uid: 'bm-uuid', force: true }))).rejects.toMatchObject({
      name: 'PROHIBITED_CONTENT',
      message: 'Processing failed: prohibited content'
    })
    expect(env.aigcService.bookmarkSummary).not.toHaveBeenCalled()
  })
})

describe('collection access parameters', () => {
  test.each(['handleSummariesRequest', 'handleCompletionsRequest'])('%s forwards collection code with the bookmark relation ID', async method => {
    await env.ctrl[method](createMockCtx({ userId: 7 }), mockReq({ cb_id: 123, collection_code: 'collection', messages: [], force: true }))
    expect(env.bookmarkService.getBookmarkTitleContent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cbId: 123, collectionCode: 'collection' }))
  })
})

describe('POST /v1/aigc/chat', () => {
  test('bookmark_uid 透传给 getBookmarkTitleContent', async () => {
    await env.ctrl.handleCompletionsRequest(createMockCtx({ userId: 7 }), mockReq({ bookmark_uid: 'bm-uuid', messages: [] }))

    expect(env.bookmarkService.getBookmarkTitleContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bmUId: 'bm-uuid' })
    )
    expect(env.aigcService.bookmarkChat).toHaveBeenCalled()
  })

  test('moderation_result>0 → 抛 PROHIBITED_CONTENT 错误，不进入对话生成', async () => {
    env.bookmarkService.getBookmarkTitleContent.mockResolvedValue({ title: 'T', content: 'C', bmId: 42, targetUrl: 'https://example.com/x', moderationResult: 2 })

    await expect(env.ctrl.handleCompletionsRequest(createMockCtx({ userId: 7 }), mockReq({ bookmark_uid: 'bm-uuid', messages: [] }))).rejects.toMatchObject({
      name: 'PROHIBITED_CONTENT',
      message: 'Processing failed: prohibited content'
    })
    expect(env.aigcService.bookmarkChat).not.toHaveBeenCalled()
  })
})
