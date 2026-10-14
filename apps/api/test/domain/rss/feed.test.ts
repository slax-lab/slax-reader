import { beforeEach, describe, expect, test, vi } from 'vitest'
import { parseFeed, sanitizeFeedHtml, normalizeFeedUrl, fetchFeed, retryAfter, RSS_LIMITS } from '@/domain/rss/feed'
import { publicFetch } from '@/utils/publicFetch'
vi.mock('@/utils/publicFetch', async importOriginal => ({ ...(await importOriginal<typeof import('@/utils/publicFetch')>()), publicFetch: vi.fn() }))
const rss = (items = '') => `<rss version="2.0"><channel><title>Example</title><link>https://example.com</link>${items}</channel></rss>`

describe('RSS parsing', () => {
  test.each(['next', 'prev-archive'])('reads RSS %s links without loading the next page', async rel => {
    const fetch = vi.mocked(publicFetch)
    const calls = fetch.mock.calls.length
    const result = await parseFeed(rss(`<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="${rel}" href="?page=2"/>`), 'https://example.com/feed')
    expect(result.next_url).toBe('https://example.com/feed?page=2')
    expect(fetch.mock.calls.length).toBe(calls)
  })
  test('resolves Atom history base and rejects private history URLs', async () => {
    const xml = '<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://example.com/archive/"><title>A</title><link rel="next" href="older.xml"/></feed>'
    expect((await parseFeed(xml, 'https://example.com/feed')).next_url).toBe('https://example.com/archive/older.xml')
    expect((await parseFeed(xml.replace('older.xml', 'http://127.0.0.1/feed'), 'https://example.com/feed')).next_url).toBeNull()
  })
  test('keeps a title/date fallback ID stable when content is revised', async () => {
    const xml = rss('<item><title>Stable title</title><description>First content</description></item>')
    const first = (await parseFeed(xml, 'https://example.com/feed')).items[0]
    const second = (await parseFeed(xml.replace('First content', 'Revised content'), 'https://example.com/feed')).items[0]
    expect(second.entry_key).toBe(first.entry_key)
    expect(second.content_html).toContain('Revised content')
  })
  test('accepts valid empty RSS and rejects HTML, DTD and missing channels', async () => {
    expect((await parseFeed(rss(), 'https://example.com/feed')).items).toEqual([])
    for (const xml of ['<html/>', '<rss/>', '<!DOCTYPE rss [<!ENTITY x "secret">]><rss/>'])
      await expect(parseFeed(xml, 'https://example.com')).rejects.toMatchObject({ code: 'invalid_feed' })
  })
  test('reads namespaced full content, relative images, stable IDs and dates', async () => {
    const xml = rss(
      '<item><guid isPermaLink="false">first</guid><title>Title</title><link>/article</link><pubDate>Tue, 22 Sep 2026 00:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Hello <img src="img.png"></p>]]></content:encoded></item>'
    )
    const [item] = (await parseFeed(xml, 'https://example.com/feed', new Date('2026-09-23'))).items
    expect(item.article_url).toBe('https://example.com/article')
    expect(item.image_url).toBe('https://example.com/img.png')
    expect(item.published_at?.toISOString()).toBe('2026-09-22T00:00:00.000Z')
    expect((await parseFeed(xml.replace('Hello', 'Updated'), 'https://example.com/feed')).items[0].entry_key).toBe(item.entry_key)
  })
  test('reads Atom alternate links and XHTML', async () => {
    const feed = await parseFeed(
      '<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://example.com/"><title>Atom</title><entry><id>urn:test</id><title>One</title><link rel="self" href="/xml"/><link rel="alternate" href="/article"/><author><name>Writer</name></author><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>A <b>bold</b> article</p></div></content></entry></feed>',
      'https://example.com/feed'
    )
    expect(feed.items[0]).toMatchObject({ article_url: 'https://example.com/article', author: 'Writer' })
    expect(feed.items[0].content_html).toContain('<b>bold</b>')
  })
  test('does not interpret plain Atom text as HTML', async () => {
    const feed = await parseFeed(
      '<feed><title>Atom</title><entry><id>one</id><content type="text">&lt;script&gt;hello&lt;/script&gt;</content></entry></feed>',
      'https://example.com'
    )
    expect(feed.items[0].content_html).toContain('&lt;script&gt;')
  })
  test('reads RDF siblings and removes duplicates', async () => {
    const item = '<item><title>One</title><link>https://example.com/1</link><dc:date>invalid</dc:date></item>'
    const feed = await parseFeed(
      `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel><title>RDF</title></channel>${item}${item}</rdf:RDF>`,
      'https://example.com/feed'
    )
    expect(feed.items).toHaveLength(1)
    expect(feed.items[0].published_at).toBeNull()
  })
  test('allows preview without URL and bounds entries', async () => {
    const feed = await parseFeed(
      rss(Array.from({ length: 250 }, (_, id) => `<item><guid isPermaLink="false">${id}</guid><title>${id}</title></item>`).join('')),
      'https://example.com/feed'
    )
    expect(feed.items).toHaveLength(200)
    expect(feed.items[0].article_url).toBeNull()
  })
  test.each(['http://127.0.0.1/rss', 'https://a:b@example.com/rss', 'file:///feed', 'http://10.0.0.1/rss'])('rejects unsafe URL %s', url =>
    expect(() => normalizeFeedUrl(url)).toThrow()
  )
  test('preserves private query semantics', () => expect(normalizeFeedUrl('https://example.com/rss?token=private#x')).toBe('https://example.com/rss?token=private'))
})

describe('HTML allowlist', () => {
  test('uses picture and srcset candidates when the img source is unusable', () => {
    const clean = sanitizeFeedHtml('<picture><source srcset="/real.png 1x, /large.png 2x"><img src="data:placeholder"></picture>', 'https://example.com/feed')
    expect(clean.image).toBe('https://example.com/real.png')
    expect(clean.html).not.toMatch(/source|srcset|placeholder/)
  })
  test('removes active content, styles, attributes and direct image alternatives', () => {
    const clean = sanitizeFeedHtml(
      '<script>alert(1)</script><svg><image href="https://evil.example"/></svg><p style="background:url(https://evil.example)" onclick=x>Text<a href="javascript:x">link</a><img src="/image.png" srcset="https://evil.example/a 2x" onerror=x></p>',
      'https://example.com'
    )
    expect(clean.html).not.toMatch(/script|svg|onerror|onclick|style|srcset|evil|javascript/i)
    expect(clean.html).toContain('src="https://example.com/image.png"')
  })
  test('normalizes lazy images and blocks private images', () => {
    const clean = sanitizeFeedHtml('<img src="data:x" data-src="../img.png"><img src="http://127.0.0.1/a">', 'https://example.com/a/b')
    expect(clean.image).toBe('https://example.com/img.png')
    expect(clean.html).not.toContain('127.0.0.1')
  })
  test('bounds deeply nested and long content', () => {
    expect(sanitizeFeedHtml('<div>'.repeat(100) + 'text' + '</div>'.repeat(100), 'https://example.com').truncated).toBe(true)
    expect(sanitizeFeedHtml('x'.repeat(600_000), 'https://example.com').html.length).toBeLessThan(256 * 1024)
  })
})

describe('conditional fetch', () => {
  test('uses safe transport budgets and validators, handles 304', async () => {
    vi.mocked(publicFetch).mockResolvedValueOnce(new Response(null, { status: 304 }))
    expect(await fetchFeed('https://example.com/feed', { etag: 'tag', last_modified: 'yesterday' })).toEqual({ unchanged: true })
    const [url, init, opts] = vi.mocked(publicFetch).mock.calls.at(-1)!
    expect(url).toBe('https://example.com/feed')
    expect(new Headers(init?.headers).get('If-None-Match')).toBe('tag')
    expect(opts).toMatchObject({ maxBytes: RSS_LIMITS.bytes, timeoutMs: 30_000 })
  })
  test('honors Retry-After and does not expose the source error', async () => {
    vi.mocked(publicFetch).mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '3600' } }))
    await expect(fetchFeed('https://example.com/feed?secret=token')).rejects.toMatchObject({ code: 'source_unavailable', nextAllowedAt: expect.any(Date) })
    vi.mocked(publicFetch).mockRejectedValueOnce(new Error('private secret token'))
    await expect(fetchFeed('https://example.com/feed')).rejects.toThrow('source_unavailable')
  })
  test('handles integer and HTTP date Retry-After values', () => {
    const now = new Date('2026-09-23T00:00:00Z')
    expect(retryAfter('60', now)?.valueOf()).toBe(now.valueOf() + 60_000)
    expect(retryAfter('Wed, 23 Sep 2026 00:01:00 GMT', now)?.valueOf()).toBe(now.valueOf() + 60_000)
    expect(retryAfter('not-a-date', now)).toBeUndefined()
  })
})

describe('Cloudflare feed fallback', () => {
  const env = { ZYTE_API_KEY: 'fixture-key' } as Env
  const target = 'https://example.com/feed'
  const challenge = () => new Response('<html>challenge</html>', { status: 403, headers: { 'cf-mitigated': 'challenge' } })
  const zyte = (xml = rss(), extra: Record<string, unknown> = {}) =>
    Response.json({
      url: target,
      statusCode: 200,
      httpResponseBody: btoa(xml),
      httpResponseHeaders: [{ name: 'ETag', value: 'feed-tag' }],
      ...extra
    })
  beforeEach(() => vi.mocked(publicFetch).mockReset())
  test('keeps successful first-page requests on the direct transport', async () => {
    vi.mocked(publicFetch).mockResolvedValueOnce(new Response(rss('<atom:link rel="next" href="?page=2"/>')))
    const result = await fetchFeed(target, {}, 30_000, env)
    expect(result).toMatchObject({ unchanged: false, feed: { next_url: target + '?page=2' } })
    expect(publicFetch).toHaveBeenCalledTimes(1)
  })
  test.each([true, false])('retrieves original XML after a Cloudflare challenge (header=%s)', async header => {
    vi.mocked(publicFetch)
      .mockResolvedValueOnce(header ? challenge() : new Response('<html><script src="/cdn-cgi/challenge-platform/check.js"></script></html>'))
      .mockResolvedValueOnce(zyte('<?xml version="1.0"?><rss><channel><title>A</title><atom:link rel="next" href="?page=2"/></channel></rss>'))
    expect(await fetchFeed(target, { etag: 'old' }, 30_000, env)).toMatchObject({ unchanged: false, etag: 'feed-tag', feed: { next_url: target + '?page=2' } })
    expect(publicFetch).toHaveBeenCalledTimes(2)
    const [api, init] = vi.mocked(publicFetch).mock.calls[1]
    expect(api).toBe('https://api.zyte.com/v1/extract')
    expect(JSON.parse(init!.body as string)).toMatchObject({ url: target, httpResponseBody: true, httpResponseHeaders: true, followRedirect: false, verifyCertificate: true })
    expect(JSON.parse(init!.body as string)).not.toHaveProperty('browserHtml')
    expect(new Headers(vi.mocked(publicFetch).mock.calls[0][1]?.headers).has('Authorization')).toBe(false)
  })
  test('validates each provider redirect and drops validators across origins', async () => {
    vi.mocked(publicFetch)
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(zyte('', { statusCode: 302, httpResponseHeaders: [{ name: 'Location', value: 'https://archive.example.net/rss' }] }))
      .mockResolvedValueOnce(zyte(rss(), { url: 'https://archive.example.net/rss' }))
    await fetchFeed(target, { etag: 'private-validator' }, 30_000, env)
    const body = JSON.parse(vi.mocked(publicFetch).mock.calls[2][1]!.body as string)
    expect(body.url).toBe('https://archive.example.net/rss')
    expect(body.customHttpRequestHeaders.some((h: { name: string }) => h.name === 'if-none-match')).toBe(false)
    expect(body.customHttpRequestHeaders.some((h: { name: string }) => h.name === 'authorization')).toBe(false)
  })
  test('rejects a private provider redirect before requesting it', async () => {
    vi.mocked(publicFetch)
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(zyte('', { statusCode: 302, httpResponseHeaders: [{ name: 'Location', value: 'http://127.0.0.1/feed' }] }))
    await expect(fetchFeed(target, {}, 30_000, env)).rejects.toMatchObject({ code: 'source_unavailable' })
    expect(publicFetch).toHaveBeenCalledTimes(2)
  })
  test.each([429, 503])('respects source Retry-After instead of paying for another request (%s)', async status => {
    vi.mocked(publicFetch).mockResolvedValueOnce(new Response('', { status, headers: { 'cf-mitigated': 'challenge', 'Retry-After': '3600' } }))
    await expect(fetchFeed(target, {}, 30_000, env)).rejects.toMatchObject({ code: 'source_unavailable', nextAllowedAt: expect.any(Date) })
    expect(publicFetch).toHaveBeenCalledTimes(1)
  })
  test('does not retry ordinary invalid feeds or repeated provider challenges', async () => {
    vi.mocked(publicFetch).mockResolvedValueOnce(new Response('<html>not a feed</html>'))
    await expect(fetchFeed(target, {}, 30_000, env)).rejects.toMatchObject({ code: 'invalid_feed' })
    expect(publicFetch).toHaveBeenCalledTimes(1)
    vi.mocked(publicFetch).mockReset().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(zyte('<html><script>_cf_chl_opt={}</script></html>'))
    await expect(fetchFeed(target, {}, 30_000, env)).rejects.toMatchObject({ code: 'source_unavailable' })
    expect(publicFetch).toHaveBeenCalledTimes(2)
  })
})
