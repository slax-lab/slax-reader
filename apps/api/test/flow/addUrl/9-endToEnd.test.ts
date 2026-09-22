/**
 * /add_url Layer 9: 端到端路径组装
 * 验证各层串联后的完整链路
 */
import { describe, test, expect, vi } from 'vitest'
import { BookmarkAddOrchestrator } from '@/domain/orchestrator/bookmarkAdd'
import { CrawlService } from '@/domain/crawl'
import { detectRoute } from '@/utils/platformDetector'
import { createMockCtx, createMockBookmarkService, createMockCrawlService, createMockBucketClient, createMockBookmarkRepo, createMockLogsService, createMockAlertBot } from '@test/helpers/mockFactory'

function wireOrch(cs = createMockCrawlService()) {
  const bs = createMockBookmarkService()
  const orch = new (BookmarkAddOrchestrator as any)()
  ;(orch as any).bookmarkService = bs; ;(orch as any).crawlService = cs
  return { orch: orch as BookmarkAddOrchestrator, bs, cs }
}

describe('普通 URL 全链路', () => {
  test('addByUrl → kickoffWorkflow → regular route', async () => {
    const { orch, bs, cs } = wireOrch()
    bs.addUrlBookmark.mockResolvedValue({ info: { bookmarkId: 42, targetUrl: 'https://example.com/article', userId: 1 } })
    const ctx = createMockCtx()

    const result = await orch.addByUrl(ctx, { target_url: 'https://example.com/article', target_title: 'Test', tags: [] })
    expect(result.isShortcut).toBe(false)
    expect(result.workflowParams!.url).toBe('https://example.com/article')

    await orch.kickoffWorkflow(ctx, result.workflowParams!)
    expect(cs.createWorkflow).toHaveBeenCalledWith(ctx.env, expect.objectContaining({ url: 'https://example.com/article', bookmarkId: 42 }), 3, ctx)
    expect(detectRoute('https://example.com/article')).toBe('regular')
  })
})

describe('Twitter 短链全链路', () => {
  test('resolve → addByUrl → twitter route', async () => {
    const { orch, bs, cs } = wireOrch()
    cs.resolveFinalUrl.mockResolvedValue('https://x.com/real/status/123')
    bs.addUrlBookmark.mockResolvedValue({ info: { bookmarkId: 10, targetUrl: 'https://x.com/real/status/123', userId: 1 } })
    const ctx = createMockCtx()
    const req = { target_url: 'https://x.com/i/status/123', target_title: '', tags: [] }

    const result = await orch.addByUrl(ctx, req)
    expect(req.target_url).toBe('https://x.com/real/status/123')
    expect(detectRoute(result.workflowParams!.url)).toBe('twitter')
  })
})

describe('Shortcut 全链路', () => {
  test('addByUrl → isShortcut → 不触发 workflow', async () => {
    const { orch, bs, cs } = wireOrch()
    bs.addUrlBookmark.mockResolvedValue(88)
    const result = await orch.addByUrl(createMockCtx(), { target_url: 'https://r.slax.com/s/abc', target_title: '', tags: [] })
    expect(result.isShortcut).toBe(true)
    expect(result.workflowParams).toBeNull()
  })
})

describe('失败降级全链路', () => {
  test('addByUrl 失败 → alert → 不创建 workflow', async () => {
    const { orch, cs } = wireOrch()
    ;(orch as any).bookmarkService.addUrlBookmark.mockRejectedValue(new Error('DB fail'))
    const ctx = createMockCtx()

    await expect(orch.addByUrl(ctx, { target_url: 'https://a.com', target_title: '', tags: [] })).rejects.toThrow()
    expect(cs.createWorkflow).not.toHaveBeenCalled()
  })

  test('addByUrl 成功但 kickoffWorkflow 失败 → 静默', async () => {
    const { orch, bs, cs } = wireOrch()
    bs.addUrlBookmark.mockResolvedValue({ info: { bookmarkId: 1, targetUrl: 'https://a.com', userId: 1 } })
    cs.createWorkflow.mockRejectedValue(new Error('workflow fail'))
    const ctx = createMockCtx()

    const result = await orch.addByUrl(ctx, { target_url: 'https://a.com', target_title: '', tags: [] })
    await expect(orch.kickoffWorkflow(ctx, result.workflowParams!)).resolves.toBeUndefined()
  })
})

describe('各平台 URL → 正确路由', () => {
  const platformCases = [
    ['https://x.com/u/status/1', 'twitter'],
    ['https://www.xiaohongshu.com/explore/abc', 'xhs'],
    ['https://weibo.com/1/a', 'weibo'],
    ['https://reddit.com/r/t/comments/a/b', 'reddit'],
    ['https://mp.weixin.qq.com/s?__biz=Mz&mid=1', 'weixin'],
  ] as const

  test.each(platformCases)('%s → %s route', async (url, expectedRoute) => {
    const { orch, bs, cs } = wireOrch()
    bs.addUrlBookmark.mockResolvedValue({ info: { bookmarkId: 1, targetUrl: url, userId: 1 } })
    const result = await orch.addByUrl(createMockCtx(), { target_url: url, target_title: '', tags: [] })
    expect(detectRoute(result.workflowParams!.url)).toBe(expectedRoute)
  })
})
