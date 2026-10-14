import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handleImageProxy: vi.fn().mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/jpeg' } })),
  queue: vi.fn(),
  scheduled: vi.fn()
}))

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }))
vi.mock('@/handler/http/imageProxy', () => ({ handleImageProxy: mocks.handleImageProxy }))
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
