import { afterEach, describe, expect, test, vi } from 'vitest'
vi.mock('cloudflare:workers', () => ({ WorkflowEntrypoint: class {} }))
vi.mock('@/di/generated/dependency', () => ({ initializeInfrastructure: vi.fn(), initializeCore: vi.fn() }))
vi.mock('@/domain/crawl', () => ({ CrawlService: class {} }))
vi.mock('@/domain/orchestrator/urlParser', () => ({ UrlParserHandler: class {} }))
vi.mock('@/domain/bookmark', () => ({ BookmarkService: class {} }))
vi.mock('@/domain/import', () => ({ ImportService: class {} }))
vi.mock('@/domain/events', () => ({ EVENT_CONTEXT_KEY: 'event' }))
vi.mock('@/utils/browser', () => ({}))
import { SlaxFetch } from '@/infra/external/remoteFetcher'
import { fetchImportContent } from '@/entry/edge/workflows/importParseWorkflow'

const good = { url: 'https://example.com/article', content: `<html><body><article><p>${'Substantive article text about the topic. '.repeat(12)}</p></article></body></html>` }
const empty = { url: good.url, content: '<html><body><div id="app"></div><script>renderApp()</script></body></html>' }
afterEach(() => vi.restoreAllMocks())

describe('safe import dynamic rendering fallback', () => {
  test('executes the real fetcher fallback from an empty browser service response to rendered supplier HTML', async () => {
    const browser = vi.fn().mockResolvedValue(Response.json({ data: empty }))
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ statusCode: 200, url: good.url, browserHtml: good.content }))
    const result = await fetchImportContent({ SlaxBrowser: { fetch: browser }, ZYTE_API_KEY: 'configured' } as unknown as Env, good.url)
    expect(result.content).toBe(good.content)
    expect(browser).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0][0]).toBe('https://api.zyte.com/v1/extract')
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ url: good.url, browserHtml: true, javascript: true })
  })
  test('retains good static headless content without calling providers', async () => {
    vi.spyOn(SlaxFetch.prototype, 'headless').mockResolvedValue(good)
    const zyte = vi.spyOn(SlaxFetch.prototype, 'zyte')
    expect(await fetchImportContent({ ZYTE_API_KEY: 'configured' } as Env, good.url)).toEqual(good)
    expect(zyte).not.toHaveBeenCalled()
  })
  test.each([
    '<p>今天发布了一个修复版本。</p>',
    '<p>Loading a page safely requires validating every redirect.</p>',
    '<p>Access denied errors can indicate an expired session.</p>',
    '<p>参考：<a href="https://example.com/docs">完整的发布说明与使用文档</a></p>',
    '<main>Loading...</main><p>今天发布了一个修复版本。</p>'
  ])('retains short or link-heavy articles without a paid fallback: %s', async content => {
    const article = { ...good, content: `<html><body>${content}</body></html>` }
    vi.spyOn(SlaxFetch.prototype, 'headless').mockResolvedValue(article)
    const zyte = vi.spyOn(SlaxFetch.prototype, 'zyte')
    const robot = vi.spyOn(SlaxFetch.prototype, 'scrapingBot')
    expect(await fetchImportContent({ ZYTE_API_KEY: 'configured', SCRAPING_BOT_TOKEN: 'configured' } as Env, good.url)).toEqual(article)
    expect(zyte).not.toHaveBeenCalled()
    expect(robot).not.toHaveBeenCalled()
  })
  test.each(['Loading...', 'Please enable JavaScript.', 'Checking your browser…', 'Just a moment', 'Access denied'])('rejects a placeholder-only page: %s', async text => {
    vi.spyOn(SlaxFetch.prototype, 'headless').mockResolvedValue({ ...empty, content: `<html><body><main>${text}</main></body></html>` })
    await expect(fetchImportContent({} as Env, good.url)).rejects.toThrow('configure ZYTE_API_KEY or SCRAPING_BOT_TOKEN')
  })
  test.each([empty, { ...empty, content: `<html><body><nav>${'Menu '.repeat(100)}</nav><main>Loading...</main></body></html>` }])(
    'uses configured Zyte browserHtml on missing or low-quality content',
    async result => {
      vi.spyOn(SlaxFetch.prototype, 'headless').mockResolvedValue(result)
      const zyte = vi.spyOn(SlaxFetch.prototype, 'zyte').mockResolvedValue(good)
      const robot = vi.spyOn(SlaxFetch.prototype, 'scrapingBot')
      expect(await fetchImportContent({ ZYTE_API_KEY: 'configured' } as Env, good.url)).toEqual(good)
      expect(zyte).toHaveBeenCalledWith(good.url, true)
      expect(robot).not.toHaveBeenCalled()
    }
  )
  test('falls through unusable Zyte content to configured ScrapingRobot rendering', async () => {
    vi.spyOn(SlaxFetch.prototype, 'headless').mockRejectedValue(new Error('resource too large'))
    vi.spyOn(SlaxFetch.prototype, 'zyte').mockResolvedValue(empty)
    const robot = vi.spyOn(SlaxFetch.prototype, 'scrapingBot').mockResolvedValue(good)
    expect(await fetchImportContent({ ZYTE_API_KEY: 'configured', SCRAPING_BOT_TOKEN: 'configured' } as Env, good.url)).toEqual(good)
    expect(robot).toHaveBeenCalledWith(good.url, true)
  })
  test('skips unconfigured providers and fails clearly if none can render', async () => {
    vi.spyOn(SlaxFetch.prototype, 'headless').mockResolvedValue(empty)
    const zyte = vi.spyOn(SlaxFetch.prototype, 'zyte')
    const robot = vi.spyOn(SlaxFetch.prototype, 'scrapingBot').mockResolvedValue(good)
    expect(await fetchImportContent({ SCRAPING_BOT_TOKEN: 'configured' } as Env, good.url)).toEqual(good)
    expect(zyte).not.toHaveBeenCalled()
    robot.mockClear()
    await expect(fetchImportContent({} as Env, good.url)).rejects.toThrow('configure ZYTE_API_KEY or SCRAPING_BOT_TOKEN')
    expect(robot).not.toHaveBeenCalled()
  })
  test('validates initial and supplier-reported final targets without internal network probes', async () => {
    const headless = vi.spyOn(SlaxFetch.prototype, 'headless').mockResolvedValue(empty)
    await expect(fetchImportContent({} as Env, 'http://127.0.0.1')).rejects.toThrow()
    expect(headless).not.toHaveBeenCalled()
    vi.spyOn(SlaxFetch.prototype, 'zyte').mockResolvedValue({ ...good, url: 'http://169.254.169.254/' })
    await expect(fetchImportContent({ ZYTE_API_KEY: 'configured' } as Env, good.url)).rejects.toThrow('failed to return usable public content')
  })
})
