import { isValid, parseISO } from 'date-fns'
import { parseHTML } from 'linkedom'

// Article publish times arrive as ISO 8601 strings or as free-form dates (RFC 2822, "March 5, 2024").
// ISO 8601 is parsed first, including compact forms such as 20240305, then the platform parser.
export function parsePublishedTime(value: string): Date | undefined {
  const text = value.trim()
  const iso = parseISO(text)
  if (isValid(iso)) return iso
  const native = new Date(text)
  return isValid(native) ? native : undefined
}

export function isPublisherUser(env: Pick<Env, 'PUBLISHER_USER_IDS'>, userId: number): boolean {
  return !!env.PUBLISHER_USER_IDS?.split(',').some(id => id.trim() === String(userId))
}

// A publisher-supplied original time must name its zone, so the same value means the same
// instant on every Worker, and must not be later than the save itself.
const ZONED = /(?:Z|[+-]\d{2}:?\d{2})$/i

export function publisherPublishedTime(value: unknown, now = new Date()): Date | undefined {
  if (typeof value !== 'string' || !ZONED.test(value.trim())) return undefined
  const parsed = parsePublishedTime(value)
  return parsed && parsed.getTime() <= now.getTime() ? parsed : undefined
}

/** The `article:published_time` a publisher wrote into the head of its supplied article HTML. */
export function suppliedArticleTime(html: string, now = new Date()): Date | undefined {
  const value = parseHTML(html).document.head?.querySelector('meta[property="article:published_time"]')?.getAttribute('content')
  return value ? publisherPublishedTime(value, now) : undefined
}
