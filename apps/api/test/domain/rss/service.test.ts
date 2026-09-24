import { describe, expect, test, vi } from 'vitest'
import { RssService, encodeRssCursor, decodeRssCursor, normalizeRssRemark } from '@/domain/rss'
import { RssController } from '@/handler/http/rssController'
import { createMockCtx } from '@test/helpers/mockFactory'
import { RssError } from '@/domain/rss/feed'
import { buildImageProxyUrl } from '@/utils/imager'
import { hashMD5 } from '@/utils/strings'
import { createHash } from 'node:crypto'
import { RssContent } from '@/domain/rss/content'
import { memoryRssBucket } from './testBucket'
import * as feedApi from '@/domain/rss/feed'

// Workers supports WebCrypto MD5; Node's WebCrypto does not. Keep the real digest semantics.
vi.mock('@/utils/strings', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/strings')>()),
  hashMD5: async (source: string | Uint8Array) => createHash('md5').update(source).digest('hex')
}))

function wire(enabled = true) {
  const repo = {
    contentKeys: vi.fn().mockResolvedValue(new Map()),
    reuseForAdd: vi.fn().mockResolvedValue(null),
    beginAdd: vi.fn(),
    finishAdd: vi.fn(),
    failAdd: vi.fn(),
    hasActiveSubscribers: vi.fn().mockResolvedValue(true),
    finish: vi.fn(),
    subscriptions: vi.fn().mockResolvedValue([]),
    updateRemark: vi.fn(),
    entry: vi.fn(),
    save: vi.fn(),
    entries: vi.fn().mockResolvedValue([]),
    historyFeeds: vi.fn().mockResolvedValue([]),
    claimHistory: vi.fn().mockResolvedValue(null),
    finishHistory: vi.fn().mockResolvedValue(true),
    claim: vi.fn(),
    saveJobs: vi.fn().mockResolvedValue([]),
    ackSave: vi.fn()
  }
  const labs = { isEnabled: vi.fn().mockResolvedValue(enabled), assertUrlAllowed: vi.fn() }
  const search = { upsertUserBookmark: vi.fn() }
  const bookmarks = { createBookmarkChangeLog: vi.fn() }
  const bucket = memoryRssBucket()
  const content = new RssContent(() => bucket.client as never)
  const service = new RssService(repo as never, labs as never, search as never, bookmarks as never, { clearSearchCache: vi.fn() } as never, content)
  const ctx = createMockCtx({ userId: 7 })
  return { service, repo, labs, search, bookmarks, ctx, content, bucket }
}
describe('RSS service boundaries', () => {
  test('normalizes display names and rejects invalid remarks', () => {
    expect(normalizeRssRemark('  My feed  ')).toBe('My feed')
    for (const value of [null, undefined, '  ']) expect(normalizeRssRemark(value)).toBeNull()
    for (const value of [42, {}, 'x'.repeat(121), 'name\nother']) expect(() => normalizeRssRemark(value)).toThrow('invalid_remark')
  })
  test('accepts explicit clearing but rejects missing or oversized remark updates', async () => {
    const { ctx } = wire()
    const update = vi.fn().mockResolvedValue({ id: 'id', remark: null })
    const controller = new RssController({ update } as never)
    const request = (body: unknown) =>
      new Request('https://api.example/v1/rss/subscriptions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/update', { method: 'POST', body: JSON.stringify(body) })
    expect((await controller.updateSubscription(ctx, request({ remark: null }))).status).toBe(200)
    expect(update).toHaveBeenCalledWith(ctx, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null)
    expect((await controller.updateSubscription(ctx, request({}))).status).toBe(400)
    expect((await controller.updateSubscription(ctx, request({ remark: 'x'.repeat(9000) }))).status).toBe(413)
    expect(update).toHaveBeenCalledTimes(1)
  })
  const article = () => ({
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    subscription_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    feed_id: 'feed',
    content_key: null,
    source_title: 'Example',
    title: 'Article with images',
    author: null,
    summary: 'Summary',
    article_url: 'https://example.com/article',
    image_url: 'https://example.com/cover.png',
    published_at: null,
    first_seen_at: new Date('2026-09-23'),
    sort_at: new Date('2026-09-23'),
    bookmark_user_uuid: null,
    content_html: '<p>Readable text</p><img src="https://example.com/body.png">',
    content_truncated: false
  })
  test('ordinary list reads keep history available without fetching it', async () => {
    const { service, repo, ctx } = wire()
    repo.entries.mockResolvedValue([article()])
    repo.historyFeeds.mockResolvedValue([{ id: 'feed', history_url: 'https://example.com/older', history_checked_at: new Date(), error: null }])
    const fetch = vi.spyOn(feedApi, 'fetchFeed')
    try {
      expect(await service.entries(ctx, {})).toMatchObject({ has_more: true, cached_more: false, history_status: 'available' })
      expect(fetch).not.toHaveBeenCalled()
      expect(repo.claimHistory).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })
  test('Load more fills a short cached page from history, saves, then queries again', async () => {
    const { service, repo, ctx } = wire()
    const candidate = { id: 'feed', feed_url: 'https://example.com/rss', history_url: 'https://example.com/older', history_checked_at: new Date(), error: null }
    repo.entries.mockResolvedValueOnce([]).mockResolvedValueOnce([article()])
    repo.historyFeeds.mockResolvedValueOnce([candidate]).mockResolvedValueOnce([{ ...candidate, history_url: null }])
    repo.claimHistory.mockResolvedValue(candidate)
    const fetch = vi
      .spyOn(feedApi, 'fetchFeed')
      .mockResolvedValue({ unchanged: false, etag: null, lastModified: null, feed: { title: 'Archive', site_url: null, items: [], next_url: null } })
    try {
      expect(await service.entries(ctx, { fetch_history: '1' })).toMatchObject({ has_more: false, history_status: 'exhausted', items: [{ id: article().id }] })
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fetch).toHaveBeenCalledWith(candidate.history_url, {}, 30_000, ctx.env)
      expect(repo.finishHistory).toHaveBeenCalledOnce()
      expect(repo.entries).toHaveBeenCalledTimes(2)
    } finally {
      fetch.mockRestore()
    }
  })
  test('Load more uses an existing full cache page before contacting the source', async () => {
    const { service, repo, ctx } = wire()
    repo.entries.mockResolvedValue(Array.from({ length: 21 }, () => article()))
    repo.historyFeeds.mockResolvedValue([{ id: 'feed', history_url: 'https://example.com/older', history_checked_at: new Date(), error: null }])
    expect(await service.entries(ctx, { fetch_history: '1' })).toMatchObject({ cached_more: true, has_more: true })
    expect(repo.claimHistory).not.toHaveBeenCalled()
  })
  test.each(['http://localhost:8788/static/image', 'http://127.0.0.1:8788/static/image', 'http://192.168.1.10:8788/static/image'])(
    'serves list and preview with a signed local development proxy: %s',
    async prefix => {
      const { service, ctx, repo, content } = wire()
      ctx.env.RUN_ENV = 'development'
      ctx.env.PROXY_IMAGE_PREFIX = prefix
      const cached = { ...article(), ...(await content.storeItem(ctx.env, 'feed', article())) }
      repo.entries.mockResolvedValue([cached])
      repo.entry.mockResolvedValue(cached)
      const response = await new RssController(service).listEntries(ctx, new Request('http://localhost:8787/v1/rss/entries?limit=20'))
      expect(response.status).toBe(200)
      const payload = (await response.json()) as { data: { items: { image_url: string }[] } }
      const image = new URL(payload.data.items[0].image_url)
      expect(image.origin + image.pathname).toBe(prefix)
      expect(image.searchParams.get('m')).toBe('rss')
      expect(image.searchParams.get('d')).toBe(await hashMD5(image.searchParams.get('u')! + image.searchParams.get('r')! + ctx.env.IMAGER_CHECK_DIGST_SALT + 'rss'))
      const detail = await service.detail(ctx, article().id)
      expect(detail.content_html).toContain(prefix)
      expect(detail.content_html).toContain('m=rss')
      expect(detail.content_html).not.toContain('src="https://example.com/')
    }
  )
  test.each(['http://images.example.com/static/image', 'not a URL', 'javascript:alert(1)', 'https://user:password@images.example.com/'])(
    'keeps text available when production proxy is invalid: %s',
    async prefix => {
      const { service, ctx, repo, content } = wire()
      ctx.env.RUN_ENV = 'production'
      ctx.env.PROXY_IMAGE_PREFIX = prefix
      const cached = { ...article(), ...(await content.storeItem(ctx.env, 'feed', article())) }
      repo.entries.mockResolvedValue([cached])
      repo.entry.mockResolvedValue(cached)
      await expect(buildImageProxyUrl(ctx.env, article().image_url, '', 'rss')).rejects.toThrow()
      const list = await service.entries(ctx, {})
      // The proxy cannot be built here, so the entry publishes no image rather than
      // falling back to the address the feed provided.
      expect(list.items[0]).toMatchObject({ title: 'Article with images', image_url: null })
      const detail = await service.detail(ctx, article().id)
      expect(detail.image_url).toBeNull()
      expect(detail.content_html).toContain('Readable text')
      // The stored preview body still references the feed's own image.
      expect(detail.content_html).toContain('src="https://example.com/body.png"')
    }
  )
  test('isolates malformed thumbnail rows while retaining valid images', async () => {
    const { service, ctx, repo, content } = wire()
    const invalid = { ...article(), image_url: 'http://127.0.0.1/private' }
    repo.entries.mockResolvedValue([
      { ...invalid, ...(await content.storeItem(ctx.env, 'feed', invalid)) },
      { ...article(), ...(await content.storeItem(ctx.env, 'feed', article())) }
    ])
    const list = await service.entries(ctx, {})
    expect(list.items[0].image_url).toBeNull()
    expect(list.items[1].image_url).toContain('m=rss')
  })
  test('rejects oversized add bodies before invoking the feed service', async () => {
    const { ctx } = wire()
    const add = vi.fn()
    const response = await new RssController({ add } as never).addSubscription(
      ctx,
      new Request('https://api.example/v1/rss/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/' + 'x'.repeat(9000) })
      })
    )
    expect(response.status).toBe(413)
    expect(add).not.toHaveBeenCalled()
  })
  test('all reads and mutations require the lab before touching data', async () => {
    const { service, ctx, repo } = wire(false)
    for (const work of [
      () => service.subscriptions(ctx),
      () => service.entries(ctx, {}),
      () => service.detail(ctx, 'id'),
      () => service.add(ctx, 'https://example.com'),
      () => service.update(ctx, 'id', 'My feed'),
      () => service.remove(ctx, 'id'),
      () => service.refresh(ctx, 'id'),
      () => service.save(ctx, 'id')
    ])
      await expect(work()).rejects.toMatchObject({ code: 'lab_disabled' })
    for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled()
  })
  test('binds pagination to account and selected feed and rejects malformed input', () => {
    const row = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', sort_at: new Date('2026-09-23') } as never
    const cursor = encodeRssCursor(7, 'feed', row)
    expect(decodeRssCursor(cursor, 7, 'feed')?.id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    for (const [raw, user, feed] of [
      [cursor, 8, 'feed'],
      [cursor, 7, null],
      ['malformed', 7, 'feed']
    ] as const)
      expect(() => decodeRssCursor(raw, user, feed)).toThrow('not_found')
  })
  test('does not dispatch a second refresh for an existing lease', async () => {
    const { service, ctx, repo } = wire()
    repo.claim.mockResolvedValue({ claimed: false, next_allowed_at: new Date() })
    expect(await service.refresh(ctx, 'id')).toMatchObject({ status: 'refreshing' })
    expect(ctx.execution.waitUntil).not.toHaveBeenCalled()
  })
  test('never starts a bookmark crawl for an entry without an original URL', async () => {
    const { service, ctx, repo } = wire()
    repo.entry.mockResolvedValue({ article_url: null })
    await expect(service.save(ctx, 'id')).rejects.toMatchObject({ code: 'article_url_missing' })
    expect(repo.save).not.toHaveBeenCalled()
  })
  test('retry after ambiguous workflow creation reuses its deterministic ID', async () => {
    const { service, ctx, repo, bookmarks } = wire()
    repo.saveJobs.mockResolvedValue([{ bookmark_id: 42, user_id: 7, target_url: 'https://example.com/article', lang: 'en', status: 'pending' }])
    const create = vi.fn().mockRejectedValue(new Error('ambiguous'))
    const status = vi.fn().mockResolvedValue({ status: 'running' })
    const get = vi.fn().mockResolvedValue({ status })
    ctx.env.CRAWL_WORKFLOW = { create, get } as never
    await service.dispatchSaves(ctx)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: 'rss-bookmark-42' }))
    expect(get).toHaveBeenCalledWith('rss-bookmark-42')
    expect(status).toHaveBeenCalled()
    expect(bookmarks.createBookmarkChangeLog).toHaveBeenCalled()
    expect(repo.ackSave).toHaveBeenCalledWith(42)
  })
  test('leaves outbox pending when neither create nor lookup is confirmed', async () => {
    const { service, ctx, repo } = wire()
    repo.saveJobs.mockResolvedValue([{ bookmark_id: 42, user_id: 7, target_url: 'https://example.com/article', status: 'pending' }])
    ctx.env.CRAWL_WORKFLOW = { create: vi.fn().mockRejectedValue(new Error()), get: vi.fn().mockRejectedValue(new Error()) } as never
    await service.dispatchSaves(ctx)
    expect(repo.ackSave).not.toHaveBeenCalled()
  })
  test('returns stable machine errors and disables HTTP caching', async () => {
    const { service, ctx } = wire(false)
    const controller = new RssController(service)
    const response = await controller.listSubscriptions(ctx, new Request('https://api.example/v1/rss/subscriptions'))
    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ message: 'lab_disabled', data: { error: 'lab_disabled' } })
  })
  test('returns Retry-After on cooldown', async () => {
    const { service, ctx, repo } = wire()
    repo.claim.mockRejectedValue(new RssError('refresh_limited', 429, new Date(Date.now() + 300_000)))
    const response = await new RssController(service).refreshSubscription(ctx, new Request('https://api.example/v1/rss/subscriptions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/refresh'))
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(298)
  })
})

describe('RSS shared cache service', () => {
  test.each(['source_unavailable', 'invalid_feed'] as const)('initial %s does not reserve or persist a feed', async code => {
    const { service, repo, ctx, bucket } = wire()
    ctx.env.RUN_ENV = 'development'
    const fetch = vi.spyOn(feedApi, 'fetchFeed').mockRejectedValue(new RssError(code))
    try {
      await expect(service.add(ctx, 'https://example.com/rss')).rejects.toMatchObject({ code })
      expect(repo.beginAdd).not.toHaveBeenCalled()
      expect(repo.finishAdd).not.toHaveBeenCalled()
      expect(repo.failAdd).not.toHaveBeenCalled()
      expect(bucket.objects.size).toBe(0)
    } finally {
      fetch.mockRestore()
    }
  })
  test('adding an already cached shared feed does no network or object write', async () => {
    const { service, repo, ctx, bucket } = wire()
    ctx.env.RUN_ENV = 'development'
    const fetch = vi.spyOn(feedApi, 'fetchFeed')
    repo.reuseForAdd.mockResolvedValue({ id: 'sub', feed_id: 'feed', remark: 'Mine', next_fetch_at: new Date(), next_allowed_at: new Date() })
    expect(await service.add(ctx, 'https://example.com/rss', 'Mine')).toMatchObject({ id: 'sub', remark: 'Mine' })
    expect(fetch).not.toHaveBeenCalled()
    expect(bucket.objects.size).toBe(0)
    fetch.mockRestore()
  })
  test('R2 write failure never publishes new feed entries', async () => {
    const { service, repo, ctx, bucket } = wire()
    ctx.env.RUN_ENV = 'development'
    const fetched = {
      unchanged: false as const,
      etag: 'a',
      lastModified: null,
      feed: await feedApi.parseFeed('<rss><channel><title>A</title><item><guid>one</guid><description>text</description></item></channel></rss>', 'https://example.com/rss')
    }
    const fetch = vi.spyOn(feedApi, 'fetchFeed').mockResolvedValue(fetched)
    repo.beginAdd.mockResolvedValue({ feed: { id: 'feed', lease_token: 'lease' } })
    bucket.client.putIfKeyExists.mockRejectedValue(new Error('R2 unavailable'))
    await expect(service.add(ctx, 'https://example.com/rss')).rejects.toMatchObject({ code: 'source_unavailable' })
    expect(repo.finishAdd).not.toHaveBeenCalled()
    expect(repo.failAdd).toHaveBeenCalled()
    fetch.mockRestore()
  })
  test('refresh preserves published content on R2 failure and 304 does not rewrite objects', async () => {
    const { service, repo, ctx, bucket } = wire()
    const claim = { id: 'feed', feed_url: 'https://example.com/rss', claimed: true, next_allowed_at: new Date(), lease_token: 'lease' }
    repo.claim.mockResolvedValue(claim)
    const fetched = {
      unchanged: false as const,
      etag: 'a',
      lastModified: null,
      feed: await feedApi.parseFeed('<rss><channel><title>A</title><item><guid>one</guid><description>text</description></item></channel></rss>', 'https://example.com/rss')
    }
    const fetch = vi.spyOn(feedApi, 'fetchFeed').mockResolvedValue(fetched)
    bucket.client.putIfKeyExists.mockRejectedValueOnce(new Error('offline'))
    await service.refresh(ctx, 'sub')
    await (ctx.execution.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(repo.finish).toHaveBeenCalledWith(claim, expect.objectContaining({ code: 'source_unavailable' }))
    repo.contentKeys.mockClear()
    bucket.client.putIfKeyExists.mockClear()
    fetch.mockResolvedValue({ unchanged: true })
    await service.refresh(ctx, 'sub')
    await (ctx.execution.waitUntil as ReturnType<typeof vi.fn>).mock.calls[1][0]
    expect(repo.finish).toHaveBeenLastCalledWith(claim, { unchanged: true })
    expect(repo.contentKeys).not.toHaveBeenCalled()
    expect(bucket.client.putIfKeyExists).not.toHaveBeenCalled()
    fetch.mockRestore()
  })
  test('stored HTML is returned unchanged without image reparsing or writes', async () => {
    const { service, repo, ctx, bucket } = wire()
    bucket.objects.set('rss-content/feed/body', { body: '<p>One</p><p>Two</p>', uploaded: new Date() })
    repo.entry.mockResolvedValue({ id: 'id', content_key: 'rss-content/feed/body', first_seen_at: new Date() })
    expect((await service.detail(ctx, 'id')).content_html).toBe('<p>One</p><p>Two</p>')
    expect(bucket.client.putIfKeyExists).not.toHaveBeenCalled()
  })
})
