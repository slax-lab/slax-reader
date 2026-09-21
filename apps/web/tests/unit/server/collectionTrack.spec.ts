// @vitest-environment happy-dom
// track.post.ts 的输入校验与准入判定
// 固定 happy-dom：默认的 nuxt 环境会编译整个 app/
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const COOKIE_TOKEN_NAME = 'token'
const HOST = 'reader.test'
const ORIGIN = `https://${HOST}`

// vitest 里 useRuntimeConfig 解析到客户端那份，换成固定配置
vi.mock('#app/nuxt', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRuntimeConfig: () => ({ public: { COOKIE_TOKEN_NAME } })
}))

const trackEvent = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
const waitUntil = vi.fn((p: Promise<unknown>) => p)

type PlainResponse = { status: number; headers: Record<string, string | string[]> }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handler: (request: any) => Promise<PlainResponse>

beforeAll(async () => {
  const h3 = await import('h3')
  const g = globalThis as unknown as Record<string, unknown>
  g.defineEventHandler = h3.defineEventHandler

  const mod = await import('../../../server/api/collection/track.post')
  const app = h3.createApp()
  app.use('/api/collection/track', mod.default)
  // 不能换 toWebHandler：它要构造 Request，cookie / origin 会被剥掉
  handler = h3.toPlainHandler(app) as unknown as typeof handler
})

type CallOptions = { body?: unknown; cookie?: string; origin?: string | null; backend?: boolean; raw?: string; userAgent?: string }

function call(options: CallOptions = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', host: HOST, 'x-forwarded-proto': 'https' }
  if (options.cookie) headers.cookie = options.cookie
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN
  if (options.userAgent) headers['user-agent'] = options.userAgent

  const cloudflare = options.backend === false ? { env: {}, context: { waitUntil } } : { env: { BACKEND: { trackEvent } }, context: { waitUntil } }

  return handler({
    method: 'POST',
    path: '/api/collection/track',
    headers,
    body: options.raw ?? JSON.stringify(options.body ?? {}),
    context: { cloudflare }
  })
}

/** 最近一次 RPC 实参 */
const lastCall = () =>
  trackEvent.mock.calls.at(-1)?.[0] as {
    event: string
    target: string
    token?: string
    visitorId: string
    userAgent?: string
    extra: Record<string, unknown>
  }

// toPlainHandler 的 headers 是 entries 数组
// 按属性取会恒得 undefined，导致假通过
const setCookieOf = (res: PlainResponse) => {
  const raw = res.headers as unknown
  if (Array.isArray(raw)) {
    return raw
      .filter(entry => String(entry[0]).toLowerCase() === 'set-cookie')
      .map(entry => entry[1])
      .join('; ')
  }
  const value = (raw as Record<string, unknown>)['set-cookie']
  return Array.isArray(value) ? value.join('; ') : ((value as string) ?? '')
}

beforeEach(() => {
  trackEvent.mockClear()
  waitUntil.mockClear()
})

describe('collection track endpoint · 事件名白名单', () => {
  it.each(['collection_share', 'collection_visit'])('放行白名单事件 %s', async name => {
    const res = await call({ body: { event: name, code: 'abc123' } })
    expect(res.status).toBe(204)
    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(lastCall().event).toBe(name)
  })

  it.each([
    ['服务端专属事件不能从公开端点写入', 'collection_subscribe'],
    ['同理 unsubscribe', 'collection_unsubscribe'],
    ['完全无关的事件', 'register'],
    ['空事件名', ''],
    ['大小写不敏感匹配不该放行', 'Collection_Share']
  ])('拒绝：%s', async (_label, name) => {
    const res = await call({ body: { event: name, code: 'abc123' } })
    expect(res.status).toBe(204) // 拒绝也返回 204，不给探测者任何信号
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('event 不是字符串（类型混淆）→ 拒绝', async () => {
    await call({ body: { event: { toString: () => 'collection_share' }, code: 'abc123' } })
    await call({ body: { event: ['collection_share'], code: 'abc123' } })
    expect(trackEvent).not.toHaveBeenCalled()
  })
})

describe('collection track endpoint · code 校验', () => {
  it('合法 code 放行（纯字母数字）', async () => {
    await call({ body: { event: 'collection_share', code: 'aZ09' } })
    expect(lastCall().target).toBe('aZ09')
  })

  it.each([
    ['空 code', ''],
    ['缺失 code', undefined],
    ['带斜杠（路径穿越）', 'ab/cd'],
    ['带点（../）', '..'],
    ['URL 编码的空格', '%20'],
    ['连字符', 'ab-cd'],
    ['下划线', 'ab_cd'],
    ['中文', '合集'],
    ['SQL 注入形状', "abc' OR 1=1--"],
    ['换行注入', 'abc\ndef'],
    ['尖括号', '<script>']
  ])('拒绝：%s', async (_label, code) => {
    await call({ body: { event: 'collection_share', code } })
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('长度上限 64：64 放行、65 拒绝', async () => {
    await call({ body: { event: 'collection_share', code: 'a'.repeat(64) } })
    expect(trackEvent).toHaveBeenCalledTimes(1)
    await call({ body: { event: 'collection_share', code: 'a'.repeat(65) } })
    expect(trackEvent).toHaveBeenCalledTimes(1) // 没有新增调用
  })

  it('code 不是字符串 → 拒绝', async () => {
    await call({ body: { event: 'collection_share', code: 123 } })
    expect(trackEvent).not.toHaveBeenCalled()
  })
})

describe('collection track endpoint · 同源校验', () => {
  it('同源 Origin 放行', async () => {
    await call({ body: { event: 'collection_share', code: 'abc' }, origin: ORIGIN })
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it('跨站 Origin 拒绝', async () => {
    await call({ body: { event: 'collection_share', code: 'abc' }, origin: 'https://evil.test' })
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('同域不同协议/端口也算跨源', async () => {
    await call({ body: { event: 'collection_share', code: 'abc' }, origin: 'http://reader.test' })
    await call({ body: { event: 'collection_share', code: 'abc' }, origin: 'https://reader.test:8443' })
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('Origin 缺失 → 跳过同源校验（同源 fetch 有时不带）', async () => {
    await call({ body: { event: 'collection_share', code: 'abc' }, origin: null })
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })
})

describe('collection track endpoint · body 解析与出口', () => {
  it('非法 JSON → 204，不落库', async () => {
    const res = await call({ event: undefined, raw: '{not json' } as CallOptions)
    expect(res.status).toBe(204)
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('BACKEND 绑定缺失 → 204，不抛错', async () => {
    const res = await call({ body: { event: 'collection_share', code: 'abc' }, backend: false })
    expect(res.status).toBe(204)
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('RPC 失败不影响响应（错误被 catch 住）', async () => {
    trackEvent.mockRejectedValueOnce(new Error('rpc down'))
    const res = await call({ body: { event: 'collection_share', code: 'abc' } })
    expect(res.status).toBe(204)
  })

  it('走 waitUntil 异步上报，不阻塞响应', async () => {
    await call({ body: { event: 'collection_share', code: 'abc' } })
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })
})

describe('collection track endpoint · 身份字段服务端接管', () => {
  it('token 从 cookie 取，客户端传不进来', async () => {
    await call({ body: { event: 'collection_share', code: 'abc', token: 'forged' } as never, cookie: `${COOKIE_TOKEN_NAME}=real-token` })
    expect(lastCall().token).toBe('real-token')
  })

  it('无 token cookie → token 为 undefined（匿名）', async () => {
    await call({ body: { event: 'collection_share', code: 'abc' } })
    expect(lastCall().token).toBeUndefined()
  })

  it('visitor_id 取 _su cookie，不接受 body 传入', async () => {
    await call({ body: { event: 'collection_share', code: 'abc', visitor_id: 'forged-visitor' } as never, cookie: '_su=real-visitor.123' })
    expect(lastCall().visitorId).toBe('real-visitor.123')
  })

  it('_su 缺失时铸新 id，并通过 Set-Cookie 下发（含 lax / 365 天）', async () => {
    const res = await call({ body: { event: 'collection_share', code: 'abc' } })
    const setCookie = setCookieOf(res)
    expect(setCookie).toContain('_su=')
    expect(setCookie).toContain('Max-Age=31536000')
    expect(setCookie.toLowerCase()).toContain('samesite=lax')
    expect(lastCall().visitorId).toMatch(/^[0-9a-f]{32}\.\d+$/)
  })

  it('已有 _su 时复用，不重新下发 cookie', async () => {
    const res = await call({ body: { event: 'collection_share', code: 'abc' }, cookie: '_su=existing.999' })
    expect(lastCall().visitorId).toBe('existing.999')
    expect(setCookieOf(res)).not.toContain('_su=')
  })

  // 后端按 UA 判 platform，RPC 不带原请求头
  it('转发访客 UA', async () => {
    await call({ body: { event: 'collection_share', code: 'abc' }, userAgent: 'SlaxReader/iOS 1.2.3' })
    expect(lastCall().userAgent).toBe('SlaxReader/iOS 1.2.3')
  })

  it('无 UA 时传 undefined，不传空串', async () => {
    await call({ body: { event: 'collection_share', code: 'abc' } })
    expect(lastCall().userAgent).toBeUndefined()
  })
})

describe('collection track endpoint · extra 组装', () => {
  it('collection_share 的 extra 为空对象（矩阵里它只有 collect_code/visitor_id/platform）', async () => {
    await call({ body: { event: 'collection_share', code: 'abc', is_curator: true, entry_page: 3 } })
    expect(lastCall().extra).toEqual({})
  })

  it('collection_visit 的 via 被写死 spa，客户端传 ssr 也覆盖不掉', async () => {
    await call({ body: { event: 'collection_visit', code: 'abc', via: 'ssr' } as never })
    expect(lastCall().extra.via).toBe('spa')
  })

  it('is_curator 只接受布尔值', async () => {
    await call({ body: { event: 'collection_visit', code: 'abc', is_curator: true } })
    expect(lastCall().extra.is_curator).toBe(true)
    await call({ body: { event: 'collection_visit', code: 'abc', is_curator: false } })
    expect(lastCall().extra.is_curator).toBe(false)
    await call({ body: { event: 'collection_visit', code: 'abc', is_curator: 'true' } as never })
    expect(lastCall().extra).not.toHaveProperty('is_curator')
  })

  it.each([
    ['1 → 保留', 1, 1],
    ['10000 上限内 → 保留', 10000, 10000],
    ['10001 越界 → 丢弃', 10001, undefined],
    ['0 → 丢弃', 0, undefined],
    ['负数 → 丢弃', -1, undefined],
    ['小数 → 丢弃', 1.5, undefined],
    ['字符串 → 丢弃', '2', undefined],
    ['NaN → 丢弃', Number.NaN, undefined],
    ['Infinity → 丢弃', Number.POSITIVE_INFINITY, undefined]
  ])('entry_page %s', async (_label, input, expected) => {
    await call({ body: { event: 'collection_visit', code: 'abc', entry_page: input } as never })
    expect(lastCall().extra.entry_page).toBe(expected)
  })

  it('未在白名单内的 extra 字段进不来（duration_ms / status_code / success / platform）', async () => {
    await call({
      body: { event: 'collection_visit', code: 'abc', duration_ms: 999, status_code: 200, success: true, platform: 'ios' } as never
    })
    const extra = lastCall().extra
    expect(Object.keys(extra).sort()).toEqual(['is_bot', 'via'])
  })

  // is_bot 服务端推导，防刷量脚本自报
  it('is_bot 服务端从 UA 推导，忽略客户端传值', async () => {
    await call({ body: { event: 'collection_visit', code: 'abc', is_bot: true } as never, userAgent: 'Mozilla/5.0 (Macintosh) Safari/605.1' })
    expect(lastCall().extra.is_bot).toBe(false)

    await call({ body: { event: 'collection_visit', code: 'abc', is_bot: false } as never, userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.0)' })
    expect(lastCall().extra.is_bot).toBe(true)
  })

  it('collection_share 不带 is_bot', async () => {
    await call({ body: { event: 'collection_share', code: 'abc' }, userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.0)' })
    expect(lastCall().extra).toEqual({})
  })
})
