import { afterEach, describe, expect, test, vi } from 'vitest'
import { CrawlService } from '@/domain/crawl'
import { Imager } from '@/utils/imager'
import { ContentParser } from '@/utils/parser'
import { parseHTML } from 'linkedom'
import { SocialMediaApi } from '@/infra/external/socialMedia'
import { SlaxFetch } from '@/infra/external/remoteFetcher'
import { buildToutiaoArticle } from '@/utils/toutiaoArticle'
import { createMockBookmarkRepo, createMockBucketClient, createMockCtx } from '@test/helpers/mockFactory'

const id = '7694114872820384290'
const canonicalUrl = `https://www.toutiao.com/article/${id}/`
const paragraph = 'A complete article paragraph describes the report and contains substantial readable content for the reader and downstream article processing. '

function wire() {
  const bucket = createMockBucketClient()
  const repo = createMockBookmarkRepo()
  const service = Object.assign(Object.create(CrawlService.prototype), { bucketClient: bucket.factory, bookmarkRepo: repo }) as CrawlService
  const ctx = createMockCtx()
  const images = vi.spyOn(Imager.prototype, 'batchReplaceImage').mockImplementation(async (_url, document) => {
    document.querySelectorAll('img').forEach(img => img.setAttribute('src', 'https://reader-img.slax.dev/proxied.jpg'))
  })
  const fetched = buildToutiaoArticle({
    articleId: id,
    canonicalUrl,
    title: 'Authoritative title',
    author: 'Authoritative author',
    publishStamp: '1791426370',
    content: `<p>${paragraph.repeat(4)}</p><p>${paragraph.repeat(4)}</p><img src="https://example.com/body.jpg">`
  })
  return { bucket, repo, service, ctx, images, fetched }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Toutiao bookmark capture', () => {
  test('persists the complete provider body, authoritative metadata and replaced images', async () => {
    const { service, ctx, fetched, images, repo, bucket } = wire()
    const result = await service.parseAndSaveToutiao(ctx, fetched, 42, 'toutiao-test')
    expect(result).toMatchObject({
      title: fetched.title,
      byline: fetched.author,
      siteName: 'Toutiao',
      publishedTime: new Date(fetched.publishedAt!),
      contentKey: 'html/body/toutiao-test.html'
    })
    expect(result.textContent).toContain(paragraph.trim())
    expect(images).toHaveBeenCalledOnce()
    expect(bucket.putIfKeyExists).toHaveBeenCalledWith('text/body/toutiao-test.txt', expect.stringContaining(paragraph.trim()))
    expect(bucket.putIfKeyExists).toHaveBeenCalledWith('html/body/toutiao-test.html', expect.stringContaining('https://reader-img.slax.dev/proxied.jpg'))
    expect(repo.updateBookmark).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ title: fetched.title, byline: fetched.author, published_at: new Date(fetched.publishedAt!), site_name: 'Toutiao', status: 'success' })
    )
    expect(result.qualityReview).toBeDefined()
  })

  test('does not re-extract an already normalized body or discard lead images and short paragraphs', async () => {
    const { service, ctx, fetched, bucket } = wire()
    const content = `<p><img src="https://example.com/lead.jpg" width="100" height="50"></p>${Array.from({ length: 60 }, (_, i) => `<p>Paragraph ${i}.</p>`).join('')}`
    const article = buildToutiaoArticle({ articleId: id, canonicalUrl, title: fetched.title, author: fetched.author, content })
    const extraction = vi.spyOn(ContentParser, 'parse')
    const result = await service.parseAndSaveToutiao(ctx, article, 42, 'toutiao-test')
    const html = bucket.putIfKeyExists.mock.calls.find(call => call[0].endsWith('.html'))![1]
    const document = parseHTML(html).document
    expect(extraction).not.toHaveBeenCalled()
    expect(document.querySelectorAll('p').length).toBe(61)
    expect(document.querySelectorAll('img').length).toBe(1)
    expect(result.textContent).toBe(article.text)
    expect(result.textContent).toContain('Paragraph 59.')
  })

  test('missing publication metadata retains the existing parser fallback', async () => {
    const { service, ctx, fetched } = wire()
    delete fetched.publishedAt
    fetched.html = fetched.html.replace(/<meta property="article:published_time"[^>]*>/, '')
    const before = Date.now()
    const result = await service.parseAndSaveToutiao(ctx, fetched, 42, 'toutiao-test')
    expect(result.publishedTime!.valueOf()).toBeGreaterThanOrEqual(before)
    expect(result.publishedTime!.valueOf()).toBeLessThanOrEqual(Date.now())
  })

  test('service uses only the shared TikHub adapter for Toutiao data', async () => {
    const { service, ctx, fetched } = wire()
    const provider = vi.spyOn(SocialMediaApi, 'fetchToutiao').mockResolvedValue(fetched)
    const generic = vi.spyOn(service, 'fetchRegular')
    expect(await service.fetchToutiaoData(ctx, canonicalUrl)).toBe(fetched)
    expect(provider).toHaveBeenCalledExactlyOnceWith(ctx.env, canonicalUrl)
    provider.mockRejectedValue(new Error('Toutiao article has been deleted'))
    await expect(service.fetchToutiaoData(ctx, canonicalUrl)).rejects.toThrow('deleted')
    expect(generic).not.toHaveBeenCalled()
  })

  test('dedicated resolver errors propagate while other short-link behavior is preserved', async () => {
    const { service, ctx } = wire()
    const oldResolver = vi.spyOn(SlaxFetch.prototype, 'head').mockResolvedValue({ statusCode: 302, location: 'https://x.com/author/status/123' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"404 not found"}')))
    await expect(service.resolveShortLink(ctx, 'https://m.toutiao.com/is/expired/')).rejects.toThrow('expired')
    expect(oldResolver).not.toHaveBeenCalled()
    expect(await service.resolveShortLink(ctx, 'https://t.co/other/')).toBe('https://x.com/author/status/123')
    expect(oldResolver).toHaveBeenCalledOnce()
    expect(await service.resolveShortLink(ctx, `https://m.toutiao.com/a${id}/?tracking=1`)).toBe(canonicalUrl)
  })
})
