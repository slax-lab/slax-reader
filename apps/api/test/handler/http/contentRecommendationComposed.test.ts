import { describe, expect, test, vi } from 'vitest'
import { ContentRecommendationController } from '../../../src/handler/http/contentRecommendationController'
import { ContentRecommendationOrchestrator } from '../../../src/domain/orchestrator/contentRecommendation'
import type { ContentRecommendationService } from '../../../src/domain/contentRecommendation'
import { ContextManager } from '../../../src/utils/context'

const IMPRESSION = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

function harness(send = vi.fn(async () => undefined)) {
  const records: Array<Record<string, any>> = []
  const pending: Promise<unknown>[] = []
  const stream = {
    send: vi.fn(async (batch: Array<Record<string, any>>) => {
      records.push(...batch)
      return send(batch)
    })
  }
  const execution = {
    waitUntil: (work: Promise<unknown>) => {
      pending.push(work)
    }
  }
  const ctx = new ContextManager(execution as unknown as ExecutionContext, { SLAX_READER_STREAM_STREAM: stream } as unknown as Env)
  ctx.setUserInfo(1, 7, '', 'en')
  return { ctx, records, pending, stream }
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://api.example.com/v1/recommendations${path}`, {
    ...init,
    headers: {
      'x-device-id': 'device-7',
      'x-client-locale': 'zh',
      'x-client-version': '2.0.11',
      'user-agent': 'test-browser',
      ...(init.headers as Record<string, string> | undefined)
    }
  })
}

describe('composed recommendation request, orchestrator and event helpers', () => {
  test('a requested article list becomes one background served record with the unchanged envelope', async () => {
    const articles = vi.fn().mockResolvedValue({
      items: [
        { id: 10, sourceUserId: 2, bookmarkUuid: 'uuid-10', title: 'title', url: 'https://example.com/10', collectionId: 20, score: 0.75 },
        { id: 11, sourceUserId: 3, bookmarkUuid: 'uuid-11', title: 'other', url: 'https://example.com/11', collectionId: 30, score: 0.5 }
      ],
      preferenceKind: 'article'
    })
    const orchestrator = new ContentRecommendationOrchestrator({ articles, collections: vi.fn() } as unknown as ContentRecommendationService)
    const controller = new ContentRecommendationController(orchestrator)
    const { ctx, records, pending, stream } = harness()

    const response = await controller.articles(ctx, request('/articles?limit=2'))
    const body = (await response.json()) as { data: { impressionId: string; algorithm: string; items: Array<{ bookmarkUuid: string }> } }
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(body.data.items.map(item => item.bookmarkUuid)).toEqual(['uuid-10', 'uuid-11'])
    await Promise.all(pending)

    expect(stream.send).toHaveBeenCalledOnce()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      event_name: 'recommendation_served',
      user_id: 1,
      device_id: 'device-7',
      properties: {
        impression_id: body.data.impressionId,
        kind: 'article',
        algorithm: body.data.algorithm,
        platform: 'web',
        locale: 'zh',
        client_version: '2.0.11',
        items: [
          { position: 0, item_id: 'uuid-10', score: 0.75 },
          { position: 1, item_id: 'uuid-11', score: 0.5 }
        ]
      }
    })
    expect(records[0].occurred_at).toEqual(expect.any(String))
    expect(records[0].received_at).toEqual(expect.any(String))
  })

  test('a valid feedback body becomes one background batch joined to the same impression envelope', async () => {
    const collections = vi.fn()
    const orchestrator = new ContentRecommendationOrchestrator({ articles: vi.fn(), collections } as unknown as ContentRecommendationService)
    const controller = new ContentRecommendationController(orchestrator)
    const { ctx, records, pending, stream } = harness()

    const response = await controller.feedback(
      ctx,
      request('/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          impression_id: IMPRESSION,
          kind: 'article',
          events: [
            { item_id: 'uuid-10', position: 0, action: 'impression' },
            { item_id: 'uuid-10', position: 0, action: 'click', occurred_at: '2026-11-05T12:00:00Z' }
          ]
        })
      })
    )
    expect(await response.json()).toMatchObject({ data: { received: 2 } })
    await Promise.all(pending)

    expect(stream.send).toHaveBeenCalledOnce()
    expect(records).toHaveLength(2)
    expect(records.map(record => record.event_name)).toEqual(['recommendation_feedback', 'recommendation_feedback'])
    expect(records.every(record => record.properties.impression_id === IMPRESSION && record.properties.kind === 'article')).toBe(true)
    expect(records[1].occurred_at).toBe('2026-11-05T12:00:00.000Z')
    expect(collections).not.toHaveBeenCalled()
  })

  test('a rejected background stream is logged without failing the HTTP response', async () => {
    const articles = vi.fn().mockResolvedValue({ items: [], preferenceKind: 'article', reason: 'cold_start' })
    const orchestrator = new ContentRecommendationOrchestrator({ articles, collections: vi.fn() } as unknown as ContentRecommendationService)
    const controller = new ContentRecommendationController(orchestrator)
    const failure = new Error('stream unavailable')
    const { ctx, pending, stream } = harness(vi.fn(async () => Promise.reject(failure)))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await controller.articles(ctx, request('/articles'))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ data: { items: [], reason: 'cold_start' } })
      await Promise.all(pending)
      expect(stream.send).toHaveBeenCalledOnce()
      expect(log).toHaveBeenCalledWith('[events] failed to submit recommendation_served:', failure)
    } finally {
      log.mockRestore()
    }
  })
})
