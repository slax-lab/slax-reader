/**
 * /content/collection_event 收口点
 * 钉住：事件名白名单、code 校验、extra 白名单与截断
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class {},
  DurableObject: class {},
  RpcTarget: class {},
  WorkflowEntrypoint: class {},
  env: {}
}))
vi.mock('agents/mcp', () => ({ McpAgent: class {} }))

import { container } from '@/decorators/di'
import { LogsService } from '@/domain/logs'
import { handleContentRequest } from '@/handler/http/contentHandler'

const track = vi.fn().mockResolvedValue(undefined)

const env = {
  RUN_TYPE: 'prod', // 关掉 Server-Timing，让断言只看业务响应
  HASH_IDS_SALT: 'test-salt'
} as unknown as Env

const execution = { waitUntil: vi.fn() } as unknown as ExecutionContext

function post(body: unknown, headers: Record<string, string> = {}) {
  return handleContentRequest(
    new Request('https://content.internal/content/collection_event', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    }),
    env,
    execution
  )
}

/** 取最后一次 track 调用的 extraData */
const lastExtra = () => track.mock.calls.at(-1)?.[2] as Record<string, unknown>

beforeEach(() => {
  track.mockClear()
  // container.clone() 只拷 providers，所以注册 provider 而非 instance
  container.register(LogsService, { useValue: { track } as unknown as LogsService })
})

describe('collection_event 事件名白名单', () => {
  test.each(['collection_visit', 'collection_share'])('%s 放行', async event => {
    const res = await post({ event, code: 'abc123' })
    expect(res.status).toBe(200)
    expect(track).toHaveBeenCalledTimes(1)
    expect(track.mock.calls[0][1]).toBe(event)
  })

  // 订阅事件不该经公开 RPC，防伪造
  test.each(['collection_subscribe', 'collection_unsubscribe', 'visit', 'register', '', 'bookmark_add'])('%s 拒绝 400 且不落库', async event => {
    const res = await post({ event, code: 'abc123' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'unsupported event' })
    expect(track).not.toHaveBeenCalled()
  })

  test('缺 event 字段 → 400', async () => {
    expect((await post({ code: 'abc123' })).status).toBe(400)
    expect(track).not.toHaveBeenCalled()
  })
})

describe('collection_event code 格式校验', () => {
  test.each(['abc123', 'ABC', 'a', '0', 'AbC123XyZ'])('合法 code %s 放行', async code => {
    const res = await post({ event: 'collection_visit', code })
    expect(res.status).toBe(200)
    expect(lastExtra().collect_code).toBe(code)
  })

  // 脏 code 落库会污染维度
  test.each([' ', '%20', '..', '../etc', 'abc-def', 'abc_def', 'abc.def', 'a/b', 'ab c', '<script>', "a'b", ''])('非法 code %j 拒绝 400 且不落库', async code => {
    const res = await post({ event: 'collection_visit', code })
    expect(res.status).toBe(400)
    expect(track).not.toHaveBeenCalled()
  })

  test('格式合法但合集不存在 → 照常落库（有意保留的信号：旧链接被点/code 抄错）', async () => {
    const res = await post({ event: 'collection_visit', code: 'nonexistentcode', extra: { status_code: 404 } })
    expect(res.status).toBe(200)
    expect(lastExtra()).toMatchObject({ collect_code: 'nonexistentcode', status_code: 404, success: false })
  })
})

describe('sanitizeCollectionExtra key 白名单', () => {
  test('白名单键全部透传', async () => {
    await post({
      event: 'collection_visit',
      code: 'abc123',
      extra: { entry_page: 2, is_curator: true, is_bot: false, via: 'ssr', duration_ms: 120, status_code: 200 }
    })
    expect(lastExtra()).toMatchObject({
      entry_page: 2,
      is_curator: true,
      is_bot: false,
      via: 'ssr',
      duration_ms: 120,
      status_code: 200
    })
  })

  test('白名单外的键被丢弃', async () => {
    await post({
      event: 'collection_share',
      code: 'abc123',
      extra: { evil: 'x', user_id: 999, platform: 'ios', collect_code: 'hijacked', signup_age_sec: 1, is_new_user: true, referrer: 'https://evil.test' }
    })
    const extra = lastExtra()
    expect(extra.evil).toBeUndefined()
    expect(extra.user_id).toBeUndefined()
    expect(extra.signup_age_sec).toBeUndefined()
    expect(extra.is_new_user).toBeUndefined()
    expect(extra.referrer).toBeUndefined()
    // 服务端写死的字段不可被顶掉
    expect(extra.platform).toBe('web')
    expect(extra.collect_code).toBe('abc123')
  })

  test('visitor_id 不能经 extra 覆盖（身份字段只认 RPC 单独传参）', async () => {
    await post({ event: 'collection_visit', code: 'abc123', visitorId: 'real-visitor', extra: { visitor_id: 'spoofed' } })
    expect(lastExtra().visitor_id).toBe('real-visitor')
  })

  test('未传 visitorId 时 visitor_id 为 undefined，不会被 extra 顶成伪造值', async () => {
    await post({ event: 'collection_visit', code: 'abc123', extra: { visitor_id: 'spoofed' } })
    expect(lastExtra().visitor_id).toBeUndefined()
  })

  test('字符串值截断到 512', async () => {
    await post({ event: 'collection_visit', code: 'abc123', extra: { via: 'v'.repeat(1000) } })
    expect((lastExtra().via as string).length).toBe(512)
  })

  test('null / undefined 值被丢弃，不写进 extra_data', async () => {
    await post({ event: 'collection_visit', code: 'abc123', extra: { entry_page: null, is_curator: undefined, is_bot: false } })
    const extra = lastExtra()
    expect('entry_page' in extra).toBe(false)
    expect('is_curator' in extra).toBe(false)
    expect(extra.is_bot).toBe(false) // false 不是 null，必须保留
  })

  test('extra 缺失时不报错，只落 platform + collect_code', async () => {
    const res = await post({ event: 'collection_share', code: 'abc123' })
    expect(res.status).toBe(200)
    expect(lastExtra()).toEqual({ platform: 'web', collect_code: 'abc123', success: undefined, visitor_id: undefined })
  })
})

describe('success 由服务端从 status_code 推导', () => {
  test.each([
    [200, true],
    [301, true],
    [399, true],
    [400, false],
    [404, false],
    [499, false],
    [500, false]
  ])('status_code %i → success %s', async (statusCode, expected) => {
    await post({ event: 'collection_visit', code: 'abc123', extra: { status_code: statusCode } })
    expect(lastExtra().success).toBe(expected)
  })

  test('调用方传入的 success 被忽略（不在 extra 白名单里）', async () => {
    await post({ event: 'collection_visit', code: 'abc123', extra: { status_code: 500, success: true } })
    expect(lastExtra().success).toBe(false)
  })

  test('无 status_code（SPA 通道）→ success 为 undefined，不伪造成功', async () => {
    await post({ event: 'collection_visit', code: 'abc123', extra: { via: 'spa' } })
    expect(lastExtra().success).toBeUndefined()
  })

  test('status_code 是字符串时不推导 success（typeof 严格判断）', async () => {
    await post({ event: 'collection_visit', code: 'abc123', extra: { status_code: '200' } })
    expect(lastExtra().success).toBeUndefined()
  })
})

describe('collection_event 身份口径', () => {
  test('无 token → user_id 0（匿名），visitor_id 落 extra_data', async () => {
    await post({ event: 'collection_visit', code: 'abc123', visitorId: 'su-cookie-value' })
    expect(track.mock.calls[0][0]).toBe(0)
    expect(lastExtra().visitor_id).toBe('su-cookie-value')
  })

  test('显式无效 token 返回未授权，不降级为匿名上报', async () => {
    const res = await post({ event: 'collection_visit', code: 'abc123', visitorId: 'v1' }, { Authorization: 'Bearer garbage-token' })
    expect(res.status).toBe(401)
    expect(track).not.toHaveBeenCalled()
  })
})

// platform 从转发来的 UA 推导，不再写死 web
describe('collection_event platform 判定', () => {
  test('客户端 UA → ios / android', async () => {
    await post({ event: 'collection_visit', code: 'abc123' }, { 'User-Agent': 'SlaxReader/iOS 1.2.3' })
    expect(lastExtra().platform).toBe('ios')

    await post({ event: 'collection_visit', code: 'abc123' }, { 'User-Agent': 'SlaxReader/Android 1.0' })
    expect(lastExtra().platform).toBe('android')
  })

  test('自报头优先于 UA', async () => {
    await post({ event: 'collection_visit', code: 'abc123' }, { 'X-CLIENT-TYPE': 'extension', 'User-Agent': 'Mozilla/5.0 Chrome/128' })
    expect(lastExtra().platform).toBe('extension')
  })

  test('浏览器 UA 与无 UA 都落 web', async () => {
    await post({ event: 'collection_visit', code: 'abc123' }, { 'User-Agent': 'Mozilla/5.0 Chrome/128' })
    expect(lastExtra().platform).toBe('web')

    await post({ event: 'collection_visit', code: 'abc123' })
    expect(lastExtra().platform).toBe('web')
  })

  // extra 里塞 platform 不生效，防伪造
  test('platform 不接受 body 传入', async () => {
    await post({ event: 'collection_visit', code: 'abc123', extra: { platform: 'ios' } }, { 'User-Agent': 'Mozilla/5.0 Chrome/128' })
    expect(lastExtra().platform).toBe('web')
  })
})

describe('collection_event dispatcher 挂载', () => {  test('GET 不命中该路由（只接受 POST）', async () => {
    const res = await handleContentRequest(new Request('https://content.internal/content/collection_event'), env, execution)
    expect(res.status).toBe(404)
    expect(track).not.toHaveBeenCalled()
  })

  test('body 非 JSON → 500（被 dispatcher 的 catch 兜住，不抛出 worker）', async () => {
    const res = await handleContentRequest(
      new Request('https://content.internal/content/collection_event', { method: 'POST', body: 'not-json' }),
      env,
      execution
    )
    expect(res.status).toBe(500)
    expect(track).not.toHaveBeenCalled()
  })
})
