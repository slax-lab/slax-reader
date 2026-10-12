import { describe, test, expect, vi } from 'vitest'
import { rateLimit } from '@/middleware/rateLimit'
import { ContextManager } from '@/utils/context'
import { EDGE_IDENTITY_HEADER, EDGE_SECRET_HEADER } from '@/const/edge'

function mockCtx(userId: number, limiter?: { limit: (options: { key: string }) => Promise<{ success: boolean }> }, edgeSecret?: string) {
  return {
    env: { BOOKMARK_ADD_RATE_LIMITER: limiter, EDGE_SHARED_SECRET: edgeSecret },
    getUserId: () => userId
  } as unknown as ContextManager
}

describe('rateLimit middleware', () => {
  test('skips routes not in the rate limited list', async () => {
    const limit = vi.fn()
    await rateLimit(new Request('https://reader-api.slax.dev/v1/bookmark/list'), mockCtx(1, { limit }))
    expect(limit).not.toHaveBeenCalled()
  })

  test('skips when method does not match', async () => {
    const limit = vi.fn()
    await rateLimit(new Request('https://reader-api.slax.dev/v1/bookmark/add', { method: 'GET' }), mockCtx(1, { limit }))
    expect(limit).not.toHaveBeenCalled()
  })

  test('passes when under the limit, keyed by user id', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true })
    await rateLimit(new Request('https://reader-api.slax.dev/v1/bookmark/add', { method: 'POST' }), mockCtx(42, { limit }))
    expect(limit).toHaveBeenCalledWith({ key: 'uid:42' })
  })

  test('throws 429 when limit exceeded', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false })
    const req = new Request('https://reader-api.slax.dev/v1/bookmark/add_url', { method: 'POST' })
    await expect(rateLimit(req, mockCtx(42, { limit }))).rejects.toMatchObject({ errCode: 429, name: 'TOO_MANY_REQUESTS' })
  })

  test('falls back to ip key when user id is missing', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true })
    const req = new Request('https://reader-api.slax.dev/v1/bookmark/add', { method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4' } })
    await rateLimit(req, mockCtx(0, { limit }))
    expect(limit).toHaveBeenCalledWith({ key: 'ip:1.2.3.4' })
  })

  test('fails closed when binding is not configured outside development', async () => {
    await expect(rateLimit(new Request('https://reader-api.slax.dev/v1/bookmark/add', { method: 'POST' }), mockCtx(1))).rejects.toThrow('BOOKMARK_ADD_RATE_LIMITER is required')
  })

  test('allows explicitly configured local development without the binding', async () => {
    const ctx = mockCtx(1)
    ctx.env.RUN_ENV = 'development'
    await expect(rateLimit(new Request('https://reader-api.slax.dev/v1/bookmark/add', { method: 'POST' }), ctx)).resolves.toBeUndefined()
  })

  test('core skips a duplicate check only for a trusted edge identity', async () => {
    const limit = vi.fn()
    const req = new Request('https://api-reader.slax.com/v1/bookmark/add', {
      method: 'POST',
      headers: { [EDGE_SECRET_HEADER]: 'shared', [EDGE_IDENTITY_HEADER]: 'identity' }
    })
    await rateLimit(req, mockCtx(42, { limit }, 'shared'))
    expect(limit).not.toHaveBeenCalled()
  })

  test('shared secret without an identity does not bypass API-key rate limiting', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true })
    const req = new Request('https://api-reader.slax.com/v1/bookmark/add', {
      method: 'POST',
      headers: { [EDGE_SECRET_HEADER]: 'shared', 'X-API-Key': 'key' }
    })
    await rateLimit(req, mockCtx(42, { limit }, 'shared'))
    expect(limit).toHaveBeenCalledWith({ key: 'uid:42' })
  })
})
