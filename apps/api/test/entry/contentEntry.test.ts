import { describe, expect, test, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class<Environment> {
    protected env: Environment

    constructor(_ctx: ExecutionContext, env: Environment) {
      this.env = env
    }
  }
}))

import { ContentEntry } from '@/entry/edge/contentEntry'

const execution = {} as ExecutionContext

describe('ContentEntry edge adapter', () => {
  test('translates direct fetch bearer auth into the internal core token header', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ role: 'owner' }))
    const entry = new ContentEntry(execution, { CORE: { fetch }, RUN_TYPE: 'beta' } as unknown as Env)

    await entry.fetch(
      new Request('https://content.internal/content/meta?uuid=bookmark-1', {
        headers: { Authorization: 'Bearer token-1' }
      })
    )

    const request = fetch.mock.calls[0][0] as Request
    expect(request.headers.get('Authorization')).toBeNull()
    expect(request.headers.get('x-slax-token')).toBe('token-1')
  })

  test('forwards content metadata requests to the placed core fetch handler', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ uuid: 'bookmark-1' }))
    const entry = new ContentEntry(execution, { CORE: { fetch }, RUN_TYPE: 'beta' } as unknown as Env)

    await expect(entry.getContentMeta('bookmark-1', 'token-1')).resolves.toEqual({ uuid: 'bookmark-1' })

    const request = fetch.mock.calls[0][0] as Request
    expect(request.url).toBe('https://content.internal/content/meta?uuid=bookmark-1')
    expect(request.headers.get('Authorization')).toBeNull()
    expect(request.headers.get('x-slax-token')).toBe('token-1')
  })

  test('appends edge timings to Server-Timing outside prod', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ uuid: 'bookmark-1' }, { headers: { 'Server-Timing': 'core_total;dur=12.3' } }))
    const entry = new ContentEntry(execution, { CORE: { fetch }, RUN_TYPE: 'beta' } as unknown as Env)

    const response = await entry.fetch(new Request('https://content.internal/content/meta?uuid=bookmark-1'))

    expect(response.headers.get('Server-Timing')).toContain('core_total;dur=12.3')
    expect(response.headers.get('Server-Timing')).toContain('edge_core-fetch;dur=')
    expect(response.headers.get('Server-Timing')).toContain('edge_total;dur=')
  })

  test('returns the core response untouched in prod', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ uuid: 'bookmark-1' }))
    const entry = new ContentEntry(execution, { CORE: { fetch }, RUN_TYPE: 'prod' } as unknown as Env)

    const response = await entry.fetch(new Request('https://content.internal/content/meta?uuid=bookmark-1'))

    expect(response.headers.get('Server-Timing')).toBeNull()
  })

  test('forwards visit tracking and share lookups to core', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ uuid: 'user-bookmark-1' }))
    const entry = new ContentEntry(execution, { CORE: { fetch }, RUN_TYPE: 'beta' } as unknown as Env)

    await entry.trackEvent({ event: 'visit', target: 'bookmark-1', visitorId: 'visitor-1', durationMs: 1200, statusCode: 200, isOwner: false })
    await expect(entry.getBookmarkUserUuidByShareCode('share-code')).resolves.toBe('user-bookmark-1')

    const visitRequest = fetch.mock.calls[0][0] as Request
    expect(visitRequest.url).toBe('https://content.internal/content/visit')
    expect(visitRequest.method).toBe('POST')
    await expect(visitRequest.json()).resolves.toMatchObject({ uuid: 'bookmark-1', visitorId: 'visitor-1', durationMs: 1200 })
    expect(fetch.mock.calls[1][0]).toBe('https://content.internal/content/share_uuid?code=share-code')
  })

  // 星标合集观测：匿名侧事件（visit / share）的 RPC 入口，绕开 edge 鉴权层
  test('forwards collection telemetry events to the core collection_event endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const entry = new ContentEntry(execution, { CORE: { fetch }, RUN_TYPE: 'beta' } as unknown as Env)

    await entry.trackEvent({
      event: 'collection_visit',
      target: 'abc123',
      token: 'token-1',
      visitorId: 'visitor-1',
      durationMs: 1200,
      statusCode: 200,
      extra: { entry_page: 2, via: 'ssr', is_bot: false }
    })

    const request = fetch.mock.calls[0][0] as Request
    expect(request.url).toBe('https://content.internal/content/collection_event')
    expect(request.method).toBe('POST')
    // token 走 Authorization（内部 fetch 由 core 侧解析），身份不进 body
    expect(request.headers.get('Authorization')).toBe('Bearer token-1')
    // duration_ms / status_code 由统一入口转成 snake_case
    await expect(request.json()).resolves.toEqual({
      event: 'collection_visit',
      code: 'abc123',
      visitorId: 'visitor-1',
      extra: { entry_page: 2, via: 'ssr', is_bot: false, duration_ms: 1200, status_code: 200 }
    })
  })

  // platform 由 core 侧按 UA 判定，RPC 不带原请求头，必须显式转发
  test('forwards the visitor user agent so core can derive platform', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const entry = new ContentEntry(execution, { CORE: { fetch }, RUN_TYPE: 'beta' } as unknown as Env)

    await entry.trackEvent({ event: 'collection_visit', target: 'abc123', userAgent: 'SlaxReader/iOS 1.2.3' })
    expect((fetch.mock.calls[0][0] as Request).headers.get('User-Agent')).toBe('SlaxReader/iOS 1.2.3')

    await entry.trackEvent({ event: 'visit', target: 'bookmark-1' })
    expect((fetch.mock.calls[1][0] as Request).headers.get('User-Agent')).toBeNull()
  })

  test('keeps the existing visit and collection RPC methods compatible', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const entry = new ContentEntry(execution, { CORE: { fetch }, RUN_TYPE: 'beta' } as unknown as Env)

    await entry.trackVisit('bookmark-1', 'token-1', 'visitor-1', 1200, 200, true)
    await entry.trackCollectionEvent('collection_visit', 'abc123', 'token-1', 'visitor-1', { via: 'ssr' })

    await expect((fetch.mock.calls[0][0] as Request).json()).resolves.toMatchObject({ uuid: 'bookmark-1', visitorId: 'visitor-1', isOwner: true })
    await expect((fetch.mock.calls[1][0] as Request).json()).resolves.toEqual({ event: 'collection_visit', code: 'abc123', visitorId: 'visitor-1', extra: { via: 'ssr' } })
  })

  test('omits Authorization for anonymous collection events', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const entry = new ContentEntry(execution, { CORE: { fetch }, RUN_TYPE: 'beta' } as unknown as Env)

    await entry.trackEvent({ event: 'collection_share', target: 'abc123', visitorId: 'visitor-1' })

    const request = fetch.mock.calls[0][0] as Request
    expect(request.headers.get('Authorization')).toBeNull()
    await expect(request.json()).resolves.toEqual({ event: 'collection_share', code: 'abc123', visitorId: 'visitor-1', extra: {} })
  })

  // core 返回 4xx（事件名/code 被拒）必须抛出，否则 dweb 侧的 .catch 日志永远看不到埋点被拒
  test('throws when core rejects a collection event', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: 'invalid code' }, { status: 400 }))
    const entry = new ContentEntry(execution, { CORE: { fetch }, RUN_TYPE: 'beta' } as unknown as Env)

    await expect(entry.trackEvent({ event: 'collection_visit', target: 'bad code' })).rejects.toThrow('collection_visit returned 400')
  })
})
