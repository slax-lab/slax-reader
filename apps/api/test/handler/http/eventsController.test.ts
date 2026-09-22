import type { EventsResponse } from '@slax-reader/contracts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ContextManager } from '@/utils/context'
import { EventsController } from '@/handler/http/eventsController'
import { auth } from '@/middleware/auth'
import { Auth } from '@/utils/jwt'
import { Hashid } from '@/utils/hashids'
import { cors } from '@/middleware/cors'

const send = vi.fn().mockResolvedValue(undefined)
const pending: Promise<unknown>[] = []
const execution = {
  waitUntil: vi.fn((promise: Promise<unknown>) => pending.push(promise))
} as unknown as ExecutionContext
const env = {
  SLAX_READER_STREAM_STREAM: { send },
  JWT_SECRET_TEXT: 'test-only-event-identity-secret',
  JWT_ISSUER: 'events.test',
  JWT_EXPIRES: 600,
  JWT_ALGORITHMS: 'HS256',
  HASH_IDS_SALT: 'events-test'
} as unknown as Env

const post = async (body: unknown, headers: Record<string, string> = {}) => {
  const ctx = new ContextManager(execution, env)
  const request = new Request('https://events.test/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  await auth(request, ctx, {
    resolve: () => ({ $queryRaw: async () => [{ id: ctx.getUserId() }] })
  } as never)
  return new EventsController().handleEvents(ctx, request)
}

beforeEach(() => {
  send.mockClear()
  vi.mocked(execution.waitUntil).mockClear()
  pending.length = 0
})

describe('POST /events', () => {
  test.each(['/events', '/v1/user/login', '/v1/user/me', '/m'])('网页设备头允许通过跨域预检: %s', async path => {
    const response = await cors(
      new Request(`https://events.test${path}`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'authorization,content-type,x-device-id' } }),
      new ContextManager(execution, env)
    )
    expect(response?.status).toBe(204)
    expect(response?.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('x-device-id')
  })

  test('校验后通过 waitUntil 提交，并立即返回 received/dropped', async () => {
    const response = await post(
      {
        events: [
          {
            event_name: 'screen_viewed',
            occurred_at: '2026-09-03T10:00:00.000Z',
            properties: { screen_name: 'signup', platform: 'web' },
            user_id: 999,
            ua: 'spoofed'
          }
        ]
      },
      { 'x-device-id': 'su-test', 'user-agent': 'real-agent' }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ received: 1, dropped: 0 } satisfies EventsResponse)
    expect(execution.waitUntil).toHaveBeenCalledTimes(1)
    await Promise.all(pending)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0][0]).toMatchObject({
      event_name: 'screen_viewed',
      occurred_at: '2026-09-03T10:00:00.000Z',
      user_id: 0,
      device_id: 'su-test',
      properties: { screen_name: 'signup', platform: 'web' },
      ua: 'real-agent'
    })
  })

  test('event_name 为空只丢该条，其余照收', async () => {
    const response = await post(
      {
        events: [
          { event_name: '', properties: {} },
          { event_name: 'screen_viewed', properties: { screen_name: 'bookmarks' } }
        ]
      },
      { 'x-device-id': 'web-device' }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: 1, dropped: 1 })
    await Promise.all(pending)
    expect(send.mock.calls[0][0]).toHaveLength(1)
  })

  test('_su cookie 作为 web device_id，显式 X-Device-ID 优先', async () => {
    await post({ events: [{ event_name: 'screen_viewed' }] }, { cookie: '_su=web-device' })
    await Promise.all(pending)
    expect(send.mock.calls[0][0][0].device_id).toBe('web-device')

    send.mockClear()
    pending.length = 0
    await post({ events: [{ event_name: 'screen_viewed' }] }, { cookie: '_su=web-device', 'x-device-id': 'mobile-device' })
    await Promise.all(pending)
    expect(send.mock.calls[0][0][0].device_id).toBe('mobile-device')
  })

  test.each([{}, { 'x-device-id': '   ' }, { cookie: '_su=%20%20' }])('拒绝缺失设备身份，不能成功提交空 device_id: %j', async headers => {
    const response = await post({ events: [{ event_name: 'screen_viewed', device_id: 'untrusted-body-device' }] }, headers)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'missing device_id: send X-Device-ID' })
    expect(send).not.toHaveBeenCalled()
    expect(execution.waitUntil).not.toHaveBeenCalled()
  })

  test('空设备头使用已有 cookie，而不是写入空值', async () => {
    const response = await post({ events: [{ event_name: 'screen_viewed' }] }, { 'x-device-id': ' ', cookie: '_su=web-device' })
    expect(response.status).toBe(200)
    await Promise.all(pending)
    expect(send.mock.calls[0][0][0].device_id).toBe('web-device')
  })

  test('登录前后复用同一设备，登录后的 user_id 来自真实鉴权', async () => {
    const payload = { events: [{ event_name: 'screen_viewed', user_id: 999 }] }
    await post(payload, { 'x-device-id': 'web-device' })
    await Promise.all(pending)
    expect(send.mock.calls[0][0][0]).toMatchObject({ user_id: 0, device_id: 'web-device' })

    const token = await new Auth(env).sign({ id: String(new Hashid(env).encodeId(7)), email: 'test@example.test', lang: 'en' })
    await post(payload, { 'x-device-id': 'web-device', Authorization: `Bearer ${token}` })
    await Promise.all(pending)
    expect(send.mock.calls[1][0][0]).toMatchObject({ user_id: 7, device_id: 'web-device' })
  })

  test('无效登录凭证不会降级成匿名记录', async () => {
    await expect(post({ events: [{ event_name: 'screen_viewed' }] }, { 'x-device-id': 'web-device', Authorization: 'Bearer invalid' })).rejects.toMatchObject({ errCode: 401 })
    expect(send).not.toHaveBeenCalled()
  })

  test('空批次不要求设备字段，也不提交数据', async () => {
    const response = await post({ events: [] })
    expect(await response.json()).toEqual({ received: 0, dropped: 0 })
    expect(send).not.toHaveBeenCalled()
  })

  test('全部为空事件名时仍按契约返回 dropped，而不是因缺设备身份拒收', async () => {
    const response = await post({ events: [{ event_name: '' }, { event_name: ' ' }] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: 0, dropped: 2 })
    expect(send).not.toHaveBeenCalled()
  })

  test.each([
    null,
    {},
    { events: 'not-an-array' },
    { events: [null] },
    { events: [{ event_name: 'screen_viewed', occurred_at: 'not-a-date' }] },
    { events: [{ event_name: 'screen_viewed', properties: [] }] }
  ])('非法 body 整体返回 400: %j', async body => {
    const response = await post(body, { 'x-device-id': 'web-device' })
    expect(response.status).toBe(400)
    expect(send).not.toHaveBeenCalled()
    expect(execution.waitUntil).not.toHaveBeenCalled()
  })

  test('超过 50 条整体返回 400', async () => {
    const response = await post({ events: Array.from({ length: 51 }, () => ({ event_name: 'screen_viewed' })) })
    expect(response.status).toBe(400)
    expect(send).not.toHaveBeenCalled()
  })
})
