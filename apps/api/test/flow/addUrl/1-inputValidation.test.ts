/**
 * /add_url Layer 1: Controller 输入校验 + URL 预处理
 * 来源: bookmarkController.ts:69-98, urlPolicie.ts processTargetUrl
 */
import { describe, test, expect, vi } from 'vitest'

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

import { BookmarkAddOrchestrator } from '@/domain/orchestrator/bookmarkAdd'
import { processTargetUrl } from '@/utils/urlPolicie'
import {
  createMockCtx, createMockBookmarkService, createMockCrawlService,
  createMockRequest
} from '@test/helpers/mockFactory'

function wire() {
  const bs = createMockBookmarkService()
  const cs = createMockCrawlService()
  const orch = new (BookmarkAddOrchestrator as any)()
  ;(orch as any).bookmarkService = bs
  ;(orch as any).crawlService = cs
  return { orch: orch as BookmarkAddOrchestrator, bs, cs }
}

describe('BookmarkController.handleUserAddUrlBookmarkRequest URL 预处理', () => {
  async function wireController() {
    const { BookmarkController } = await import('@/handler/http/bookmarkController')
    const orch = { addByUrl: vi.fn(), kickoffWorkflow: vi.fn() }
    const logs = { track: vi.fn().mockResolvedValue(undefined) }
    const ctrl = new (BookmarkController as any)()
    ;(ctrl as any).bookmarkAddOrchestrator = orch
    ;(ctrl as any).logsService = logs
    return { ctrl, orch, logs }
  }

  test('空 URL → 返回 Failed 响应', async () => {
    const { ctrl } = await wireController()
    const ctx = createMockCtx()
    const req = createMockRequest({ target_url: '', target_title: '' })

    const resp = await ctrl.handleUserAddUrlBookmarkRequest(ctx, req)
    const body = await resp.json()
    expect(body.code).not.toBe(200)
  })

  test('无协议前缀 → orchestrator 收到 https:// 前缀', async () => {
    const { ctrl, orch } = await wireController()
    orch.addByUrl.mockResolvedValue({ bookmarkId: 1, isShortcut: true, workflowParams: null })
    const ctx = createMockCtx()
    const req = createMockRequest({ target_url: 'example.com/page', target_title: '' })

    await ctrl.handleUserAddUrlBookmarkRequest(ctx, req)

    expect(orch.addByUrl).toHaveBeenCalledWith(ctx, expect.objectContaining({ target_url: 'https://example.com/page' }), expect.anything())
  })

  test('已有 http:// → 不修改', async () => {
    const { ctrl, orch } = await wireController()
    orch.addByUrl.mockResolvedValue({ bookmarkId: 1, isShortcut: true, workflowParams: null })
    const ctx = createMockCtx()
    const req = createMockRequest({ target_url: 'http://example.com', target_title: '' })

    await ctrl.handleUserAddUrlBookmarkRequest(ctx, req)

    expect(orch.addByUrl).toHaveBeenCalledWith(ctx, expect.objectContaining({ target_url: 'http://example.com' }), expect.anything())
  })

  test('已有 https:// → 不修改', async () => {
    const { ctrl, orch } = await wireController()
    orch.addByUrl.mockResolvedValue({ bookmarkId: 1, isShortcut: true, workflowParams: null })
    const ctx = createMockCtx()
    const req = createMockRequest({ target_url: 'https://example.com', target_title: '' })

    await ctrl.handleUserAddUrlBookmarkRequest(ctx, req)

    expect(orch.addByUrl).toHaveBeenCalledWith(ctx, expect.objectContaining({ target_url: 'https://example.com' }), expect.anything())
  })

  test('addByUrl 成功 + shortcut → 不触发 kickoffWorkflow', async () => {
    const { ctrl, orch } = await wireController()
    orch.addByUrl.mockResolvedValue({ bookmarkId: 88, isShortcut: true, workflowParams: null })
    const ctx = createMockCtx()
    const req = createMockRequest({ target_url: 'https://r.slax.com/s/abc', target_title: '' })

    const resp = await ctrl.handleUserAddUrlBookmarkRequest(ctx, req)
    const body = await resp.json()

    expect(body.code).toBe(200)
    expect(orch.kickoffWorkflow).not.toHaveBeenCalled()
  })

  test('addByUrl 成功 + 非 shortcut → kickoffWorkflow via waitUntil', async () => {
    const { ctrl, orch } = await wireController()
    orch.addByUrl.mockResolvedValue({
      bookmarkId: 42,
      isShortcut: false,
      workflowParams: { url: 'https://a.com', bookmarkId: 42, userId: 1 }
    })
    const ctx = createMockCtx()
    const req = createMockRequest({ target_url: 'https://a.com', target_title: '' })

    await ctrl.handleUserAddUrlBookmarkRequest(ctx, req)

    expect(ctx.execution.waitUntil).toHaveBeenCalled()
    const waitUntilCalls = ctx.execution.waitUntil.mock.calls
    expect(waitUntilCalls.length).toBeGreaterThanOrEqual(1)
  })

  test('addByUrl 异常 → Failed 响应', async () => {
    const { ctrl, orch } = await wireController()
    orch.addByUrl.mockRejectedValue(new Error('DB down'))
    const ctx = createMockCtx()
    const req = createMockRequest({ target_url: 'https://a.com', target_title: '' })

    const resp = await ctrl.handleUserAddUrlBookmarkRequest(ctx, req)
    const body = await resp.json()
    expect(body.code).not.toBe(200)
  })
})

describe('BookmarkAddOrchestrator.addByUrl 结果处理', () => {
  test('返回 number → isShortcut=true, workflowParams=null', async () => {
    const { orch, bs } = wire()
    bs.addUrlBookmark.mockResolvedValue(42)
    const result = await orch.addByUrl(createMockCtx(), { target_url: 'https://a.com', target_title: '', tags: [] })
    expect(result).toEqual({ bookmarkId: 42, isShortcut: true, workflowParams: null })
  })

  test('返回 object → isShortcut=false, workflowParams 完整', async () => {
    const { orch, bs } = wire()
    bs.addUrlBookmark.mockResolvedValue({
      info: { bookmarkId: 10, targetUrl: 'https://example.com/page', userId: 5 }
    })
    const result = await orch.addByUrl(createMockCtx({ userId: 5 }), { target_url: 'https://example.com/page', target_title: '', tags: [] })
    expect(result.isShortcut).toBe(false)
    expect(result.workflowParams).toEqual({ url: 'https://example.com/page', bookmarkId: 10, userId: 5 })
  })
})

describe('BookmarkAddOrchestrator.addByUrl 异常处理', () => {
  test('Error 实例 → 推送告警 + rethrow', async () => {
    const { orch, bs } = wire()
    bs.addUrlBookmark.mockRejectedValue(new Error('DB connection lost'))
    const ctx = createMockCtx()

    await expect(orch.addByUrl(ctx, { target_url: 'https://a.com', target_title: '', tags: [] }))
      .rejects.toThrow('DB connection lost')

    expect(ctx.execution.waitUntil).toHaveBeenCalled()
  })

  test('告警内容包含 source=add_url 和 URL', async () => {
    const { orch, bs, cs } = wire()
    bs.addUrlBookmark.mockRejectedValue(new Error('fail'))
    const ctx = createMockCtx({ userId: 7 })

    await orch.addByUrl(ctx, { target_url: 'https://test.com', target_title: '', tags: [] }).catch(() => {})

    const waitUntilFn = ctx.execution.waitUntil.mock.calls[0][0]
    await waitUntilFn
    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(
      7, 'pre_workflow.invalid_input',
      expect.objectContaining({ source: 'add_url', url: 'https://test.com', user_id: 7 })
    )
  })
})

describe('processTargetUrl', () => {
  test('x.com → 去除 query 参数', () => {
    expect(processTargetUrl(new URL('https://x.com/user/status/123?ref=home'))).toBe('https://x.com/user/status/123')
  })

  test('twitter.com → 去除 query 参数', () => {
    expect(processTargetUrl(new URL('https://twitter.com/user/status/456?s=20'))).toBe('https://twitter.com/user/status/456')
  })

  test('mp.weixin.qq.com → 去除 poc_token 保留其他', () => {
    const result = processTargetUrl(new URL('https://mp.weixin.qq.com/s?__biz=MzA3&mid=123&poc_token=secret'))
    expect(result).not.toContain('poc_token')
    expect(result).toContain('__biz=MzA3')
  })

  test('普通 URL → 不变', () => {
    expect(processTargetUrl(new URL('https://example.com/page?id=1'))).toBe('https://example.com/page?id=1')
  })
})
