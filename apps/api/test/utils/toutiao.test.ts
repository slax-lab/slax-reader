import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { isToutiaoShareUrl, parseToutiaoArticleUrl, resolveToutiaoUrl } from '@/utils/toutiaoUrl'
import { detectRoute, isSocialMediaRoute } from '@/utils/platformDetector'
import { buildToutiaoArticle } from '@/utils/toutiaoArticle'
import { fetchToutiaoArticle } from '@/infra/external/toutiao'

const id = '7694114872820384290'
const canonical = `https://www.toutiao.com/article/${id}/`
const share = 'https://m.toutiao.com/is/CI_XBMsL7IU/'
const payload = (article: Record<string, unknown> = {}) => ({
  code: 200,
  data: {
    message: 'success',
    data: {
      content: '<p>First article paragraph.</p><p>Second paragraph.</p><img src="https://example.com/photo.jpg">',
      h5_extra: { title: 'Article title', name: 'Author', publish_stamp: '1791426370', str_group_id: id },
      ...article
    }
  }
})
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Toutiao URL compatibility', () => {
  test.each(['toutiao.com', 'www.toutiao.com', 'm.toutiao.com'])('canonicalizes every supported path on %s without numeric rounding', host => {
    for (const path of [`article/${id}`, `group/${id}`, `a${id}`, `i${id}`]) {
      for (const suffix of ['', '/', '/?tracking=1#section']) {
        expect(parseToutiaoArticleUrl(`https://${host}/${path}${suffix}`)).toEqual({ articleId: id, canonicalUrl: canonical })
        expect(detectRoute(`http://${host}/${path}${suffix}`)).toBe('toutiao')
      }
    }
    expect(isSocialMediaRoute('toutiao')).toBe(false)
  })

  test.each([
    'https://toutiao.com.example.com/article/123/',
    'https://example.com/?url=https://toutiao.com/article/123/',
    'https://user@toutiao.com/article/123/',
    'https://m.toutiao.com:8080/article/123/',
    'ftp://toutiao.com/article/123/',
    'https://toutiao.com/video/123/',
    'https://toutiao.com/article/123/extra',
    'https://toutiao.com/?group_id=123'
  ])('does not classify %s as an article', url => {
    expect(parseToutiaoArticleUrl(url)).toBeNull()
    expect(detectRoute(url)).toBe('regular')
  })

  test.each([share, 'https://t.toutiao.com/abc/', 'https://toutiaolink.com/abc/', 'https://www.toutiaolink.com/abc/'])('recognizes share %s', url => {
    expect(isToutiaoShareUrl(url)).toBe(true)
    expect(detectRoute(url)).toBe('toutiao')
  })
})

describe('bounded share resolution', () => {
  test('follows relative and absolute GET redirects without authorization and stops before the article page', async () => {
    const cancel = vi.fn()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 302, headers: { Location: '/is/second/' } }))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { Location: `https://m.toutiao.com/a${id}/?track=1` } }))
    vi.stubGlobal('fetch', fetch)
    expect(await resolveToutiaoUrl(share)).toEqual({ articleId: id, canonicalUrl: canonical })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalled()
    for (const [, init] of fetch.mock.calls) {
      expect(init.method).toBe('GET')
      expect(init.redirect).toBe('manual')
      expect(new Headers(init.headers).has('Authorization')).toBe(false)
    }
  })

  test('accepts exactly five redirects but rejects a sixth', async () => {
    const fetch = vi.fn().mockImplementation((url: string) => {
      const hop = Number(new URL(url).pathname.match(/\d+/)?.[0] ?? 0)
      return Promise.resolve(new Response(null, { status: 302, headers: { Location: hop === 4 ? canonical : `/is/hop${hop + 1}/` } }))
    })
    vi.stubGlobal('fetch', fetch)
    expect((await resolveToutiaoUrl('https://m.toutiao.com/is/hop0/')).articleId).toBe(id)
    expect(fetch).toHaveBeenCalledTimes(5)
    fetch
      .mockClear()
      .mockImplementation((url: string) => Promise.resolve(new Response(null, { status: 302, headers: { Location: new URL(url).pathname.replace(/\/$/, '') + 'x/' } })))
    await expect(resolveToutiaoUrl(share)).rejects.toThrow('five redirects')
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  test.each([
    'https://example.com/article/123/',
    'http://127.0.0.1/article/123/',
    'https://toutiao.com.evil.test/article/123/',
    'https://m.toutiao.com/video/123/',
    'https://user:password@m.toutiao.com/article/123/'
  ])('rejects redirect %s before requesting it', async location => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: location } }))
    vi.stubGlobal('fetch', fetch)
    await expect(resolveToutiaoUrl(share)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('rejects loops and non-redirect challenges', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: share } }))
    vi.stubGlobal('fetch', fetch)
    await expect(resolveToutiaoUrl(share)).rejects.toThrow('loop')
    fetch.mockResolvedValue(new Response('<script>challenge</script>'))
    await expect(resolveToutiaoUrl(share)).rejects.toThrow('expired or returned a challenge')
  })

  test('bounds even a transport that ignores AbortSignal', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )
    const failure = expect(resolveToutiaoUrl(share)).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(10_001)
    await failure
  })
})

describe('TikHub Web adapter', () => {
  test('uses exact aweme_id and returns a complete normalized article', async () => {
    const fetch = vi.fn().mockResolvedValue(json(payload()))
    vi.stubGlobal('fetch', fetch)
    const article = await fetchToutiaoArticle('test-token', canonical)
    const [url, init] = fetch.mock.calls[0]
    expect(new URL(url).pathname).toBe('/api/v1/toutiao/web/get_article_info')
    expect(new URL(url).searchParams.get('aweme_id')).toBe(id)
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-token')
    expect(article).toMatchObject({
      articleId: id,
      canonicalUrl: canonical,
      title: 'Article title',
      author: 'Author',
      siteName: 'Toutiao',
      publishedAt: '2026-10-08T02:26:10.000Z'
    })
    expect(article.text).toContain('Second paragraph.')
    expect(article.html).toContain('photo.jpg')
  })

  test('requires credentials before any network request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(fetchToutiaoArticle('', share)).rejects.toThrow('TIKHUB_TOKEN is missing')
    expect(fetch).not.toHaveBeenCalled()
  })

  test.each([
    {},
    { code: 500, data: {} },
    { code: 200, data: { message: 'failure', data: { content: 'text' } } },
    { code: 200, data: { message: 'success', data: { title: 'Metadata only' } } },
    payload({ content: '' }),
    payload({ content: '<script>attack()</script>' }),
    payload({ content: '该内容已删除' }),
    payload({ delete: 1 }),
    payload({ delete: '1' }),
    payload({ h5_extra: { str_group_id: '123' } })
  ])('rejects unsuccessful, missing, deleted or mismatched bodies', async value => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(value)))
    await expect(fetchToutiaoArticle('test-token', canonical)).rejects.toThrow()
  })

  test('never exposes raw provider errors or follows authorized redirects', async () => {
    const log = vi.spyOn(console, 'error')
    const fetch = vi.fn().mockResolvedValue(new Response('secret-token provider details', { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchToutiaoArticle('secret-token', canonical)).rejects.toThrow('HTTP 401')
    expect(log).not.toHaveBeenCalled()
    fetch.mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://example.com/' } }))
    await expect(fetchToutiaoArticle('secret-token', canonical)).rejects.toThrow('HTTP 302')
    expect(fetch).toHaveBeenCalledTimes(2)
    log.mockRestore()
  })

  test('malformed JSON and transport errors have safe messages', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('not json'))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchToutiaoArticle('test-token', canonical)).rejects.toThrow('invalid JSON')
    fetch.mockRejectedValue(new Error('sensitive raw provider response'))
    await expect(fetchToutiaoArticle('test-token', canonical)).rejects.toThrow('TikHub Toutiao request failed')
  })
})

describe('article document', () => {
  const input = { articleId: id, canonicalUrl: canonical, title: '<script>Title</script>"', author: '"><img src=x onerror=attack()>', content: '<p>Readable paragraph.</p>' }
  test('escapes metadata and strips executable markup while preserving body structure', () => {
    const article = buildToutiaoArticle({
      ...input,
      content:
        '<p onclick="attack()">Readable paragraph.</p><img src="https://example.com/photo.jpg" onerror="attack()"><a href="/article/123/">link</a><a href="jav&#x61;script:attack()">unsafe</a><script>attack()</script><iframe srcdoc="attack"></iframe><svg><script>attack()</script></svg><p style="background:url(javascript:attack())">Another paragraph</p>'
    })
    const { document } = parseHTML(article.html)
    expect(document.title).toBe(input.title)
    expect(document.querySelector('meta[name=author]')?.getAttribute('content')).toBe(input.author)
    expect(document.querySelectorAll('script,iframe,svg,[onclick],[onerror],[style]').length).toBe(0)
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://example.com/photo.jpg')
    expect([...document.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(['https://www.toutiao.com/article/123/', null])
    expect(document.querySelectorAll('p').length).toBe(2)
    expect(article.text).toContain('Readable paragraph.')
  })

  test.each(['NaN', '', '0', '-100', '999999999999999999999999999'])('invalid timestamp %s uses missing-date behavior', publishStamp => {
    const article = buildToutiaoArticle({ ...input, publishStamp })
    expect(article.publishedAt).toBeUndefined()
    expect(article.html).not.toContain('article:published_time')
  })
})
