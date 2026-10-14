/**
 * /v1/youtube_article routes: parameter checks, response shape and cache headers. Read routes are
 * on the anonymous whitelist, write routes are not.
 * 来源: src/handler/http/youtubeArticleController.ts, src/middleware/auth.ts
 */
import { describe, expect, test, vi } from 'vitest'
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
    expect(resp.headers.get('Cache-Control')).toBe('private, max-age=300')
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
