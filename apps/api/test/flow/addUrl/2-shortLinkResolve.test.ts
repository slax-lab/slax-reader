/**
 * /add_url Layer 2: 短链解析 tryResolveShortLink
 * 来源: bookmarkAdd.ts:118-134
 */
import { describe, test, expect, vi } from 'vitest'
import { BookmarkAddOrchestrator } from '@/domain/orchestrator/bookmarkAdd'
import { CrawlService } from '@/domain/crawl'
import { needsResolve } from '@/utils/platformDetector'
import { createMockCtx, createMockBookmarkService, createMockCrawlService } from '@test/helpers/mockFactory'

function wire() {
  const bs = createMockBookmarkService()
  const cs = createMockCrawlService()
  const orch = new (BookmarkAddOrchestrator as any)()
  ;(orch as any).bookmarkService = bs
  ;(orch as any).crawlService = cs
  return { orch: orch as BookmarkAddOrchestrator, bs, cs }
}

describe('needsResolve 判断', () => {
  test('Twitter /i/status/ → 需要解析', () => {
    expect(needsResolve('https://x.com/i/status/123')).toBe(true)
    expect(needsResolve('https://twitter.com/i/status/999')).toBe(true)
  })

  test('普通 Twitter URL → 不需要解析', () => {
    expect(needsResolve('https://x.com/user/status/123')).toBe(false)
  })

  test('普通 URL → 不需要解析', () => {
    expect(needsResolve('https://example.com')).toBe(false)
    expect(needsResolve('https://t.co/abc')).toBe(false)
  })
})

describe('tryResolveShortLink 分支', () => {
  test('needsResolve=false → 不调 resolveFinalUrl', async () => {
    const { orch, bs, cs } = wire()
    bs.addUrlBookmark.mockResolvedValue(1)
    await orch.addByUrl(createMockCtx(), { target_url: 'https://example.com', target_title: '', tags: [] })
    expect(cs.resolveFinalUrl).not.toHaveBeenCalled()
  })

  test('needsResolve=true + 解析成功 → req.target_url 被替换', async () => {
    const { orch, bs, cs } = wire()
    cs.resolveFinalUrl.mockResolvedValue('https://x.com/real/status/123')
    bs.addUrlBookmark.mockResolvedValue(1)
    const req = { target_url: 'https://x.com/i/status/123', target_title: '', tags: [] }
    await orch.addByUrl(createMockCtx(), req)
    expect(req.target_url).toBe('https://x.com/real/status/123')
  })

  test('needsResolve=true + resolveFinalUrl 返回 null → 保留原 URL', async () => {
    const { orch, bs, cs } = wire()
    cs.resolveFinalUrl.mockResolvedValue(null)
    bs.addUrlBookmark.mockResolvedValue(1)
    const req = { target_url: 'https://x.com/i/status/123', target_title: '', tags: [] }
    await orch.addByUrl(createMockCtx(), req)
    // resolveFinalUrl 返回 null → if (url) 不成立，保留原值
    expect(req.target_url).toBe('https://x.com/i/status/123')
  })

  test('needsResolve=true + resolveFinalUrl 抛异常 → fallback 原 URL + 推告警 + 不向外抛', async () => {
    const { orch, bs, cs } = wire()
    cs.resolveFinalUrl.mockRejectedValue(new Error('network error'))
    bs.addUrlBookmark.mockResolvedValue(1)
    const ctx = createMockCtx()
    const req = { target_url: 'https://x.com/i/status/123', target_title: '', tags: [] }

    // 不抛异常
    await expect(orch.addByUrl(ctx, req)).resolves.toBeDefined()
    // 保留原 URL
    expect(req.target_url).toBe('https://x.com/i/status/123')
    // 推送告警
    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(
      1, 'pre_workflow.resolve_short_link_failed',
      expect.objectContaining({ url: 'https://x.com/i/status/123', error: 'network error' })
    )
  })
})

describe('CrawlService.shortLinkDomains', () => {
  test('包含全部已知短链域名', () => {
    expect(CrawlService.shortLinkDomains).toEqual(
      expect.arrayContaining(['t.cn', 'xhslink.com', 't.co', 'redd.it', 'mapp.api.weibo.cn'])
    )
  })
})
