/**
 * /add_url Layer 3: 书签创建 addUrlBookmark 结果处理
 * 来源: bookmarkAdd.ts:27-61
 */
import { describe, test, expect, vi } from 'vitest'
import { BookmarkAddOrchestrator, type PreWorkflowResult } from '@/domain/orchestrator/bookmarkAdd'
import { createMockCtx, createMockBookmarkService, createMockCrawlService } from '@test/helpers/mockFactory'

function wire() {
  const bs = createMockBookmarkService()
  const cs = createMockCrawlService()
  const orch = new (BookmarkAddOrchestrator as any)()
  ;(orch as any).bookmarkService = bs
  ;(orch as any).crawlService = cs
  return { orch: orch as BookmarkAddOrchestrator, bs, cs }
}

describe('addUrlBookmark 返回值处理', () => {
  test('返回 number → isShortcut=true, workflowParams=null', async () => {
    const { orch, bs } = wire()
    bs.addUrlBookmark.mockResolvedValue(42)
    const result = await orch.addByUrl(createMockCtx(), { target_url: 'https://a.com', target_title: '', tags: [] })
    expect(result).toEqual<PreWorkflowResult>({ bookmarkId: 42, isShortcut: true, workflowParams: null })
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

describe('addUrlBookmark 异常处理', () => {
  test('Error 实例 → 提取 message 推送告警 + rethrow', async () => {
    const { orch, bs, cs } = wire()
    bs.addUrlBookmark.mockRejectedValue(new Error('DB connection lost'))
    const ctx = createMockCtx()

    await expect(orch.addByUrl(ctx, { target_url: 'https://a.com', target_title: '', tags: [] }))
      .rejects.toThrow('DB connection lost')

    // waitUntil 被调用(推送告警)
    expect(ctx.execution.waitUntil).toHaveBeenCalled()
  })

  test('非 Error 对象 → String() 转换推送告警', async () => {
    const { orch, bs, cs } = wire()
    bs.addUrlBookmark.mockRejectedValue('string error')
    const ctx = createMockCtx()

    await expect(orch.addByUrl(ctx, { target_url: 'https://a.com', target_title: '', tags: [] }))
      .rejects.toBe('string error')

    expect(ctx.execution.waitUntil).toHaveBeenCalled()
  })

  test('告警内容包含 source=add_url 和 URL', async () => {
    const { orch, bs, cs } = wire()
    bs.addUrlBookmark.mockRejectedValue(new Error('fail'))
    const ctx = createMockCtx({ userId: 7 })

    await orch.addByUrl(ctx, { target_url: 'https://test.com', target_title: '', tags: [] }).catch(() => {})

    // waitUntil 里面调用了 pushBookmarkFailureAlert
    const waitUntilFn = ctx.execution.waitUntil.mock.calls[0][0]
    // 等待 promise resolve 以确保 pushBookmarkFailureAlert 被调用
    await waitUntilFn
    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(
      7, 'pre_workflow.invalid_input',
      expect.objectContaining({ source: 'add_url', url: 'https://test.com', user_id: 7 })
    )
  })
})
