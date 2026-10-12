import { ContextManager } from '@/utils/context'
import { resolveDeviceId, normalizeEventLocale, type EventRequestContext, type BookmarkEventSource } from '@/utils/eventContext'
import { parseClientSource, resolvePlatform } from '../utils/clientPlatform'

export type { EventRequestContext, BookmarkEventSource }
export const EVENT_CONTEXT_KEY = 'firstPartyEventContext'

export interface BookmarkEventProperties extends Record<string, unknown> {
  bookmark_id: string | null
  url_domain: string
  source: BookmarkEventSource
  content_type: 'full_content' | 'url_only'
}

export interface EventRecord extends Record<string, unknown> {
  event_name: string
  occurred_at: string
  received_at: string
  user_id: number
  device_id: string
  properties: Record<string, unknown>
  ua?: string
}

export const captureEventContext = (ctx: ContextManager, request: Request): EventRequestContext => {
  const ua = request.headers.get('user-agent') || undefined
  const platform = resolvePlatform(request)
  const source: BookmarkEventSource = request.headers.has('x-api-key')
    ? /reader[-_ ]?cli|slax[-_ ]?reader[-_ ]?cli/i.test(ua || '')
      ? 'cli'
      : 'api'
    : platform === 'extension'
      ? 'extension_save'
      : platform === 'ios' || platform === 'android'
        ? 'share_sheet'
        : 'web_button'
  return {
    device_id: resolveDeviceId(request),
    platform,
    locale: normalizeEventLocale(request.headers.get('x-client-locale') || ctx.getlang()),
    client_version: request.headers.get('x-client-version')?.trim() || parseClientSource(ua || '').version || 'unknown',
    source,
    ua
  }
}

export const getEventContext = (ctx: ContextManager, request?: Request): EventRequestContext => {
  if (request) return captureEventContext(ctx, request)
  return (
    ctx.get(EVENT_CONTEXT_KEY) || {
      device_id: '',
      platform: ctx.getPlatform() || 'web',
      locale: normalizeEventLocale(ctx.getlang()),
      client_version: 'unknown',
      source: 'api'
    }
  )
}

export const bookmarkEventProperties = (relation: { uuid: string; type: number; bookmark: { target_url: string } }, source: BookmarkEventSource): BookmarkEventProperties => ({
  bookmark_id: relation.uuid,
  url_domain: (() => {
    try {
      return new URL(relation.bookmark.target_url).hostname
    } catch {
      return ''
    }
  })(),
  source,
  content_type: relation.type === 1 ? 'url_only' : 'full_content'
})

export const createServerEvent = (
  ctx: ContextManager,
  request: Request | undefined,
  eventName: string,
  properties: Record<string, unknown>,
  options: { userId?: number; occurredAt?: string } = {}
): EventRecord => {
  const context = getEventContext(ctx, request)
  const now = new Date().toISOString()
  return {
    event_name: eventName,
    occurred_at: options.occurredAt || now,
    received_at: now,
    user_id: options.userId ?? ctx.getUserId(),
    device_id: context.device_id,
    properties: { ...properties, platform: context.platform, locale: context.locale, client_version: context.client_version },
    ua: context.ua
  }
}

export const submitServerEvent = (
  ctx: ContextManager,
  request: Request | undefined,
  eventName: string,
  properties: Record<string, unknown>,
  options: { userId?: number; occurredAt?: string } = {}
) => {
  const env = ctx.env as Env & { SLAX_READER_STREAM_STREAM?: { send: (records: Record<string, unknown>[]) => Promise<unknown> } }
  if (!env.SLAX_READER_STREAM_STREAM || typeof ctx.execution?.waitUntil !== 'function') return
  const record = createServerEvent(ctx, request, eventName, properties, options)
  const pending = Promise.resolve()
    .then(() => env.SLAX_READER_STREAM_STREAM!.send([record]))
    .catch(error => console.error(`[events] failed to submit ${eventName}:`, error))
  ctx.execution.waitUntil(pending)
}
