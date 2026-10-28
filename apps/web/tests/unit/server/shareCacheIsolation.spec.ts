// @vitest-environment happy-dom
import { SNAPSHOT_REVISION_HEADER, snapshotMetadataRevision } from '../../../server/utils/shareCache'

import * as h3 from 'h3'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'

const config = { public: { COOKIE_TOKEN_NAME: 'token' } }
vi.mock('#app/nuxt', async original => ({ ...(await original<Record<string, unknown>>()), useRuntimeConfig: () => ({ public: { COOKIE_TOKEN_NAME: 'token' } }) }))
vi.mock('../../../server/utils/serverTiming', () => ({ isServerTimingEnabled: () => false }))
const cache = { match: vi.fn(), put: vi.fn(async () => {}) }
const backend = { fetch: vi.fn() }
const metadata = { role: 'visitor', has_fork: true, fork: { status: 'unavailable' }, viewer_fork_status: null }
let lookup: ReturnType<typeof h3.toPlainHandler>
let render: (response: unknown, ctx: { event: h3.H3Event }) => Promise<void>
beforeAll(async () => {
  Object.assign(globalThis, {
    defineEventHandler: h3.defineEventHandler, getRequestURL: h3.getRequestURL,
    setResponseHeader: h3.setResponseHeader, useRuntimeConfig: () => config,
    defineNitroPlugin: (plugin: unknown) => plugin
  })
  const middleware = await import('../../../server/middleware/share-cache')
  const plugin = await import('../../../server/plugins/share-cache')
  const app = h3.createApp()
  app.use(middleware.default)
  app.use(h3.defineEventHandler(() => 'fresh page'))
  lookup = h3.toPlainHandler(app)
  ;(plugin.default as any)({ hooks: { hook: (_name: string, callback: typeof render) => { render = callback } } })
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('caches', { default: cache })
  backend.fetch.mockImplementation(async () => Response.json(metadata))
})
const headersCases = [{ cookie: 'token=expired' }, { cookie: 'token=' }, { authorization: 'Bearer other-user' }, { authorization: '' }]
it.each(headersCases)('never looks up shared HTML for credential-bearing requests: %j', async headers => {
  const response = await lookup({ method: 'GET', path: '/b/source', headers, context: { cloudflare: { env: { BACKEND: backend } } } })
  expect(cache.match).not.toHaveBeenCalled()
  expect(response.body).toBe('fresh page')
  expect(new Headers(response.headers as never).get('cache-control')).toBe('private, no-store')
})
it.each(headersCases)('never stores personalized HTML even when lookup middleware was skipped: %j', async headers => {
  const responseHeaders = new Map<string, string>()
  const event = h3.createEvent({ headers, url: '/b/source' } as never, { setHeader: (key: string, value: string) => responseHeaders.set(key, value) } as never)
  event.context.__snapshotCacheMetadata = metadata
  event.context.__isOwner = false
  const response = { statusCode: 200, body: 'private viewer state', headers: {} as Record<string, string> }
  await render(response, { event })
  expect(cache.put).not.toHaveBeenCalled()
  expect(responseHeaders.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers['cache-control']).toBe('private, no-store')
})
it('revalidates anonymous cached HTML and rejects revoked access', async () => {
  cache.match.mockImplementation(async () => new Response('neutral cached page', { headers: { [SNAPSHOT_REVISION_HEADER]: await snapshotMetadataRevision(metadata) } }))
  const request = { method: 'GET', path: '/b/source', headers: {}, context: { cloudflare: { env: { BACKEND: backend } } } }
  expect((await lookup(request)).body).toBe('neutral cached page')
  backend.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
  expect((await lookup(request)).body).toBe('fresh page')
})
it('stores only the anonymous visitor variant', async () => {
  const event = h3.createEvent({ headers: {}, url: '/b/source' } as never, { setHeader: vi.fn() } as never)
  event.context.__snapshotCacheMetadata = metadata
  await render({ statusCode: 200, body: 'neutral page', headers: {} }, { event })
  expect(cache.put).toHaveBeenCalledOnce()
  expect(cache.put.mock.calls[0][0].url).toContain('?t=visitor')
})
