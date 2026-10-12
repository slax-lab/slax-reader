/**
 * /add Layer 1: addByContent 全分支
 * 来源: bookmarkAdd.ts:63-94
 */
import { describe, test, expect, vi } from 'vitest'
import { BookmarkAddOrchestrator } from '@/domain/orchestrator/bookmarkAdd'
import { createMockCtx, createMockBookmarkService, createMockCrawlService } from '@test/helpers/mockFactory'

function wire() {
  const bs = createMockBookmarkService()
  const cs = createMockCrawlService()
  const orch = new (BookmarkAddOrchestrator as any)()
  ;(orch as any).bookmarkService = bs; ;(orch as any).crawlService = cs
  return { orch: orch as BookmarkAddOrchestrator, bs, cs }
}

describe('addBookmark 返回值处理', () => {
  test('返回 number → isShortcut=true, workflowParams=null', async () => {
    const { orch, bs } = wire()
    bs.addBookmark.mockResolvedValue(55)
    const result = await orch.addByContent(createMockCtx(), { target_url: 'https://r.slax.com/s/abc' } as any)
    expect(result.isShortcut).toBe(true)
    expect(result.workflowParams).toBeNull()
    expect(result.bookmarkId).toBe(55)
  })

  test('返回 object + resource 非空 → inlineContent 有值', async () => {
    const { orch, bs } = wire()
    bs.addBookmark.mockResolvedValue({ info: { bookmarkId: 42, targetUrl: 'https://a.com', userId: 1, resource: '<p>content</p>' } })
    const result = await orch.addByContent(createMockCtx(), { target_url: 'https://a.com' } as any)
    expect(result.isShortcut).toBe(false)
    expect(result.workflowParams!.inlineContent).toBe('<p>content</p>')
    expect(result.resource).toBe('<p>content</p>')
  })

  test('返回 object + resource 空字符串 → inlineContent=undefined', async () => {
    const { orch, bs } = wire()
    bs.addBookmark.mockResolvedValue({ info: { bookmarkId: 42, targetUrl: 'https://a.com', userId: 1, resource: '' } })
    const result = await orch.addByContent(createMockCtx(), { target_url: 'https://a.com' } as any)
    expect(result.workflowParams!.inlineContent).toBeUndefined()
  })

  test('返回 object + resource 为 null → inlineContent=undefined', async () => {
    const { orch, bs } = wire()
    bs.addBookmark.mockResolvedValue({ info: { bookmarkId: 42, targetUrl: 'https://a.com', userId: 1, resource: null } })
    const result = await orch.addByContent(createMockCtx(), { target_url: 'https://a.com' } as any)
    expect(result.workflowParams!.inlineContent).toBeUndefined()
  })
})

describe('addBookmark 异常处理', () => {
  test('Error 实例 → pushBookmarkFailureAlert(source=add) + rethrow', async () => {
    const { orch, bs, cs } = wire()
    bs.addBookmark.mockRejectedValue(new Error('blocked'))
    const ctx = createMockCtx({ userId: 3 })

    await expect(orch.addByContent(ctx, { target_url: 'https://a.com' } as any)).rejects.toThrow('blocked')
    expect(ctx.execution.waitUntil).toHaveBeenCalled()
  })

  test('非 Error 对象 → String() 转换', async () => {
    const { orch, bs } = wire()
    bs.addBookmark.mockRejectedValue(42)
    const ctx = createMockCtx()
    await expect(orch.addByContent(ctx, { target_url: 'https://a.com' } as any)).rejects.toBe(42)
    expect(ctx.execution.waitUntil).toHaveBeenCalled()
  })

  test('告警内容包含 source=add', async () => {
    const { orch, bs, cs } = wire()
    bs.addBookmark.mockRejectedValue(new Error('fail'))
    const ctx = createMockCtx({ userId: 5 })
    await orch.addByContent(ctx, { target_url: 'https://test.com' } as any).catch(() => {})
    const p = ctx.execution.waitUntil.mock.calls[0][0]
    await p
    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(
      5, 'pre_workflow.invalid_input',
      expect.objectContaining({ source: 'add', url: 'https://test.com', user_id: 5 })
    )
  })
})
