// @vitest-environment happy-dom
import { SNAPSHOT_REVISION_HEADER, snapshotMetadataRevision } from '../../../server/utils/shareCache'

import * as h3 from 'h3'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'

const config = { public: { COOKIE_TOKEN_NAME: 'token' } }
vi.mock('#app/nuxt', async original => ({ ...(await original<Record<string, unknown>>()), useRuntimeConfig: () => ({ public: { COOKIE_TOKEN_NAME: 'token' } }) }))
const diagnostic = vi.hoisted(() => ({ enabled: false }))
vi.mock('../../../server/utils/serverTiming', () => ({ isServerTimingEnabled: () => diagnostic.enabled }))
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
  diagnostic.enabled = false
  vi.stubGlobal('caches', { default: cache })
  backend.fetch.mockImplementation(async () => Response.json(metadata))
})

it.each([false, true])('times the complete warm delivery without changing production policy (%s)', async enabled => {
  diagnostic.enabled = enabled
  let now = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  try {
    const cached = new Response('neutral cached body', { headers: { [SNAPSHOT_REVISION_HEADER]: await snapshotMetadataRevision(metadata) } })
    vi.spyOn(cached, 'text').mockImplementation(async () => { now += 30; return 'neutral cached body' })
    cache.match.mockImplementation(async () => { now += 5; return cached })
    backend.fetch.mockImplementation(async () => { now += 20; return Response.json(metadata, { headers: { 'Server-Timing': 'core_access;dur=20' } }) })
    const response = await lookup({ method: 'GET', path: '/b/source', headers: {}, context: { cloudflare: { env: { BACKEND: backend } } } })
    expect(response.body).toBe('neutral cached body')
    const timing = new Headers(response.headers as never).get('server-timing')
    if (enabled) {
      expect(timing).toContain('core_access;dur=20')
      expect(timing).toContain('front_cache-match;dur=5.0')
      expect(timing).toContain('front_cache-validation;dur=20.0')
      expect(timing).toContain('front_cache-body;dur=30.0')
      expect(timing).toContain('front_cache-lookup;dur=55.0')
      expect(timing).not.toMatch(/neutral cached body|source|token/)
    } else expect(timing).toBeNull()
  } finally { clock.mockRestore() }
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

it.each([401, 403, 404, 500])('does not serve warmed HTML after metadata returns %s', async status => {
  cache.match.mockResolvedValue(new Response('old cached body', { headers: { [SNAPSHOT_REVISION_HEADER]: await snapshotMetadataRevision(metadata) } }))
  backend.fetch.mockResolvedValue(new Response(null, { status }))
  const response = await lookup({ method: 'GET', path: '/b/source', headers: {}, context: { cloudflare: { env: { BACKEND: backend } } } })
  expect(response.body).toBe('fresh page')
  expect(new Headers(response.headers as never).get('x-bcache')).not.toBe('hit')
})

it.each([
  { ...metadata, role: 'owner' },
  { ...metadata, title: 'Current title' },
  { ...metadata, author: null },
  { ...metadata, mark_list: [] },
  { ...metadata, content_key: 'html/body/current.html' }
])('does not serve an outdated presentation revision: %j', async current => {
  diagnostic.enabled = true
  cache.match.mockResolvedValue(new Response('old cached body', { headers: { [SNAPSHOT_REVISION_HEADER]: await snapshotMetadataRevision(metadata) } }))
  backend.fetch.mockResolvedValue(Response.json(current, { headers: { 'Server-Timing': 'core_access;dur=20' } }))
  const response = await lookup({ method: 'GET', path: '/b/source', headers: {}, context: { cloudflare: { env: { BACKEND: backend } } } })
  expect(response.body).toBe('fresh page')
  const timing = new Headers(response.headers as never).get('server-timing')
  expect(timing).toContain('front_cache-validation;dur=')
  expect(timing).not.toContain('core_access')
})

it('keeps the existing ten-minute format convergence without a new namespace', async () => {
  const event = h3.createEvent({ headers: {}, url: '/b/source' } as never, { setHeader: vi.fn() } as never)
  event.context.__snapshotCacheMetadata = metadata
  await render({ statusCode: 200, body: 'projected page', headers: {} }, { event })
  const [key, stored] = cache.put.mock.calls[0]
  expect(key.url).toBe('https://__bcache.slax__/b/source?t=visitor')
  expect(stored.headers.get('cache-control')).toBe('public, max-age=600')
})
