import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class<Environment> {
    protected env: Environment

    constructor(_ctx: ExecutionContext, env: Environment) {
      this.env = env
    }
  }
}))

import { ContentEntry } from '@/entry/edge/contentEntry'
import { EDGE_RAY_ID_HEADER } from '@/const/edge'

const execution = {} as ExecutionContext
afterEach(() => vi.restoreAllMocks())

describe('ContentEntry edge adapter', () => {
  test('logs metadata stages in prod while retaining the original response and Ray linkage', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const original = Response.json({ uuid: 'bookmark-1' })
    const fetch = vi.fn().mockResolvedValue(original)
    const entry = new ContentEntry(execution, { CORE: { fetch }, RUN_TYPE: 'prod' } as unknown as Env)

    const response = await entry.fetch(new Request('https://content.internal/content/meta?uuid=bookmark-1', {
      headers: { 'CF-Ray': 'outer-ray' }
    }))

    expect(response).toBe(original)
    expect(response.headers.get('Server-Timing')).toBeNull()
    expect((fetch.mock.calls[0][0] as Request).headers.get(EDGE_RAY_ID_HEADER)).toBe('outer-ray')
    expect(info.mock.calls.map(call => call[1])).toEqual([
      expect.objectContaining({ scope: 'edge', phase: 'entry', ray_id: 'outer-ray' }),
      expect.objectContaining({ scope: 'edge', phase: 'response', status_code: 200, phases_ms: { 'core-fetch': expect.any(Number) } })
    ])
    info.mockRestore()
  })

  test('logs a binding failure and propagates the original error', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const error = new Error('binding failed')
    const entry = new ContentEntry(execution, { CORE: { fetch: vi.fn().mockRejectedValue(error) }, RUN_TYPE: 'prod' } as unknown as Env)

    await expect(entry.fetch(new Request('https://content.internal/content/meta?uuid=bookmark-1'))).rejects.toBe(error)
    expect(info.mock.calls[1][1]).toMatchObject({ scope: 'edge', phase: 'response', outcome: 'failed' })
    info.mockRestore()
  })

  test('does not add metadata logs to other content operations', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const entry = new ContentEntry(execution, { CORE: { fetch: vi.fn().mockResolvedValue(Response.json({ ok: true })) }, RUN_TYPE: 'prod' } as unknown as Env)
    await entry.fetch(new Request('https://content.internal/content/visit', { method: 'POST' }))
    expect(info).not.toHaveBeenCalled()
    info.mockRestore()
  })

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
