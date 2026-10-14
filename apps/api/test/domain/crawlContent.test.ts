import { afterEach, describe, expect, test, vi } from 'vitest'
import { CrawlService } from '@/domain/crawl'
import { createMockCtx } from '@test/helpers/mockFactory'

const DXY_URL = 'https://wechat.dxy.cn/news/view?noshare=false&watermark=false&nocopy=false&email=false&simuri=%2Fjapi%2Fweixin%2Fnews%2F73450%2FMGDhoUR56iXCx%2Fdata&teamId=101'

afterEach(() => vi.restoreAllMocks())

function createService() {
  const putIfKeyExists = vi.fn().mockResolvedValue(undefined)
  const updateBookmark = vi.fn().mockResolvedValue(undefined)
  const service = new CrawlService(() => ({ putIfKeyExists }) as any, { updateBookmark } as any, {} as any, {} as any, {} as any)

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
