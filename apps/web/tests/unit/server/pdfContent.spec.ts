// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as h3 from 'h3'
import { loadContent } from '../../../server/utils/loadContent'

vi.mock('#app/nuxt', async original => ({
  ...(await original<Record<string, unknown>>()), useRuntimeConfig: () => ({ public: { COOKIE_TOKEN_NAME: 'token' } })
}))
vi.mock('../../../server/utils/serverTiming', () => ({ isServerTimingEnabled: () => false }))
const bucket = { head: vi.fn(), get: vi.fn() }
const fetchMetadata = vi.fn()
let handler: ReturnType<typeof h3.toPlainHandler>
beforeAll(async () => {
  Object.assign(globalThis, { defineEventHandler: h3.defineEventHandler, createError: h3.createError, getCookie: h3.getCookie, getHeader: h3.getHeader, useRuntimeConfig: () => ({ public: { COOKIE_TOKEN_NAME: 'token' } }) })
  const route = await import('../../../server/api/content/[uuid]/pdf')
  const app = h3.createApp()
  app.use(route.default)
  handler = h3.toPlainHandler(app)
})
beforeEach(() => {
  vi.clearAllMocks()
  fetchMetadata.mockImplementation(async () => new Response(JSON.stringify({ content_key: 'pdf/body/saved.pdf' })))
  bucket.head.mockResolvedValue({ size: 10, customMetadata: { filename: 'saved.pdf' } })
  bucket.get.mockResolvedValue({ body: new Response('%PDF-test!').body, text: vi.fn() })
})
const context = () => ({ params: { uuid: 'saved' }, cloudflare: { env: { OSS: bucket, BACKEND: { fetch: fetchMetadata } } } })
const call = (method = 'GET', range?: string) => handler({ method, path: '/', headers: { cookie: 'token=fixture', ...(range ? { range } : {}) }, context: context() })
describe('same-origin PDF delivery', () => {
  it.each([401, 403, 404])('checks current access before reading a file when metadata returns %s', async status => {
    fetchMetadata.mockResolvedValue(new Response(null, { status }))
    expect((await call()).status).toBe(status)
    expect(bucket.head).not.toHaveBeenCalled()
    expect(bucket.get).not.toHaveBeenCalled()
  })
  it('forwards the cookie token and streams a private byte range', async () => {
    const response = await call('GET', 'bytes=-4')
    expect(response.status).toBe(206)
    expect(fetchMetadata).toHaveBeenCalledWith('https://content.internal/content/meta?uuid=saved', { headers: { Authorization: 'Bearer fixture' } })
    expect(bucket.get).toHaveBeenCalledWith('pdf/body/saved.pdf', { range: { offset: 6, length: 4 } })
    const headers = new Headers(response.headers as never)
    expect(headers.get('content-type')).toBe('application/pdf')
    expect(headers.get('content-range')).toBe('bytes 6-9/10')
    expect(headers.get('cache-control')).toBe('private, no-store')
  })
  it('returns full HEAD headers without reading a body and rejects an unsatisfiable range', async () => {
    expect((await call('HEAD')).status).toBe(200)
    expect(bucket.get).not.toHaveBeenCalled()
    expect((await call('GET', 'bytes=10-')).status).toBe(416)
    expect(bucket.get).not.toHaveBeenCalled()
  })
  it('never serves an arbitrary non-PDF object from metadata', async () => {
    fetchMetadata.mockResolvedValue(new Response(JSON.stringify({ content_key: 'html/body/saved.html' })))
    expect((await call()).status).toBe(404)
    expect(bucket.head).not.toHaveBeenCalled()
  })
})
describe('SSR PDF content', () => {
  it('returns metadata with no HTML body and never reads PDF bytes through text()', async () => {
    bucket.get.mockResolvedValue(null)
    const event = h3.createEvent({ headers: {} } as never, {} as never)
    event.context = context()
    const result = await loadContent(event, 'saved')
    expect(result).toEqual({ metadata: { content_key: 'pdf/body/saved.pdf' }, body: null })
    expect(bucket.get).toHaveBeenCalledTimes(1)
    expect(bucket.get).toHaveBeenCalledWith('html/body/saved.html')
  })
})
