import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handleImageProxy: vi.fn().mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/jpeg' } })),
  queue: vi.fn(),
  scheduled: vi.fn()
}))

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }))
vi.mock('@/handler/http/imageProxy', () => ({ handleImageProxy: mocks.handleImageProxy }))
vi.mock('@/di/generated/dependency', () => ({ initializeCore: vi.fn(), initializeInfrastructure: vi.fn() }))
vi.mock('@/entry/core', () => {
  const WorkerClass = class {}
  return {
    handleQueueEvent: mocks.queue,
    handleScheduledEvent: mocks.scheduled,
    SlaxJieba: WorkerClass,
    SlaxWebSocketServer: WorkerClass,
    SlaxMcpServer: WorkerClass,
    ScreenshotBrowser: WorkerClass
  }
})
// edge/index.ts 静态 re-export 这些 Workflow（extends WorkflowEntrypoint），测试里 mock 掉避免加载真实实现
vi.mock('@/entry/edge/workflows/crawlWorkflow', () => ({ CrawlWorkflow: class {} }))
vi.mock('@/entry/edge/workflows/contentValidationWorkflow', () => ({ ContentValidationWorkflow: class {} }))
vi.mock('@/entry/edge/workflows/importParseWorkflow', () => ({ ImportParseWorkflow: class {} }))
vi.mock('@/entry/edge/workflows/youtubeArticleWorkflow', () => ({ YoutubeArticleWorkflow: class {} }))
vi.mock('@/entry/edge/workflows/podcastWorkflow', () => ({ PodcastWorkflow: class {} }))
vi.mock('@/entry/edge/workflows/vectorMaintenanceWorkflow', () => ({ VectorMaintenanceWorkflow: class {} }))

import edge from '@/entry/edge'
import { Auth } from '@/utils/jwt'
import { auth } from '@/middleware/auth'
import { ContextManager } from '@/utils/context'
import { Hashid } from '@/utils/hashids'
import { EDGE_SECRET_HEADER, EDGE_IDENTITY_HEADER } from '@/const/edge'

describe('edge routing', () => {
  test('forwards Reader identity verified by Core and strips the external bearer', async () => {
    const env = {
      JWT_SECRET_TEXT: 'test-secret-32-bytes-minimum-long-string',
      JWT_ALGORITHMS: 'HS256',
      JWT_ISSUER: 'test',
      JWT_EXPIRES: '3600',
      HASH_IDS_SALT: 'test',
      EDGE_SHARED_SECRET: 'shared'
    } as unknown as Env
    const downstream = new ContextManager({} as ExecutionContext, env)
    const coreFetch = vi.fn(async (request: Request) => {
      await auth(request, downstream, {
        resolve: () => ({ $queryRaw: async () => [{ id: 1 }] })
      } as never)
      return new Response('authenticated')
    })
    env.CORE = { fetch: coreFetch } as never
    const token = await new Auth(env).sign({ id: String(new Hashid(env).encodeId(1)), email: 'user@example.com', lang: 'en' })
    const response = await edge.fetch(
      new Request('https://api-reader.slax.com/v1/user/me', { headers: { Authorization: `Bearer ${token}`, Host: 'untrusted.example', [EDGE_IDENTITY_HEADER]: 'forged' } }),
      env,
      {} as ExecutionContext
    )
    expect(await response.text()).toBe('authenticated')
    expect(downstream.getUserId()).toBe(1)
    const forwarded = coreFetch.mock.calls[0][0]
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.get(EDGE_SECRET_HEADER)).toBe('shared')
  })

  test('cannot bypass rate limiting with external trusted-edge headers', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false })
    const coreFetch = vi.fn()
    const env = {
      JWT_SECRET_TEXT: 'test-secret-32-bytes-minimum-long-string',
      JWT_ALGORITHMS: 'HS256',
      JWT_ISSUER: 'test',
      JWT_EXPIRES: '3600',
      HASH_IDS_SALT: 'test',
      EDGE_SHARED_SECRET: 'shared',
      BOOKMARK_ADD_RATE_LIMITER: { limit },
      CORE: { fetch: coreFetch }
    } as unknown as Env
    const token = await new Auth(env).sign({ id: String(new Hashid(env).encodeId(1)), email: 'user@example.com', lang: 'en' })
    const request = new Request('https://api-reader.slax.com/v1/bookmark/add', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, [EDGE_SECRET_HEADER]: 'shared', [EDGE_IDENTITY_HEADER]: 'forged' }
    })
    const response = await edge.fetch(request, env, {} as ExecutionContext)
    expect(response.status).toBe(429)
    expect(limit).toHaveBeenCalledWith({ key: 'uid:1' })
    expect(coreFetch).not.toHaveBeenCalled()
  })

  test('serves image proxy routes locally without invoking core', async () => {
    const coreFetch = vi.fn()
    const request = new Request('https://api-reader.slax.com/static/image?u=image&d=digest')
    const response = await edge.fetch(request, { CORE: { fetch: coreFetch } } as unknown as Env, {} as ExecutionContext)

    expect(mocks.handleImageProxy).toHaveBeenCalledOnce()
    expect(coreFetch).not.toHaveBeenCalled()
    expect(await response.text()).toBe('image')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=2592000, immutable')
  })

  test('handles queue events in the edge worker', async () => {
    const batch = { queue: 'test', messages: [] } as unknown as MessageBatch
    const env = {} as Env
    const ctx = {} as ExecutionContext

    await edge.queue(batch, env, ctx)

    expect(mocks.queue).toHaveBeenCalledWith(batch, env, ctx)
  })

  test('handles scheduled events in the edge worker', async () => {
    const event = { cron: '*/5 * * * *' } as unknown as Event
    const env = {} as Env
    const ctx = {} as ExecutionContext

    await edge.scheduled(event, env, ctx)

    expect(mocks.scheduled).toHaveBeenCalledWith(event, env, ctx)
  })

  test.each(['/v1/aigc/summaries', '/v1/aigc/chat', '/v1/bookmark/overview', '/v1/bookmark/outline', '/v1/bookmark/search'])(
    'routes %s requests to the AI worker',
    async pathname => {
      const aiFetch = vi.fn().mockResolvedValue(new Response('ai'))
      const coreFetch = vi.fn()
      const request = new Request(`https://api-reader.slax.com${pathname}`, {
        method: 'POST',
        headers: { 'X-API-Key': 'test' }
      })

      const response = await edge.fetch(request, { AIGC: { fetch: aiFetch }, CORE: { fetch: coreFetch } } as unknown as Env, {} as ExecutionContext)

      expect(aiFetch).toHaveBeenCalledOnce()
      expect(coreFetch).not.toHaveBeenCalled()
      expect(await response.text()).toBe('ai')
    }
  )

  test('routes non-AI requests to the core worker', async () => {
    const aiFetch = vi.fn()
    const coreFetch = vi.fn().mockResolvedValue(new Response('core'))
    const request = new Request('https://api-reader.slax.com/v1/bookmark/list', {
      headers: { 'X-API-Key': 'test' }
    })

    const response = await edge.fetch(request, { AIGC: { fetch: aiFetch }, CORE: { fetch: coreFetch } } as unknown as Env, {} as ExecutionContext)

    expect(coreFetch).toHaveBeenCalledOnce()
    expect(aiFetch).not.toHaveBeenCalled()
    expect(await response.text()).toBe('core')
  })

  describe('task refresh forwarding', () => {
    const SECRET = 'temporary-task-secret-edge'
    const tasks = [
      ['/v1/bookmark/vector/refresh', { user_id: 7, bookmark_id: 12 }],
      ['/v1/bookmark/preference/refresh', { user_id: 7 }],
      ['/v1/collection/vector/refresh', { collection_id: 30 }],
      ['/v1/collection/preference/refresh', { user_id: 7 }]
    ] as const

    const buildEnv = (coreFetch: (request: Request) => Promise<Response>) =>
      ({
        JWT_SECRET_TEXT: 'test-secret-32-bytes-minimum-long-string',
        JWT_ALGORITHMS: 'HS256',
        JWT_ISSUER: 'test',
        JWT_EXPIRES: '3600',
        HASH_IDS_SALT: 'test',
        EDGE_SHARED_SECRET: 'shared',
        CORE: { fetch: coreFetch } as never
      }) as unknown as Env

    const requestFor = (pathname: string, body: unknown, headers: Record<string, string>) =>
      new Request(`https://api-reader.slax.com${pathname}`, { method: 'POST', headers, body: JSON.stringify(body) })

    test.each(tasks)('%s forwards the custom header anonymously without a user identity', async (pathname, body) => {
      const coreFetch = vi.fn().mockResolvedValue(Response.json({ code: 200, data: { state: 'written' } }))
      const response = await edge.fetch(requestFor(pathname, body, { 'X-Vector-Refresh-Secret': SECRET }), buildEnv(coreFetch), {} as ExecutionContext)
      expect(response.status).toBe(200)
      expect(coreFetch).toHaveBeenCalledOnce()
      const forwarded = coreFetch.mock.calls[0][0] as Request
      expect(forwarded.headers.get('X-Vector-Refresh-Secret')).toBe(SECRET)
      expect(forwarded.headers.has('Authorization')).toBe(false)
      expect(forwarded.headers.has(EDGE_IDENTITY_HEADER)).toBe(false)
      expect(await forwarded.json()).toEqual(body)
    })

    test.each(tasks)('%s is not gated at Edge: any or missing header is forwarded to Core', async (pathname, body) => {
      for (const header of [undefined, '', 'wrong-task-secret']) {
        const coreFetch = vi.fn().mockResolvedValue(Response.json({ code: 200, data: { state: 'written' } }))
        const headers = header === undefined ? {} : { 'X-Vector-Refresh-Secret': header }
        const response = await edge.fetch(requestFor(pathname, body, headers), buildEnv(coreFetch), {} as ExecutionContext)
        expect(response.status).toBe(200)
        expect(coreFetch).toHaveBeenCalledOnce()
        expect((coreFetch.mock.calls[0][0] as Request).headers.get('X-Vector-Refresh-Secret')).toBe(header ?? null)
      }
    })

    test('a valid Reader JWT is forwarded in user mode and keeps the custom header', async () => {
      const coreFetch = vi.fn().mockResolvedValue(Response.json({ code: 200, data: { state: 'written' } }))
      const env = buildEnv(coreFetch)
      const token = await new Auth(env).sign({ id: String(new Hashid(env).encodeId(7)), email: 'reader@example.com', lang: 'en' })
      const response = await edge.fetch(
        requestFor(tasks[0][0], tasks[0][1], { Authorization: `Bearer ${token}`, 'X-Vector-Refresh-Secret': SECRET }),
        env,
        {} as ExecutionContext
      )
      expect(response.status).toBe(200)
      const forwarded = coreFetch.mock.calls[0][0] as Request
      expect(forwarded.headers.has('Authorization')).toBe(false)
      expect(forwarded.headers.has(EDGE_IDENTITY_HEADER)).toBe(true)
      expect(forwarded.headers.get('X-Vector-Refresh-Secret')).toBe(SECRET)
    })

    test('a trailing-slash task path stays whitelisted and forwards the header', async () => {
      const coreFetch = vi.fn().mockResolvedValue(Response.json({ code: 400, data: 'ERROR_PARAM' }))
      const response = await edge.fetch(
        requestFor(`${tasks[0][0]}/`, tasks[0][1], { 'X-Vector-Refresh-Secret': SECRET }),
        buildEnv(coreFetch),
        {} as ExecutionContext
      )
      expect(response.status).toBe(200)
      expect(coreFetch).toHaveBeenCalledOnce()
      expect((coreFetch.mock.calls[0][0] as Request).headers.get('X-Vector-Refresh-Secret')).toBe(SECRET)
    })

    test('an API key is forwarded as apikey with the header retained', async () => {
      const coreFetch = vi.fn().mockResolvedValue(Response.json({ code: 403 }))
      const response = await edge.fetch(
        requestFor(tasks[0][0], tasks[0][1], { 'X-API-Key': 'reader-api-key', 'X-Vector-Refresh-Secret': SECRET }),
        buildEnv(coreFetch),
        {} as ExecutionContext
      )
      expect(response.status).toBe(200)
      expect(coreFetch).toHaveBeenCalledOnce()
      const forwarded = coreFetch.mock.calls[0][0] as Request
      expect(forwarded.headers.get('X-API-Key')).toBe('reader-api-key')
      expect(forwarded.headers.get('X-Vector-Refresh-Secret')).toBe(SECRET)
    })

    test('the custom header does not make an unrelated route anonymous', async () => {
      const coreFetch = vi.fn()
      const response = await edge.fetch(
        new Request('https://api-reader.slax.com/v1/bookmark/list', { headers: { 'X-Vector-Refresh-Secret': SECRET } }),
        buildEnv(coreFetch),
        {} as ExecutionContext
      )
      expect(response.status).toBe(401)
      expect(coreFetch).not.toHaveBeenCalled()
    })
  })

  test('propagates the Cloudflare ray id to core', async () => {
    const coreFetch = vi.fn().mockResolvedValue(new Response('core'))
    const request = new Request('https://api-reader.slax.com/v1/bookmark/list', {
      headers: {
        'CF-Ray': 'a2c792e19ce1fd0b-SIN',
        'X-API-Key': 'test',
        'X-Slax-Ray-Id': 'client-value'
      }
    })

    const response = await edge.fetch(request, { CORE: { fetch: coreFetch } } as unknown as Env, {} as ExecutionContext)
    const forwarded = coreFetch.mock.calls[0][0] as Request

    expect(forwarded.headers.get('X-Slax-Ray-Id')).toBe('a2c792e19ce1fd0b-SIN')
    expect(await response.text()).toBe('core')
  })
})
