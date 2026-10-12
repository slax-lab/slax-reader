import { afterEach, describe, expect, test, vi } from 'vitest'
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      _state: unknown,
      public env: unknown
    ) {}
  }
}))
vi.mock('@cloudflare/puppeteer', () => ({ default: {}, connect: vi.fn() }))
import { enforcePublicRequests, SlaxBrowser } from '@/utils/browser'
import { ScreenshotBrowser } from '@/entry/core/screenshotBrowser'

afterEach(() => vi.restoreAllMocks())

const harness = () => {
  const page = {
    on: vi.fn(),
    isClosed: vi.fn().mockReturnValue(false),
    setBypassServiceWorker: vi.fn().mockResolvedValue(undefined),
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    setBypassCSP: vi.fn().mockResolvedValue(undefined),
    setJavaScriptEnabled: vi.fn().mockResolvedValue(undefined),
    setCacheEnabled: vi.fn().mockResolvedValue(undefined),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    setContent: vi.fn().mockResolvedValue(undefined),
    waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(0),
    screenshot: vi.fn().mockResolvedValue(new Uint8Array([1])),
    close: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn()
  }
  const context = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) }
  const browser = { createBrowserContext: vi.fn().mockResolvedValue(context), newPage: vi.fn() }
  return { page, context, browser }
}

const intercepted = (url: string) => ({
  url: () => url,
  method: () => 'GET',
  headers: () => ({ authorization: 'private', cookie: 'private' }),
  abort: vi.fn().mockResolvedValue(undefined),
  respond: vi.fn().mockResolvedValue(undefined),
  continue: vi.fn()
})

describe('browser public network boundary', () => {
  test('routes public resources through bounded worker fetch, blocks private subresources and redirects without browser network fallback', async () => {
    const h = harness()
    await enforcePublicRequests(h.page as never)
    const listener = h.page.on.mock.calls[0][1]
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image'))
    const good = intercepted('https://images.example/a.png')
    listener(good)
    await vi.waitFor(() => expect(good.respond).toHaveBeenCalledOnce())
    expect(good.continue).not.toHaveBeenCalled()
    expect((fetchSpy.mock.calls[0][1]!.headers as Headers).has('authorization')).toBe(false)
    for (const url of ['http://127.0.0.1', 'http://169.254.169.254/', 'file:///etc/passwd', 'http://[::ffff:127.0.0.1]']) {
      const bad = intercepted(url)
      listener(bad)
      await vi.waitFor(() => expect(bad.abort).toHaveBeenCalledOnce())
      expect(bad.continue).not.toHaveBeenCalled()
    }
    expect(fetchSpy).toHaveBeenCalledOnce()
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'http://10.0.0.1/' } }))
    const redirect = intercepted('https://images.example/redirect')
    listener(redirect)
    await vi.waitFor(() => expect(redirect.abort).toHaveBeenCalledOnce())
    expect(redirect.respond).not.toHaveBeenCalled()
  })
  test('caps proxy concurrency across pages through respond completion, and avoids a Buffer copy', async () => {
    const first = harness()
    const second = harness()
    await enforcePublicRequests(first.page as never)
    await enforcePublicRequests(second.page as never)
    const release: Array<() => void> = []
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Uint8Array(512 * 1024)))
    const requests = Array.from({ length: 4 }, (_, i) => {
      const request = intercepted(`https://images.example/${i}`)
      request.respond.mockImplementation(() => new Promise<void>(resolve => release.push(resolve)))
      return request
    })
    requests.forEach((request, i) => (i < 2 ? first : second).page.on.mock.calls[0][1](request))
    await vi.waitFor(() => expect(release).toHaveLength(2))
    expect(fetch).toHaveBeenCalledTimes(2)
    const body = requests[0].respond.mock.calls[0][0].body
    expect(body).toBeInstanceOf(Uint8Array)
    expect(Buffer.isBuffer(body)).toBe(false)
    release[0]()
    await vi.waitFor(() => expect(release).toHaveLength(3))
    expect(fetch).toHaveBeenCalledTimes(3)
    release[1]()
    await vi.waitFor(() => expect(release).toHaveLength(4))
    release[2]()
    release[3]()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  test('rejects resources above the conservative SDK encoding budget', async () => {
    const h = harness()
    await enforcePublicRequests(h.page as never)
    const cancel = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(512 * 1024 + 1))
          },
          cancel
        })
      )
    )
    const request = intercepted('https://images.example/large')
    h.page.on.mock.calls[0][1](request)
    await vi.waitFor(() => expect(request.abort).toHaveBeenCalledOnce())
    expect(request.respond).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
  })
  test('responds to validated redirects without awaiting a stalled redirect body', async () => {
    const h = harness()
    await enforcePublicRequests(h.page as never)
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 302, headers: { Location: '/next' } }))
    const request = intercepted('https://images.example/redirect')
    h.page.on.mock.calls[0][1](request)
    await vi.waitFor(() => expect(request.respond).toHaveBeenCalledOnce())
    expect(cancel).toHaveBeenCalledOnce()
    expect(request.respond.mock.calls[0][0]).toMatchObject({ status: 302, headers: { location: 'https://images.example/next' }, body: new Uint8Array(0) })
  })
  test('page settings enforce interception even when caller disables it and fail closed', async () => {
    const h = harness()
    const service = new SlaxBrowser({ storage: {} } as never, {} as Env)
    await service.pageSettings(h.page as never, { requestInterception: false } as never, new Headers())
    expect(h.page.setRequestInterception).toHaveBeenCalledWith(true)
    h.page.setRequestInterception.mockRejectedValueOnce(new Error('initialization failed'))
    vi.spyOn(service as any, 'getBrowser').mockResolvedValue(h.browser)
    await service.fetchFunction(new Request('https://internal/', { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) }))
    expect(h.page.goto).not.toHaveBeenCalled()
    expect(h.context.close).toHaveBeenCalled()
  })
  test.each([false, true])('actual ScreenshotBrowser isolates, disables scripts and closes on initialization failure=%s', async fail => {
    const h = harness()
    const put = vi.fn()
    const service = new ScreenshotBrowser(
      { storage: {} } as never,
      { OSS: { get: vi.fn().mockResolvedValue({ text: async () => '<img src="http://127.0.0.1/">' }), put } } as never
    )
    vi.spyOn(service as any, 'getBrowser').mockResolvedValue(h.browser)
    if (fail) h.page.setJavaScriptEnabled.mockRejectedValueOnce(new Error('cannot disable scripts'))
    const response = await service.fetch(new Request('https://internal/', { method: 'POST', body: JSON.stringify({ contentKey: 'content/key.html' }) }))
    expect(response.status).toBe(fail ? 500 : 200)
    expect(h.browser.newPage).not.toHaveBeenCalled()
    expect(h.context.close).toHaveBeenCalledOnce()
    expect(h.page.setJavaScriptEnabled).toHaveBeenCalledWith(false)
    expect(h.page.setRequestInterception).toHaveBeenCalledWith(true)
    if (fail) {
      expect(h.page.setContent).not.toHaveBeenCalled()
      expect(put).not.toHaveBeenCalled()
    } else {
      expect(h.page.setRequestInterception.mock.invocationCallOrder[0]).toBeLessThan(h.page.setContent.mock.invocationCallOrder[0])
      expect(put).toHaveBeenCalledOnce()
    }
  })
})
