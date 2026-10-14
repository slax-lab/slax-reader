/**
 * /add Layer 3: 端到端路径
 */
import { describe, test, expect, vi } from 'vitest'
import { BookmarkAddOrchestrator } from '@/domain/orchestrator/bookmarkAdd'
import { detectRoute } from '@/utils/platformDetector'
import { createMockCtx, createMockBookmarkService, createMockCrawlService } from '@test/helpers/mockFactory'

function wire(cs = createMockCrawlService()) {
  const bs = createMockBookmarkService()
  const orch = new (BookmarkAddOrchestrator as any)()
  ;(orch as any).bookmarkService = bs; ;(orch as any).crawlService = cs
  return { orch: orch as BookmarkAddOrchestrator, bs, cs }
}

describe('content 非空 → kickoffWorkflow with inlineContent', () => {
  test('resource 传入 workflow', async () => {
    const { orch, bs, cs } = wire()
    bs.addBookmark.mockResolvedValue({ info: { bookmarkId: 42, targetUrl: 'https://a.com/article', userId: 1, resource: '<p>c</p>' } })
    const ctx = createMockCtx()
    const result = await orch.addByContent(ctx, { target_url: 'https://a.com/article' } as any)
    await orch.kickoffWorkflow(ctx, result.workflowParams!)
    expect(cs.createWorkflow).toHaveBeenCalledWith(ctx.env, expect.objectContaining({ inlineContent: '<p>c</p>' }), 3, ctx)
  })
})

describe('content 空 → kickoffWorkflow without inlineContent', () => {
  test('inlineContent=undefined', async () => {
    const { orch, bs, cs } = wire()
    bs.addBookmark.mockResolvedValue({ info: { bookmarkId: 42, targetUrl: 'https://a.com', userId: 1, resource: '' } })
    const ctx = createMockCtx()
    const result = await orch.addByContent(ctx, { target_url: 'https://a.com' } as any)
    await orch.kickoffWorkflow(ctx, result.workflowParams!)
    expect(cs.createWorkflow).toHaveBeenCalledWith(ctx.env, expect.objectContaining({ inlineContent: undefined }), 3, ctx)
  })
})

describe('shortcut → 不触发 workflow', () => {
  test('isShortcut=true, workflowParams=null', async () => {
    const { orch, bs } = wire()
    bs.addBookmark.mockResolvedValue(99)
    const result = await orch.addByContent(createMockCtx(), { target_url: 'https://r.slax.com/s/x' } as any)
    expect(result.isShortcut).toBe(true)
    expect(result.workflowParams).toBeNull()
  })
})

describe('/add 与 /add_url 共享 kickoffWorkflow', () => {
  test('相同 crawlService.createWorkflow 调用', async () => {
    const cs = createMockCrawlService()
    const { orch: orch1, bs: bs1 } = wire(cs)
    const { orch: orch2, bs: bs2 } = wire(cs)
    bs1.addUrlBookmark.mockResolvedValue({ info: { bookmarkId: 1, targetUrl: 'https://a.com', userId: 1 } })
    bs2.addBookmark.mockResolvedValue({ info: { bookmarkId: 2, targetUrl: 'https://b.com', userId: 1, resource: '' } })
    const ctx = createMockCtx()

    const r1 = await orch1.addByUrl(ctx, { target_url: 'https://a.com', target_title: '', tags: [] })
    await orch1.kickoffWorkflow(ctx, r1.workflowParams!)

    const r2 = await orch2.addByContent(ctx, { target_url: 'https://b.com' } as any)
    await orch2.kickoffWorkflow(ctx, r2.workflowParams!)

    expect(cs.createWorkflow).toHaveBeenCalledTimes(2)
  })
})

describe('失败链路', () => {
  test('addByContent 失败 → alert → 不创建 workflow', async () => {
    const { orch, bs, cs } = wire()
    bs.addBookmark.mockRejectedValue(new Error('boom'))
    await expect(orch.addByContent(createMockCtx(), { target_url: 'https://a.com' } as any)).rejects.toThrow()
    expect(cs.createWorkflow).not.toHaveBeenCalled()
  })

  test('addByContent 成功但 kickoffWorkflow 失败 → 静默', async () => {
    const { orch, bs, cs } = wire()
    bs.addBookmark.mockResolvedValue({ info: { bookmarkId: 1, targetUrl: 'https://a.com', userId: 1, resource: '' } })
    cs.createWorkflow.mockRejectedValue(new Error('fail'))
    const ctx = createMockCtx()
    const result = await orch.addByContent(ctx, { target_url: 'https://a.com' } as any)
    await expect(orch.kickoffWorkflow(ctx, result.workflowParams!)).resolves.toBeUndefined()
  })
})
