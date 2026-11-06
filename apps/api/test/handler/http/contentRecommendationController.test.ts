import { beforeEach, describe, expect, test, vi } from 'vitest'

const events = vi.hoisted(() => ({ submitServerEvent: vi.fn(), submitServerEvents: vi.fn() }))
vi.mock('../../../src/domain/events', () => events)

import { ContentRecommendationController, parseRecommendationQuery } from '../../../src/handler/http/contentRecommendationController'
import { ContentRecommendationOrchestrator } from '../../../src/domain/orchestrator/contentRecommendation'
import type { ContentRecommendationService } from '../../../src/domain/contentRecommendation'
import { ContextManager } from '../../../src/utils/context'

const articles = vi.fn()
const collections = vi.fn()
const service = { articles, collections } as unknown as ContentRecommendationService
const controller = new ContentRecommendationController(new ContentRecommendationOrchestrator(service))
const request = (query = '') => new Request(`https://api.example.com/v1/recommendations/articles${query}`)
const IMPRESSION = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

function context(userId: number): ContextManager {
  const ctx = new ContextManager({} as ExecutionContext, {} as Env)
  ctx.setUserInfo(userId, 7, '', 'en')
  return ctx
}

function feedbackRequest(body: unknown, url = 'https://api.example.com/v1/recommendations/feedback') {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

const validFeedback = (overrides: Record<string, unknown> = {}) => ({
  impression_id: IMPRESSION,
  kind: 'article',
  events: [{ item_id: 'uuid-10', position: 0, action: 'click' }],
  ...overrides
})

beforeEach(() => {
  vi.resetAllMocks()
  articles.mockResolvedValue({ items: [], preferenceKind: 'article', reason: 'cold_start' })
  collections.mockResolvedValue({ items: [], preferenceKind: 'collection', reason: 'cold_start' })
})

describe('recommendation HTTP boundary', () => {
  test('defaults and accepts only explicit supported query values', () => {
    expect(parseRecommendationQuery(request(), 'article')).toEqual({ limit: 10, preferenceKind: 'article' })
    expect(parseRecommendationQuery(request('?limit=50&preference_kind=collection'), 'collection')).toEqual({ limit: 50, preferenceKind: 'collection' })
  })

  test.each(['?limit=0', '?limit=51', '?limit=1.5', '?limit=-1', '?limit=1e1', '?limit=', '?limit=1&limit=2', '?preference_kind=mixed', '?preference_kind=article&preference_kind=collection', '?userId=2'])
  ('rejects invalid query before invoking the ranking service: %s', async query => {
    expect(parseRecommendationQuery(request(query), 'article')).toBeNull()
    const response = await controller.articles(context(1), request(query))
    expect(((await response.json()) as { code: number }).code).toBeGreaterThanOrEqual(400)
    expect(articles).not.toHaveBeenCalled()
    expect(collections).not.toHaveBeenCalled()
    expect(events.submitServerEvent).not.toHaveBeenCalled()
  })

  test.each([['articles', 'collection'], ['collections', 'article']] as const)('rejects %s using the other preference kind', async (method, kind) => {
    const response = await controller[method](context(1), request(`?preference_kind=${kind}`))
    expect(((await response.json()) as { code: number }).code).toBeGreaterThanOrEqual(400)
    expect(articles).not.toHaveBeenCalled()
    expect(collections).not.toHaveBeenCalled()
  })

  test.each([0, -1, 1.5, NaN])('rejects missing or invalid request identity: %s', async userId => {
    const response = await controller.articles(context(userId), request())
    expect(((await response.json()) as { code: number }).code).toBeGreaterThanOrEqual(400)
    expect(articles).not.toHaveBeenCalled()
    expect(collections).not.toHaveBeenCalled()
    expect(events.submitServerEvent).not.toHaveBeenCalled()
  })

  test('uses only the authenticated identity and preserves private response caching', async () => {
    const response = await controller.articles(context(1), request('?limit=2&preference_kind=article'))
    expect(articles).toHaveBeenCalledExactlyOnceWith(1, 'article', 2)
    expect(collections).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ data: { items: [], reason: 'cold_start' } })
  })

  test('dispatches collection requests to the injected collection method', async () => {
    await controller.collections(context(1), request())
    expect(collections).toHaveBeenCalledExactlyOnceWith(1, 'collection', 10)
    expect(articles).not.toHaveBeenCalled()
  })
})

describe('recommendation served events through the orchestrator', () => {
  test('records the article list with impression id, algorithm and positions', async () => {
    articles.mockResolvedValue({
      items: [
        { id: 10, sourceUserId: 2, bookmarkUuid: 'uuid-10', title: 'title', url: 'https://example.com/10', collectionId: 20, score: 0.75 },
        { id: 11, sourceUserId: 3, bookmarkUuid: 'uuid-11', title: 'other', url: 'https://example.com/11', collectionId: 30, score: 0.5 }
      ],
      preferenceKind: 'article'
    })
    const response = await controller.articles(context(1), request())
    const body = (await response.json()) as { data: { impressionId: string; algorithm: string } }
    expect(body.data.impressionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(body.data.algorithm).toMatch(/^[0-9a-f]{12}$/)
    expect(events.submitServerEvent).toHaveBeenCalledOnce()
    expect(events.submitServerEvent.mock.calls[0][2]).toBe('recommendation_served')
    expect(events.submitServerEvent.mock.calls[0][3]).toEqual({
      impression_id: body.data.impressionId,
      kind: 'article',
      algorithm: body.data.algorithm,
      items: [
        { position: 0, item_id: 'uuid-10', score: 0.75 },
        { position: 1, item_id: 'uuid-11', score: 0.5 }
      ]
    })
  })

  test('records collection codes and empty results with their reason', async () => {
    collections.mockResolvedValue({
      items: [{ id: 20, code: 'c-20', name: 'Collection', description: '', score: 0.8, articles: [] }],
      preferenceKind: 'collection'
    })
    await controller.collections(context(1), request())
    expect(events.submitServerEvent.mock.calls[0][3]).toMatchObject({ kind: 'collection', items: [{ position: 0, item_id: 'c-20', score: 0.8 }] })
    vi.mocked(events.submitServerEvent).mockClear()
    articles.mockResolvedValue({ items: [], preferenceKind: 'article', reason: 'no_public_candidates' })
    await controller.articles(context(1), request())
    expect(events.submitServerEvent.mock.calls[0][3]).toMatchObject({ reason: 'no_public_candidates', items: [] })
  })
})

describe('Controller delegation with a stub orchestrator', () => {
  const stub = () => ({ recommend: vi.fn(), feedback: vi.fn() })
  const delegated = (orchestrator: ReturnType<typeof stub>) =>
    new ContentRecommendationController(orchestrator as unknown as ContentRecommendationOrchestrator)

  test('invalid auth, query and body never reach the orchestrator', async () => {
    const orchestrator = stub()
    const controller = delegated(orchestrator)
    for (const userId of [0, -1, 1.5, NaN]) await controller.articles(context(userId), request())
    for (const query of ['?limit=0', '?limit=51', '?limit=1.5', '?preference_kind=mixed', '?userId=2']) await controller.articles(context(1), request(query))
    await controller.feedback(context(0), feedbackRequest(validFeedback()))
    for (const body of ['{', JSON.stringify({ ...validFeedback(), extra: 1 }), JSON.stringify(validFeedback({ events: [] }))])
      await controller.feedback(context(1), feedbackRequest(body))
    expect(orchestrator.recommend).not.toHaveBeenCalled()
    expect(orchestrator.feedback).not.toHaveBeenCalled()
    expect(events.submitServerEvent).not.toHaveBeenCalled()
    expect(events.submitServerEvents).not.toHaveBeenCalled()
  })

  test('validated inputs are delegated exactly once with the authenticated identity', async () => {
    const orchestrator = stub()
    orchestrator.recommend.mockResolvedValue({ items: [], preferenceKind: 'article', impressionId: 'imp', algorithm: 'alg' })
    orchestrator.feedback.mockReturnValue({ received: 1 })
    const controller = delegated(orchestrator)
    const ctx = context(1)
    const articleRequest = request('?limit=2&preference_kind=article')
    const response = await controller.articles(ctx, articleRequest)
    expect(orchestrator.recommend).toHaveBeenCalledExactlyOnceWith(ctx, articleRequest, 'article', { limit: 2, preferenceKind: 'article' })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ data: { impressionId: 'imp', algorithm: 'alg' } })

    const collectionRequest = request('?limit=3&preference_kind=collection')
    await controller.collections(ctx, collectionRequest)
    expect(orchestrator.recommend).toHaveBeenLastCalledWith(ctx, collectionRequest, 'collection', { limit: 3, preferenceKind: 'collection' })

    const feedbackBody = validFeedback()
    const feedbackHttpRequest = feedbackRequest(feedbackBody)
    const feedbackResponse = await controller.feedback(ctx, feedbackHttpRequest)
    expect(orchestrator.feedback).toHaveBeenCalledExactlyOnceWith(ctx, feedbackHttpRequest, {
      impression_id: IMPRESSION,
      kind: 'article',
      events: [{ item_id: 'uuid-10', position: 0, action: 'click' }]
    })
    expect(await feedbackResponse.json()).toMatchObject({ data: { received: 1 } })
  })
})

describe('recommendation feedback boundary', () => {
  test('sends exactly one batch for a valid body', async () => {
    const body = validFeedback({
      events: [
        { item_id: 'uuid-10', position: 0, action: 'impression' },
        { item_id: 'uuid-10', position: 0, action: 'click', occurred_at: '2026-11-05T12:00:00Z' },
        { item_id: 'uuid-11', position: 1, action: 'dismiss' }
      ]
    })
    const response = await controller.feedback(context(1), feedbackRequest(body))
    expect(((await response.json()) as { data: { received: number } }).data.received).toBe(3)
    expect(events.submitServerEvents).toHaveBeenCalledOnce()
    const batch = events.submitServerEvents.mock.calls[0][2] as Array<{ eventName: string; properties: Record<string, unknown>; options?: { occurredAt?: string } }>
    expect(batch).toHaveLength(3)
    expect(batch.map(entry => entry.eventName)).toEqual(['recommendation_feedback', 'recommendation_feedback', 'recommendation_feedback'])
    expect(batch[1].properties).toEqual({ impression_id: IMPRESSION, kind: 'article', item_id: 'uuid-10', position: 0, action: 'click' })
    expect(batch[1].options).toEqual({ occurredAt: '2026-11-05T12:00:00.000Z' })
    expect(events.submitServerEvent).not.toHaveBeenCalled()
  })

  test('accepts a fifty-event batch in one call', async () => {
    const body = validFeedback({
      kind: 'collection',
      events: Array.from({ length: 50 }, (_, index) => ({ item_id: `c-${index}`, position: index, action: 'click' }))
    })
    const response = await controller.feedback(context(1), feedbackRequest(body))
    expect(((await response.json()) as { data: { received: number } }).data.received).toBe(50)
    expect(events.submitServerEvents).toHaveBeenCalledOnce()
    expect((events.submitServerEvents.mock.calls[0][2] as unknown[]).length).toBe(50)
  })

  test.each([
    ['unknown top-level key', { ...validFeedback(), extra: 1 }],
    ['non-v4 impression', validFeedback({ impression_id: '3f1c2d4e-5a6b-1c7d-8e9f-0a1b2c3d4e5f' })],
    ['zero events', validFeedback({ events: [] })],
    ['fifty-one events', validFeedback({ events: Array.from({ length: 51 }, (_, index) => ({ item_id: `u-${index}`, position: index, action: 'click' })) })],
    ['unknown action', validFeedback({ events: [{ item_id: 'uuid-10', position: 0, action: 'open' }] })],
    ['negative position', validFeedback({ events: [{ item_id: 'uuid-10', position: -1, action: 'click' }] })],
    ['fractional position', validFeedback({ events: [{ item_id: 'uuid-10', position: 1.5, action: 'click' }] })],
    ['impossible date', validFeedback({ events: [{ item_id: 'uuid-10', position: 0, action: 'click', occurred_at: '2026-02-30T00:00:00Z' }] })],
    ['invalid json', '{'],
    ['oversized body', JSON.stringify(validFeedback({ events: [{ item_id: 'x'.repeat(110 * 1024), position: 0, action: 'click' }] }))]
  ])('rejects %s whole and records nothing', async (_name, body) => {
    const response = await controller.feedback(context(1), feedbackRequest(body))
    expect(((await response.json()) as { code: number }).code).toBeGreaterThanOrEqual(400)
    expect(events.submitServerEvents).not.toHaveBeenCalled()
    expect(events.submitServerEvent).not.toHaveBeenCalled()
  })

  test('rejects feedback without an authenticated identity', async () => {
    const response = await controller.feedback(context(0), feedbackRequest(validFeedback()))
    expect(((await response.json()) as { code: number }).code).toBeGreaterThanOrEqual(400)
    expect(events.submitServerEvents).not.toHaveBeenCalled()
  })
})
