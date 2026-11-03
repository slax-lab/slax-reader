/**
 * /add_url Layer 2: 短链解析 tryResolveShortLink
 * 来源: bookmarkAdd.ts:118-134
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { BookmarkAddOrchestrator } from '@/domain/orchestrator/bookmarkAdd'
import { CrawlService } from '@/domain/crawl'
import { needsResolve } from '@/utils/platformDetector'
import { classifyPodcastUrl } from '@/utils/podcastSource'
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

describe('Pocket Casts share resolution', () => {
  const short = 'https://pca.st/6rpkp8cj'
  const episode = 'https://pocketcasts.com/podcast/show/642bf450-e9fa-013a-da18-0acc26574db2/episode/d5287eb5-5416-4c58-9b7c-d1ba6d7f8fc8'
  const resolve = () => CrawlService.prototype.resolveShortLink.call({} as CrawlService, createMockCtx(), short)

  afterEach(() => vi.restoreAllMocks())

  test('resolves the reported share before episode classification', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 302, headers: { Location: episode } }))
    const resolved = await resolve()
    expect(resolved).toBe(episode)
    expect(classifyPodcastUrl(resolved)).toBe('pocketcasts')
    expect(fetch).toHaveBeenCalledExactlyOnceWith(short, expect.objectContaining({ method: 'GET', redirect: 'manual' }))
  })

  test('resolves a show share without classifying it as an episode', async () => {
    const show = 'https://pocketcasts.com/podcast/show/642bf450-e9fa-013a-da18-0acc26574db2'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 302, headers: { Location: show } }))
    const resolved = await resolve()
    expect(resolved).toBe(show)
    expect(classifyPodcastUrl(resolved)).toBeNull()
  })

  test.each([200, 302])('retains an unresolved share when status %s has no destination', async status => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }))
    expect(await resolve()).toBe(short)
    expect(fetch).toHaveBeenCalledOnce()
    expect(classifyPodcastUrl(short)).toBeNull()
  })

  test('retains the share on a transport failure', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await resolve()).toBe(short)
    expect(fetch).toHaveBeenCalledOnce()
  })

  test.each(['http://127.0.0.1/episode', 'https://user:password@example.com/episode', 'file:///episode'])('does not fetch an unsafe redirect: %s', async location => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 302, headers: { Location: location } }))
    expect(await resolve()).toBe(short)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(short, expect.objectContaining({ redirect: 'manual' }))
  })
})
