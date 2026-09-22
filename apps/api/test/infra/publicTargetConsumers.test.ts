import { afterEach, describe, expect, test, vi } from 'vitest'
vi.mock('@/utils/browser', () => ({}))
import { SlaxFetch } from '@/infra/external/remoteFetcher'
import { BucketClient } from '@/infra/repository/bucketClient'

afterEach(() => vi.restoreAllMocks())

describe('public target consumers', () => {
  test.each(['http', 'head', 'headless', 'zyte', 'dajiala', 'scrapingBot'] as const)('%s validates before network or supplier calls', async method => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const browserFetch = vi.fn()
    const service = new SlaxFetch({ ZYTE_API_KEY: 'key', JIZHILE_API_KEY: 'key', SlaxBrowser: { fetch: browserFetch } } as never)
    await expect((service[method] as (url: string) => Promise<unknown>).call(service, 'http://169.254.169.254/')).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    expect(browserFetch).not.toHaveBeenCalled()
  })
  test('cancels Zyte non-200 bodies without waiting for a stalled stream', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 503 }))
    await expect(new SlaxFetch({ ZYTE_API_KEY: 'key' } as Env).zyte('https://example.com')).rejects.toThrow('ZYTE API Error: 503')
    expect(cancel).toHaveBeenCalledOnce()
  })
  test('rejects provider-reported private final URLs', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ statusCode: 200, url: 'http://127.0.0.1', httpResponseBody: btoa('html') }))
    const service = new SlaxFetch({ ZYTE_API_KEY: 'key', JIZHILE_API_KEY: 'key' } as never)
    await expect(service.zyte('https://example.com')).rejects.toThrow()
    fetch.mockResolvedValueOnce(Response.json({ code: 0, data: { html: '<html/>', article_url: 'http://[::1]' } }))
    await expect(service.dajiala('https://example.com')).rejects.toThrow()
  })
  test.each(['text/html', 'image/svg+xml', '', 'video/mp4'])('does not store avatar MIME %s', async mime => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('body', { headers: { 'Content-Type': mime } }))
    const put = vi.fn()
    const bucket = new BucketClient({ RUN_ENV: 'prod', OSS: { put } } as never)
    expect(await bucket.putRemoteIfKeyExists('https://example.com/a', 'avatars', 'key')).toBeNull()
    expect(put).not.toHaveBeenCalled()
  })
  test('rejects avatar oversize and private redirects, stores only complete bounded images', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }))
    const put = vi.fn()
    const bucket = new BucketClient({ RUN_ENV: 'prod', OSS: { put } } as never)
    await expect(bucket.putRemoteIfKeyExists('https://example.com/a', 'avatars', 'key')).rejects.toThrow('byte budget')
    fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'http://10.0.0.1/' } }))
    await expect(bucket.putRemoteIfKeyExists('https://example.com/a', 'avatars', 'key')).rejects.toThrow()
    expect(put).not.toHaveBeenCalled()
    fetch.mockResolvedValueOnce(new Response('png', { headers: { 'Content-Type': 'image/png' } }))
    await bucket.putRemoteIfKeyExists('https://example.com/a', 'avatars', 'key')
    expect(put).toHaveBeenCalledWith('avatars/key', expect.any(ArrayBuffer), { httpMetadata: { contentType: 'image/png' } })
  })
})
