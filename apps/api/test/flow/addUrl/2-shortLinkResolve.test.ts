/**
 * /add_url Layer 2: 短链解析 tryResolveShortLink
 * 来源: bookmarkAdd.ts:118-134
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { createServer } from 'node:http'
import { BookmarkAddOrchestrator } from '@/domain/orchestrator/bookmarkAdd'
import { BookmarkService } from '@/domain/bookmark'
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

describe('Read-only receipt alias resolution', () => {
  const alias = 'https://x.com/i/status/123'
  const canonical = 'https://x.com/author/status/123'
  function receipt() {
    const hasActiveSave = vi.fn().mockResolvedValue(false)
    const crawl = createMockCrawlService()
    const service = Object.assign(Object.create(BookmarkService.prototype), { bookmarkRepo: { hasActiveSave }, crawlService: crawl }) as BookmarkService
    return { service, hasActiveSave, crawl, ctx: createMockCtx() }
  }

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test('finds a canonical identity only after checking the normalized original', async () => {
    const { service, hasActiveSave, crawl, ctx } = receipt()
    hasActiveSave.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    crawl.resolveFinalUrl.mockResolvedValue(canonical + '?s=20')
    expect(await service.saveReceipt(ctx, alias + '?s=20')).toBe(true)
    expect(hasActiveSave.mock.calls).toEqual([[ctx.getUserId(), alias], [ctx.getUserId(), canonical]])
    expect(crawl.resolveFinalUrl).toHaveBeenCalledExactlyOnceWith(ctx, alias, expect.any(AbortSignal))
    expect(crawl.pushBookmarkFailureAlert).not.toHaveBeenCalled()
    expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
  })

  test('finds the original fallback key without another provider read', async () => {
    const { service, hasActiveSave, crawl, ctx } = receipt()
    hasActiveSave.mockResolvedValue(true)
    expect(await service.saveReceipt(ctx, alias)).toBe(true)
    expect(crawl.resolveFinalUrl).not.toHaveBeenCalled()
  })

  test.each(['https://pca.st/6rpkp8cj', 'https://www.toutiao.com/article/123', 'https://t.co/abc', 'https://x.com/author/status/123'])(
    'does not resolve workflow-side or canonical identity %s', async targetUrl => {
      const { service, hasActiveSave, crawl, ctx } = receipt()
      expect(await service.saveReceipt(ctx, targetUrl)).toBe(false)
      expect(hasActiveSave).toHaveBeenCalledExactlyOnceWith(ctx.getUserId(), targetUrl)
      expect(crawl.resolveFinalUrl).not.toHaveBeenCalled()
      expect(crawl.resolveShortLink).not.toHaveBeenCalled()
    }
  )

  test('treats resolver failure as unconfirmed without alerts or workflows', async () => {
    const { service, crawl, ctx } = receipt()
    crawl.resolveFinalUrl.mockRejectedValue(new Error('provider unavailable'))
    expect(await service.saveReceipt(ctx, alias)).toBe(false)
    expect(crawl.pushBookmarkFailureAlert).not.toHaveBeenCalled()
    expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
  })

  test('aborts the provider read after two seconds', async () => {
    vi.useFakeTimers()
    const { service, crawl, ctx } = receipt()
    let signal: AbortSignal | undefined
    crawl.resolveFinalUrl.mockImplementation((_ctx: unknown, _url: string, abort: AbortSignal) => {
      signal = abort
      return new Promise((_resolve, reject) => abort.addEventListener('abort', () => reject(abort.reason), { once: true }))
    })
    const result = service.saveReceipt(ctx, alias)
    await vi.advanceTimersByTimeAsync(1999)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBe(false)
    expect(signal?.aborted).toBe(true)
    expect(crawl.resolveFinalUrl).toHaveBeenCalledOnce()
    expect(crawl.pushBookmarkFailureAlert).not.toHaveBeenCalled()
  })

  test('propagates canonical lookup database failure instead of reporting absence', async () => {
    const { service, hasActiveSave, crawl, ctx } = receipt()
    const failure = new Error('database unavailable')
    hasActiveSave.mockResolvedValueOnce(false).mockRejectedValueOnce(failure)
    crawl.resolveFinalUrl.mockResolvedValue(canonical)
    await expect(service.saveReceipt(ctx, alias)).rejects.toBe(failure)
  })

  test.each(['headers', 'success-body', 'error-body'])('aborts a real provider response stalled at %s within the receipt budget', async phase => {
    let requests = 0
    const server = createServer((_request, response) => {
      requests++
      if (phase === 'headers') return
      response.writeHead(phase === 'success-body' ? 200 : 503, { 'Content-Type': 'application/json' })
      response.flushHeaders()
      response.write('{')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a local HTTP port')
    const nativeFetch = globalThis.fetch.bind(globalThis)
    let providerSignal: AbortSignal | null | undefined
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      providerSignal = init?.signal
      return nativeFetch(`http://127.0.0.1:${address.port}`, init)
    })
    const { service, hasActiveSave, ctx } = receipt()
    Object.assign(service, { crawlService: Object.create(CrawlService.prototype) })
    const started = performance.now()
    try {
      expect(await service.saveReceipt(ctx, alias)).toBe(false)
      expect(performance.now() - started).toBeGreaterThanOrEqual(1900)
      expect(performance.now() - started).toBeLessThan(3000)
      expect(providerSignal?.aborted).toBe(true)
      expect(requests).toBe(1)
      expect(fetch).toHaveBeenCalledOnce()
      expect(hasActiveSave).toHaveBeenCalledOnce()
      expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  test('retains default provider options for ordinary resolver callers', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'success', tweets: [{ author: { userName: 'author' } }] })))
    const crawl = Object.create(CrawlService.prototype) as CrawlService
    expect(await crawl.resolveFinalUrl(createMockCtx(), alias)).toBe(canonical)
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('signal')
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
