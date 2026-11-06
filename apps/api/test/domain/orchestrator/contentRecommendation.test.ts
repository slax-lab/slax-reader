import { beforeEach, describe, expect, test, vi } from 'vitest'

const events = vi.hoisted(() => ({ submitServerEvent: vi.fn(), submitServerEvents: vi.fn() }))
vi.mock('../../../src/domain/events', () => events)

import { ContentRecommendationOrchestrator } from '../../../src/domain/orchestrator/contentRecommendation'
import type { ContentRecommendationService } from '../../../src/domain/contentRecommendation'
import type { ContextManager } from '../../../src/utils/context'

const articles = vi.fn()
const collections = vi.fn()
const service = { articles, collections } as unknown as ContentRecommendationService
const orchestrator = new ContentRecommendationOrchestrator(service)
const ctx = { getUserId: () => 7 } as unknown as ContextManager
const request = new Request('https://api.example.com/v1/recommendations/articles')
const IMPRESSION = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

beforeEach(() => {
  vi.resetAllMocks()
  articles.mockResolvedValue({ items: [], preferenceKind: 'article', reason: 'cold_start' })
  collections.mockResolvedValue({ items: [], preferenceKind: 'collection', reason: 'cold_start' })
})

describe('ContentRecommendationOrchestrator', () => {
  test('delegates article ranking with the parsed limit and records the served article list', async () => {
    articles.mockResolvedValue({
      items: [
        { id: 10, sourceUserId: 2, bookmarkUuid: 'uuid-10', title: 'title', url: 'https://example.com/10', collectionId: 20, score: 0.75 },
        { id: 11, sourceUserId: 3, bookmarkUuid: 'uuid-11', title: 'other', url: 'https://example.com/11', collectionId: 30, score: 0.5 }
      ],
      preferenceKind: 'article'
    })
    const result = await orchestrator.recommend(ctx, request, 'article', { limit: 2, preferenceKind: 'article' })
    expect(articles).toHaveBeenCalledExactlyOnceWith(7, 'article', 2)
    expect(collections).not.toHaveBeenCalled()
    expect(result.impressionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(result.algorithm).toMatch(/^[0-9a-f]{12}$/)
    expect(events.submitServerEvent).toHaveBeenCalledOnce()
    expect(events.submitServerEvent.mock.calls[0][2]).toBe('recommendation_served')
    expect(events.submitServerEvent.mock.calls[0][3]).toEqual({
      impression_id: result.impressionId,
      kind: 'article',
      algorithm: result.algorithm,
      items: [
        { position: 0, item_id: 'uuid-10', score: 0.75 },
        { position: 1, item_id: 'uuid-11', score: 0.5 }
      ]
    })
  })

  test('maps Collection codes and records empty results with their reason', async () => {
    collections.mockResolvedValue({
      items: [{ id: 20, code: 'c-20', name: 'Collection', description: '', score: 0.8, articles: [] }],
      preferenceKind: 'collection'
    })
    const result = await orchestrator.recommend(ctx, request, 'collection', { limit: 10, preferenceKind: 'collection' })
    expect(collections).toHaveBeenCalledExactlyOnceWith(7, 'collection', 10)
    expect(result.items).toHaveLength(1)
    expect(events.submitServerEvent.mock.calls[0][3]).toMatchObject({ kind: 'collection', items: [{ position: 0, item_id: 'c-20', score: 0.8 }] })

    events.submitServerEvent.mockClear()
    articles.mockResolvedValue({ items: [], preferenceKind: 'article', reason: 'no_public_candidates' })
    await orchestrator.recommend(ctx, request, 'article', { limit: 10, preferenceKind: 'article' })
    expect(events.submitServerEvent.mock.calls[0][3]).toMatchObject({ reason: 'no_public_candidates', items: [] })
  })

  test('records exactly one feedback batch and keeps occurred_at and received count', async () => {
    const feedback = {
      impression_id: IMPRESSION,
      kind: 'article' as const,
      events: [
        { item_id: 'uuid-10', position: 0, action: 'impression' as const },
        { item_id: 'uuid-10', position: 0, action: 'click' as const, occurred_at: '2026-11-05T12:00:00.000Z' }
      ]
    }
    expect(orchestrator.feedback(ctx, request, feedback)).toEqual({ received: 2 })
    expect(events.submitServerEvents).toHaveBeenCalledOnce()
    const batch = events.submitServerEvents.mock.calls[0][2] as Array<{ eventName: string; properties: Record<string, unknown>; options?: { occurredAt?: string } }>
    expect(batch).toHaveLength(2)
    expect(batch.map(entry => entry.eventName)).toEqual(['recommendation_feedback', 'recommendation_feedback'])
    expect(batch[1].properties).toEqual({ impression_id: IMPRESSION, kind: 'article', item_id: 'uuid-10', position: 0, action: 'click' })
    expect(batch[1].options).toEqual({ occurredAt: '2026-11-05T12:00:00.000Z' })
    expect(events.submitServerEvent).not.toHaveBeenCalled()
  })
})
