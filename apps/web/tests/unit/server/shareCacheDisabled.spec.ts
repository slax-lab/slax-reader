// @vitest-environment happy-dom
import snapshotCacheMiddleware from '../../../server/middleware/share-cache'
import * as h3 from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

describe('stable snapshot HTML cache policy', () => {
  it('ignores an old cached body and renders the current snapshot with no-store', async () => {
    const cache = { match: vi.fn().mockResolvedValue(new Response('stale snapshot')), put: vi.fn() }
    vi.stubGlobal('caches', { default: cache })
    const app = h3.createApp()
    app.use(snapshotCacheMiddleware)
    app.use(h3.defineEventHandler(() => 'current snapshot'))

    const response = await h3.toPlainHandler(app)({ method: 'GET', path: '/b/stable-uuid', headers: {} })

    expect(response.body).toBe('current snapshot')
    expect(new Headers(response.headers as never).get('cache-control')).toBe('private, no-store')
    expect(cache.match).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('sets no-store on rendered HTML without storing an edge entry', async () => {
    const cache = { match: vi.fn(), put: vi.fn() }
    vi.stubGlobal('caches', { default: cache })
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    const { default: install } = await import('../../../server/plugins/share-cache')
    let render: (response: unknown, ctx: { event: h3.H3Event }) => void = () => {}
    install({ hooks: { hook: (_name: string, callback: typeof render) => { render = callback } } } as never)
    const app = h3.createApp()
    app.use(h3.defineEventHandler(event => {
      render({ statusCode: 200, body: 'current snapshot' }, { event })
      return 'current snapshot'
    }))

    const response = await h3.toPlainHandler(app)({ method: 'GET', path: '/b/stable-uuid', headers: {} })

    expect(new Headers(response.headers as never).get('cache-control')).toBe('private, no-store')
    expect(cache.put).not.toHaveBeenCalled()
  })
})
