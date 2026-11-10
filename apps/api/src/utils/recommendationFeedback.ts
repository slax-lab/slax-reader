import * as recommendationAlgorithms from './recommendationAlgorithms'
import type { PreferenceKind } from './vectorMaintenanceTypes'

const ACTIONS = ['impression', 'click', 'save', 'subscribe', 'dismiss'] as const

export interface RecommendationFeedback {
  impression_id: string
  kind: PreferenceKind
  events: { item_id: string; position: number; action: (typeof ACTIONS)[number]; occurred_at?: string }[]
}

let algorithm: Promise<string> | undefined

export function recommendationAlgorithm(): Promise<string> {
  algorithm ??= (async () => {
    const parameters = Object.entries(recommendationAlgorithms)
      .filter(([key, value]) => /^[A-Z][A-Z0-9_]*$/.test(key) && ['number', 'string', 'boolean'].includes(typeof value))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(Object.fromEntries(parameters))))
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 12)
  })()
  return algorithm
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function occurredAt(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  if (typeof value === 'string') {
    const day = value.slice(0, 10)
    const calendarDate = new Date(`${day}T00:00:00Z`)
    if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== day) return null
  }
  return date.toISOString()
}

export function parseRecommendationFeedback(body: unknown): RecommendationFeedback | null {
  if (!isRecord(body) || Object.keys(body).some(key => !['impression_id', 'kind', 'events'].includes(key))) return null
  if (typeof body.impression_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.impression_id)) return null
  if (body.kind !== 'article' && body.kind !== 'collection') return null
  if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 50) return null
  const events: RecommendationFeedback['events'] = []
  for (const event of body.events) {
    if (!isRecord(event) || Object.keys(event).some(key => !['item_id', 'position', 'action', 'occurred_at'].includes(key))) return null
    if (typeof event.item_id !== 'string' || !event.item_id.trim()) return null
    if (typeof event.position !== 'number' || !Number.isInteger(event.position) || event.position < 0) return null
    const action = ACTIONS.find(action => action === event.action)
    if (!action) return null
    const time = event.occurred_at === undefined ? undefined : occurredAt(event.occurred_at)
    if (time === null) return null
    events.push({ item_id: event.item_id, position: event.position, action, ...(time === undefined ? {} : { occurred_at: time }) })
  }
  return { impression_id: body.impression_id, kind: body.kind, events }
}
