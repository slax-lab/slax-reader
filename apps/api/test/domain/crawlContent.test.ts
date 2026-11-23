import { createMockMediaSnapshots } from '@test/helpers/mockFactory'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { CrawlService } from '@/domain/crawl'
import { createMockCtx } from '@test/helpers/mockFactory'

const DXY_URL = 'https://wechat.dxy.cn/news/view?noshare=false&watermark=false&nocopy=false&email=false&simuri=%2Fjapi%2Fweixin%2Fnews%2F73450%2FMGDhoUR56iXCx%2Fdata&teamId=101'

afterEach(() => vi.restoreAllMocks())

function createService() {
  const putIfKeyExists = vi.fn().mockResolvedValue(undefined)
  const updateBookmark = vi.fn().mockResolvedValue(undefined)
  const service = new (CrawlService as any)(() => ({ putIfKeyExists }) as any, { updateBookmark } as any, {} as any, {} as any, {} as any)

  service.snapshots = createMockMediaSnapshots(putIfKeyExists, updateBookmark)
  return { service, putIfKeyExists, updateBookmark }
}

describe('regular page parsing', () => {
  test('rejects the whitespace-padded loading text that exceeded the soft-404 threshold', async () => {
    const { service, putIfKeyExists, updateBookmark } = createService()
    await expect(
      service.parseAndSaveContent(
        createMockCtx(),
        { url: DXY_URL, title: '', content: '<html><body><div id="j_article"></div><p>\n\n\t\n\t\t\t\t加载中\n\n\t\n\t\n</p></body></html>' },
        42,
        'bookmark-uuid'
      )
    ).rejects.toThrow('loading placeholder')
    expect(putIfKeyExists).not.toHaveBeenCalled()
    expect(updateBookmark).not.toHaveBeenCalled()
  })

  test('does not save a DXY loading shell as successful content', async () => {
    const { service, putIfKeyExists, updateBookmark } = createService()
    const ctx = createMockCtx()

    await expect(
      service.parseAndSaveContent(
        ctx as any,
        {
          url: DXY_URL,
          title: '',
          content:
            '<html><head><meta property="og:title" content=""></head><body><div id="j_article"><span class="tips">加载中</span></div><div class="weui_dialog"><div class="weui_dialog_bd">确定删除吗?</div><a class="weui_btn_dialog default">取消</a><a class="weui_btn_dialog primary">确定</a></div></body></html>'
        },
        42,
        'bookmark-uuid'
      )
    ).rejects.toThrow('loading placeholder')

    expect(putIfKeyExists).not.toHaveBeenCalled()
    expect(updateBookmark).not.toHaveBeenCalled()
  })

  test('saves ordinary regular article content', async () => {
    const { service, putIfKeyExists, updateBookmark } = createService()
    const ctx = createMockCtx()

    const result = await service.parseAndSaveContent(
      ctx as any,
      {
        url: 'https://example.com/article',
        title: 'Example article',
        content:
          '<html><head><title>Example article</title></head><body><article><h1>Example article</h1><p>This is a normal article with enough content to save.</p></article></body></html>'
      },
      42,
      'bookmark-uuid'
    )

    expect(result.title).toBe('Example article')
    expect(result.textContent).toContain('normal article')
    expect(putIfKeyExists).toHaveBeenCalledTimes(2)
    expect(updateBookmark).toHaveBeenCalledWith(42, expect.objectContaining({ status: 'success' }))
  })

  test.each([
    ['', 'The article explains why a page displays loading while fetching data.'],
    ['Loading states', 'Loading...']
  ])('accepts real content with title %j', async (title, text) => {
    const { service, updateBookmark } = createService()
    const result = await service.parseAndSaveContent(
      createMockCtx(),
      { url: DXY_URL, title, content: `<html><head><title>${title}</title></head><body><article><p>${text}</p></article></body></html>` },
      42,
      'bookmark-uuid'
    )
    expect(result.textContent).toContain(text)
    expect(updateBookmark).toHaveBeenCalledWith(42, expect.objectContaining({ status: 'success' }))
  })
})

describe('regular DXY fetch', () => {
  test('requests browser HTML from Zyte and preserves the full query', async () => {
    const html = '<html><title>DXY article</title><body>Rendered article</body></html>'
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ statusCode: 200, url: DXY_URL, browserHtml: html, httpResponseBody: Buffer.from('<html><body>Loading...</body></html>').toString('base64url') })
      )
    const { service } = createService()

    const result = await service.fetchRegular(createMockCtx(), DXY_URL)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0][0])).toBe('https://api.zyte.com/v1/extract')
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ url: DXY_URL, browserHtml: true, javascript: true })
    expect(result).toEqual({ url: DXY_URL, title: '', content: html })
  })

  test('also renders with ScrapingBot when Zyte fails', async () => {
    const html = '<html><title>DXY article</title><body>Fallback article</body></html>'
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ status: 'SUCCESS', httpCode: 200, result: html }))
    const { service } = createService()
    const ctx = createMockCtx()
    ctx.env.SCRAPING_BOT_TOKEN = 'test-token'

    const result = await service.fetchRegular(ctx, DXY_URL)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(String(fetch.mock.calls[1][0])).toBe('https://api.scrapingrobot.com/?token=test-token')
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({ url: DXY_URL, module: 'HtmlChromeScraper', params: { render: true } })
    expect(result).toEqual({ url: DXY_URL, title: '', content: html })
  })
})

describe('Reuters regular capture', () => {
  const url = 'https://www.reuters.com/world/china/china-ai-bubble-has-already-burst-2026-10-26/'
  const notice = 'Please enable JS and disable any ad blocker'
  const page = (body: string) => `<html><head><title>Reuters report</title></head><body><article>${body}</article></body></html>`

  test.each([url, 'https://reuters.com/world/article/?source=reader'])('saves the body rendered by Zyte for %s', async target => {
    const body = 'The report covers new investment figures in China.'
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        url: target,
        statusCode: 200,
        browserHtml: page(`<p>${body}</p>`),
        httpResponseBody: Buffer.from(page(`<p>${notice}</p>`)).toString('base64url')
      })
    )
    const { service, putIfKeyExists, updateBookmark } = createService()
    const ctx = createMockCtx()
    const fetched = await service.fetchRegular(ctx, target)
    await service.parseAndSaveContent(ctx, fetched, 42, 'bookmark-uuid')

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0][0])).toBe('https://api.zyte.com/v1/extract')
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ url: target, browserHtml: true, javascript: true })
    expect(putIfKeyExists).toHaveBeenCalledWith(expect.stringMatching(/body\.txt$/), expect.stringContaining(body))
    expect(updateBookmark).toHaveBeenCalledWith(42, expect.objectContaining({ status: 'success' }))
  })

  test.each(['https://www.reuters.com.example.org/story', 'https://example.org/?article=' + url])('preserves raw HTTP mode for %s', async target => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        url: target,
        statusCode: 200,
        httpResponseBody: Buffer.from('Ordinary story').toString('base64url')
      })
    )
    const { service } = createService()
    expect((await service.fetchRegular(createMockCtx(), target)).content).toBe('Ordinary story')
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ url: target, httpResponseBody: true, followRedirect: true })
  })

  test('uses the existing HTTP fallback and rejects its notice before writing a snapshot', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ url, statusCode: 401 }))
      .mockResolvedValueOnce(Response.json({ status: 'SUCCESS', httpCode: 200, result: page(`<p>${notice}</p>`) }))
    const { service, putIfKeyExists, updateBookmark } = createService()
    const ctx = createMockCtx()
    const fetched = await service.fetchRegular(ctx, url)
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({ url, module: 'HtmlRequestScraper' })
    await expect(service.parseAndSaveContent(ctx, fetched, 42, 'bookmark-uuid')).rejects.toThrow('Reuters returned an access notice')
    expect(putIfKeyExists).not.toHaveBeenCalled()
    expect(updateBookmark).not.toHaveBeenCalled()
  })

  test.each(['zyte', 'publisher'])('rejects a notice with a tracking pixel from %s', async path => {
    const html = page(`<p>${notice}.</p><img src="https://example.org/tracker.gif" alt="pixel" width="1" height="1">`)
    const { service, putIfKeyExists, updateBookmark } = createService()
    const ctx = createMockCtx()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ url, statusCode: 200, browserHtml: html }))
    const capture =
      path === 'zyte'
        ? service.parseAndSaveContent(ctx, await service.fetchRegular(ctx, url), 42, 'bookmark-uuid')
        : service.savePublisherHtml(ctx, parseHTML(html).document, url, 42, 'bookmark-uuid')
    await expect(capture).rejects.toThrow('Reuters returned an access notice')
    expect(putIfKeyExists).not.toHaveBeenCalled()
    expect(updateBookmark).not.toHaveBeenCalled()
  })

  test.each([
    `<p>Here is the full message: ${notice}. The report explains its origin.</p>`,
    `<p>${notice}</p><img src="https://example.org/diagram.png" alt="Diagram of the reported issue">`
  ])('saves an article quoting the notice alongside reporting or an illustration', async body => {
    const { service, updateBookmark } = createService()
    await service.parseAndSaveContent(createMockCtx(), { url, content: page(body), title: '' }, 42, 'bookmark-uuid')
    expect(updateBookmark).toHaveBeenCalledWith(42, expect.objectContaining({ status: 'success' }))
  })
})

describe('short JavaScript notices', () => {
  const url = 'https://reader.example.org/story'
  const capture = (text: string) => {
    const { service, putIfKeyExists } = createService()
    const content = `<html><head><title>Story</title></head><body><article><p>${text}</p></article></body></html>`
    return { result: service.parseAndSaveContent(createMockCtx(), { url, content }, 42, 'bookmark-uuid', 'initial'), putIfKeyExists }
  }

  test.each([
    'You need to enable JavaScript to run this app.',
    'JavaScript is currently disabled.',
    'Please    turn on JS.',
    'Site unavailable: enable JS to continue.',
    '请在浏览器中开启 JavaScript 后重试。',
    'Enable JS. ' + '界'.repeat(109)
  ])('recognizes the directive before any write: %s', async text => {
    const { result, putIfKeyExists } = capture(text)
    await expect(result).rejects.toThrow('Page requires JavaScript')
    expect(putIfKeyExists).not.toHaveBeenCalled()
  })

  test.each([
    'Enable JS. ' + '界'.repeat(110),
    'A short editorial note.',
    'How to enable JavaScript in a browser',
    'This report quotes: Please enable JS. The rest of the report follows.'
  ])('preserves ordinary text or a page over the threshold', async text => {
    const { result } = capture(text)
    expect((await result).textContent.trim()).toBe(text)
  })

  test('rejects the observed Reuters notice even with invisible spacing and a publisher logo', async () => {
    const { service, putIfKeyExists } = createService()
    const content =
      '<html><head><title>Reuters</title></head><body><article><p>Please enable J\u200bS and disable any ad blocker.</p><img src="https://example.org/logo.svg" alt="Reuters"></article></body></html>'
    await expect(service.parseAndSaveContent(createMockCtx(), { url: 'https://www.reuters.com/story', content }, 42, 'bookmark-uuid')).rejects.toThrow(
      'Reuters returned an access notice'
    )
    expect(putIfKeyExists).not.toHaveBeenCalled()
  })

  test('preserves readable fallback bodies even when the reported status precludes a browser retry', async () => {
    const { service, updateBookmark } = createService()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(
        Response.json({ status: 'SUCCESS', httpCode: 403, result: '<html><head><title>News</title></head><body><p>The full report remains available.</p></body></html>' })
      )
    const ctx = createMockCtx()
    const page = await service.fetchRegular(ctx, url)
    expect(page.targetErrorStatus).toBe(403)
    const result = await service.parseAndSaveContent(ctx, page, 42, 'bookmark-uuid', 'initial')
    expect(result.textContent).toContain('full report')
    expect(updateBookmark).toHaveBeenCalled()
  })

  test.each(['src', 'data-src'])('preserves an image-only browser result using %s without alt text', async attribute => {
    const { service, putIfKeyExists } = createService()
    const content = `<html><head><title>Photo essay</title></head><body><article><figure><img ${attribute}="https://images.example.org/news.jpg"></figure></article></body></html>`
    await service.parseAndSaveContent(createMockCtx(), { url, content }, 42, 'bookmark-uuid', 'retry')
    expect(putIfKeyExists).toHaveBeenCalledWith(expect.stringMatching(/body\.html$/), expect.stringContaining('news.jpg'))
  })
})
