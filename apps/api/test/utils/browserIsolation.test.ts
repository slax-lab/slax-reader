import { afterEach, describe, expect, test, vi } from 'vitest'
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }))
vi.mock('@cloudflare/puppeteer', () => ({ default: {}, connect: vi.fn() }))
import { SlaxBrowser } from '@/utils/browser'

afterEach(() => vi.restoreAllMocks())

const harness = () => {
  const page = {
    setViewport: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    setBypassServiceWorker: vi.fn().mockResolvedValue(undefined),
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    setJavaScriptEnabled: vi.fn().mockResolvedValue(undefined),
    setContent: vi.fn().mockResolvedValue(undefined),
    waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(new Uint8Array([1])),
    close: vi.fn().mockResolvedValue(undefined)
  }
  const context = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) }
  const browser = { createBrowserContext: vi.fn().mockResolvedValue(context), newPage: vi.fn() }
  const service = new SlaxBrowser({ storage: {} } as never, {} as Env)
  vi.spyOn(service as any, 'getBrowser').mockResolvedValue(browser)
  return { service, browser, context, page }
}

describe('browser task isolation', () => {
  test('screenshots use isolated context with scripts disabled', async () => {
    const h = harness()
    await h.service.screenshotFunction(new Request('https://internal/screenshot', { method: 'POST', body: '<html></html>' }))
    expect(h.browser.createBrowserContext).toHaveBeenCalledOnce()
    expect(h.browser.newPage).not.toHaveBeenCalled()
    expect(h.page.setJavaScriptEnabled).toHaveBeenCalledWith(false)
    expect(h.context.close).toHaveBeenCalledOnce()
  })

  test('closes context after screenshot errors', async () => {
    const h = harness()
    h.page.screenshot.mockRejectedValue(new Error('screenshot failed'))
    await h.service.screenshotFunction(new Request('https://internal/screenshot', { method: 'POST', body: '<html></html>' }))
    expect(h.context.close).toHaveBeenCalledOnce()
  })

  test('closes isolated fetch context when page configuration fails', async () => {
    const h = harness()
    vi.spyOn(h.service, 'pageSettings').mockRejectedValue(new Error('settings failed'))
    await h.service.fetchFunction(new Request('https://internal/', { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) }))
    expect(h.browser.createBrowserContext).toHaveBeenCalledOnce()
    expect(h.browser.newPage).not.toHaveBeenCalled()
    expect(h.context.close).toHaveBeenCalledOnce()
  })
})
