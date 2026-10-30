/**
 * /v1/youtube_article routes: parameter checks, response shape and cache headers. Read routes are
 * on the anonymous whitelist, write routes are not.
 * 来源: src/handler/http/youtubeArticleController.ts, src/middleware/auth.ts
 */
import { describe, expect, test, vi } from 'vitest'
import { PodcastController } from '@/handler/http/podcastController'
import { Successed, Render } from '@/utils/responseUtils'
import { YoutubeArticleController } from '@/handler/http/youtubeArticleController'
import { isWhitelisted } from '@/middleware/auth'
import { createMockCtx } from '@test/helpers/mockFactory'

function wire() {
  const service = {
    getStatus: vi.fn().mockResolvedValue({ status: 'ready' }),
    getContent: vi.fn().mockResolvedValue({ version: 'v', language: 'en', format: 'article', lede: '', sections: [] }),
    request: vi.fn().mockResolvedValue({ status: 'pending' })
  }
  return { ctrl: new YoutubeArticleController(service as any), service }
}

const get = (path: string) => new Request(`http://x${path}`)
const post = (path: string, body: unknown) => new Request(`http://x${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('YoutubeArticleController', () => {
  test('status: needs bookmark_uid; no-store', async () => {
    const { ctrl, service } = wire()
    expect((await ctrl.handleStatus(createMockCtx(), get('/v1/youtube_article/status'))).status).toBe(400)
    const resp = await ctrl.handleStatus(createMockCtx(), get('/v1/youtube_article/status?bookmark_uid=u1'))
    expect(resp.status).toBe(200)
    expect(resp.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await resp.json()).data).toEqual({ status: 'ready' })
    expect(service.getStatus).toHaveBeenCalledWith(expect.anything(), 'u1')
  })

  test('content: needs bookmark_uid and version; short private cache', async () => {
    const { ctrl, service } = wire()
    expect((await ctrl.handleContent(createMockCtx(), get('/v1/youtube_article/content?bookmark_uid=u1'))).status).toBe(400)
    const resp = await ctrl.handleContent(createMockCtx(), get('/v1/youtube_article/content?bookmark_uid=u1&version=abc-en-1-v1'))
    expect(resp.headers.get('Cache-Control')).toBe('private, no-store')
    expect(service.getContent).toHaveBeenCalledWith(expect.anything(), 'u1', 'abc-en-1-v1')
  })

  test('generate and retry pass the mode through', async () => {
    const { ctrl, service } = wire()
    expect((await ctrl.handleGenerate(createMockCtx(), post('/v1/youtube_article/generate', {}))).status).toBe(400)
    await ctrl.handleGenerate(createMockCtx(), post('/v1/youtube_article/generate', { bookmark_uid: 'u1' }))
    await ctrl.handleRetry(createMockCtx(), post('/v1/youtube_article/retry', { bookmark_uid: 'u1' }))
    expect(service.request.mock.calls.map(c => c.slice(1))).toEqual([
      ['u1', 'generate'],
      ['u1', 'retry']
    ])
  })

  test('read routes are open to share visitors; write routes need a login', () => {
    expect(isWhitelisted('/v1/youtube_article/status')).toBe(true)
    expect(isWhitelisted('/v1/youtube_article/content')).toBe(true)
    expect(isWhitelisted('/v1/youtube_article/generate')).toBe(false)
    expect(isWhitelisted('/v1/youtube_article/retry')).toBe(false)
  })
})

describe('media response headers', () => {
  test.each(['status', 'content', 'generate', 'retry'])('YouTube %s retains JSON, CORS, and no-store', async mode => {
    const { ctrl } = wire()
    const ctx = createMockCtx()
    const response =
      mode === 'status'
        ? await ctrl.handleStatus(ctx, get('/?bookmark_uid=u1'))
        : mode === 'content'
          ? await ctrl.handleContent(ctx, get('/?bookmark_uid=u1&version=v'))
          : mode === 'generate'
            ? await ctrl.handleGenerate(ctx, post('/', { bookmark_uid: 'u1' }))
            : await ctrl.handleRetry(ctx, post('/', { bookmark_uid: 'u1' }))
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  test.each(['status', 'translation', 'retry'])('podcast %s retains JSON, CORS, and no-store', async mode => {
    const service = { getStatus: vi.fn(), getTranslation: vi.fn(), retry: vi.fn() }
    const ctrl = new PodcastController(service as any)
    const ctx = createMockCtx()
    const response =
      mode === 'status'
        ? await ctrl.handleStatus(ctx, get('/?bookmark_uid=u1'))
        : mode === 'translation'
          ? await ctrl.handleTranslation(ctx, get('/?bookmark_uid=u1&version=v'))
          : await ctrl.handleRetry(ctx, post('/', { bookmark_uid: 'u1' }))
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  test('custom headers override defaults without case-sensitive duplicates', () => {
    const response = Successed({}, 200, 'ok', { 'content-type': 'application/problem+json', 'access-control-allow-origin': 'https://r.slax.com' })
    expect(response.headers.get('Content-Type')).toBe('application/problem+json')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://r.slax.com')
    expect(Render('<p>body</p>', 200, { 'Cache-Control': 'no-store' }).headers.get('Content-Type')).toBe('text/html')
  })
})
