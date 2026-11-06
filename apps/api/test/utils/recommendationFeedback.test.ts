import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import * as algorithms from '../../src/utils/recommendationAlgorithms'
import { parseRecommendationFeedback, recommendationAlgorithm } from '../../src/utils/recommendationFeedback'
import { EMBEDDING_MEAN } from '../../src/utils/embeddingMean'

const IMPRESSION = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

const feedback = (overrides: Record<string, unknown> = {}) => ({
  impression_id: IMPRESSION,
  kind: 'article',
  events: [{ item_id: 'u-1', position: 0, action: 'impression' }],
  ...overrides
})

const digest = async (parameters: Record<string, unknown>) =>
  createHash('sha256')
    .update(JSON.stringify(parameters))
    .digest('hex')
    .slice(0, 12)

const parameterMap = () =>
  Object.fromEntries(
    Object.entries(algorithms)
      .filter(([key, value]) => /^[A-Z][A-Z0-9_]*$/.test(key) && ['number', 'string', 'boolean'].includes(typeof value))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  )

describe('recommendation algorithm identifier', () => {
  test('is stable, twelve hex characters and derived from every exported parameter', async () => {
    const first = await recommendationAlgorithm()
    const second = await recommendationAlgorithm()
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{12}$/)
    const parameters = parameterMap()
    expect(await digest(parameters)).toBe(first)
    expect(parameters.EMBEDDING_MEAN_VERSION).toBe(EMBEDDING_MEAN.version)
    for (const key of [
      'ZORRO_CANDIDATE_DECAY_PER_HOUR',
      'PINNERSAGE_WINDOW_DAYS',
      'PINNERSAGE_ALPHA',
      'PINNERSAGE_IMPORTANCE_DECAY_PER_DAY',
      'PINNERSAGE_SAMPLED_MEDOIDS',
      'PINNERSAGE_MAX_ACTIONS',
      'PINNERSAGE_MAX_STORED_CLUSTERS',
      'MMR_LAMBDA',
      'MMR_CANDIDATES',
      'NATIVE_TOP_K',
      'CHANNEL_LIMIT',
      'POPULAR_WINDOW_HOURS',
      'PREVIEW_MEMBERS',
      'EMBEDDING_MEAN_VERSION'
    ]) {
      expect(parameters).toHaveProperty(key)
    }
  })

  test('changes when any constant or the embedding mean version changes', async () => {
    const current = await recommendationAlgorithm()
    const parameters = parameterMap()
    for (const [key, value] of Object.entries(parameters)) {
      const changed = typeof value === 'number' ? value + 1 : typeof value === 'string' ? `${value}-changed` : !value
      expect(await digest({ ...parameters, [key]: changed })).not.toBe(current)
    }
    expect(await digest({ ...parameters, EMBEDDING_MEAN_VERSION: '000000000000' })).not.toBe(current)
    expect(algorithms.EMBEDDING_MEAN_VERSION).toBe(EMBEDDING_MEAN.version)
  })
})

describe('recommendation feedback parsing', () => {
  test('accepts a minimal body and every action', () => {
    expect(parseRecommendationFeedback(feedback())).toEqual({
      impression_id: IMPRESSION,
      kind: 'article',
      events: [{ item_id: 'u-1', position: 0, action: 'impression' }]
    })
    for (const action of ['impression', 'click', 'save', 'subscribe', 'dismiss']) {
      expect(parseRecommendationFeedback(feedback({ events: [{ item_id: 'u-1', position: 7, action }] }))?.events[0].action).toBe(action)
    }
    expect(parseRecommendationFeedback(feedback({ kind: 'collection' }))?.kind).toBe('collection')
  })

  test('normalizes occurred_at to ISO and keeps it optional', () => {
    expect(parseRecommendationFeedback(feedback())?.events[0]).not.toHaveProperty('occurred_at')
    expect(parseRecommendationFeedback(feedback({ events: [{ item_id: 'u-1', position: 0, action: 'click', occurred_at: '2026-11-05T12:00:00Z' }] }))?.events[0].occurred_at).toBe('2026-11-05T12:00:00.000Z')
    expect(parseRecommendationFeedback(feedback({ events: [{ item_id: 'u-1', position: 0, action: 'click', occurred_at: '2026-11-05T20:00:00+08:00' }] }))?.events[0].occurred_at).toBe('2026-11-05T12:00:00.000Z')
    expect(parseRecommendationFeedback(feedback({ events: [{ item_id: 'u-1', position: 0, action: 'click', occurred_at: Date.UTC(2026, 10, 5, 12) }] }))?.events[0].occurred_at).toBe('2026-11-05T12:00:00.000Z')
  })

  test('accepts positions 0 and 49 and a fifty-event body', () => {
    const events = Array.from({ length: 50 }, (_, index) => ({ item_id: `u-${index}`, position: index, action: 'impression' as const }))
    expect(parseRecommendationFeedback(feedback({ events }))?.events).toHaveLength(50)
    expect(parseRecommendationFeedback(feedback({ events: [{ item_id: 'u-1', position: 49, action: 'save' }] }))).not.toBeNull()
  })

  test.each([
    ['null', null],
    ['array', []],
    ['string', 'body'],
    ['unknown top-level key', { ...feedback(), extra: true }],
    ['missing impression', { kind: 'article', events: [] }],
    ['non-string impression', feedback({ impression_id: 7 })],
    ['v1 impression uuid', feedback({ impression_id: '3f1c2d4e-5a6b-1c7d-8e9f-0a1b2c3d4e5f' })],
    ['bad variant uuid', feedback({ impression_id: '3f1c2d4e-5a6b-4c7d-ce9f-0a1b2c3d4e5f' })],
    ['short uuid', feedback({ impression_id: '3f1c2d4e-5a6b-4c7d-8e9f' })],
    ['not a uuid', feedback({ impression_id: 'impression-1' })],
    ['missing kind', { impression_id: IMPRESSION, events: [{ item_id: 'u', position: 0, action: 'click' }] }],
    ['unknown kind', feedback({ kind: 'mixed' })],
    ['events not array', feedback({ events: {} })],
    ['zero events', feedback({ events: [] })],
    ['fifty-one events', feedback({ events: Array.from({ length: 51 }, (_, index) => ({ item_id: `u-${index}`, position: index, action: 'click' })) })],
    ['event unknown key', feedback({ events: [{ item_id: 'u', position: 0, action: 'click', extra: 1 }] })],
    ['missing item id', feedback({ events: [{ position: 0, action: 'click' }] })],
    ['empty item id', feedback({ events: [{ item_id: '   ', position: 0, action: 'click' }] })],
    ['non-string item id', feedback({ events: [{ item_id: 7, position: 0, action: 'click' }] })],
    ['missing position', feedback({ events: [{ item_id: 'u', action: 'click' }] })],
    ['negative position', feedback({ events: [{ item_id: 'u', position: -1, action: 'click' }] })],
    ['fractional position', feedback({ events: [{ item_id: 'u', position: 1.5, action: 'click' }] })],
    ['string position', feedback({ events: [{ item_id: 'u', position: '1', action: 'click' }] })],
    ['nan position', feedback({ events: [{ item_id: 'u', position: NaN, action: 'click' }] })],
    ['unknown action', feedback({ events: [{ item_id: 'u', position: 0, action: 'open' }] })],
    ['missing action', feedback({ events: [{ item_id: 'u', position: 0 }] })],
    ['non-string action', feedback({ events: [{ item_id: 'u', position: 0, action: 1 }] })],
    ['unparseable occurred_at', feedback({ events: [{ item_id: 'u', position: 0, action: 'click', occurred_at: 'not-a-date' }] })],
    ['date without zone', feedback({ events: [{ item_id: 'u', position: 0, action: 'click', occurred_at: '2026-11-05T12:00:00' }] })],
    ['date without time', feedback({ events: [{ item_id: 'u', position: 0, action: 'click', occurred_at: '2026-11-05' }] })],
    ['impossible calendar date', feedback({ events: [{ item_id: 'u', position: 0, action: 'click', occurred_at: '2026-02-30T00:00:00Z' }] })],
    ['impossible month', feedback({ events: [{ item_id: 'u', position: 0, action: 'click', occurred_at: '2026-13-01T00:00:00Z' }] })],
    ['boolean occurred_at', feedback({ events: [{ item_id: 'u', position: 0, action: 'click', occurred_at: true }] })],
    ['null occurred_at', feedback({ events: [{ item_id: 'u', position: 0, action: 'click', occurred_at: null }] })],
    ['nan occurred_at', feedback({ events: [{ item_id: 'u', position: 0, action: 'click', occurred_at: NaN }] })]
  ])('rejects %s', (_name, body) => {
    expect(parseRecommendationFeedback(body)).toBeNull()
  })
})
