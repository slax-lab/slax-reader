import { WorkerEntrypoint } from 'cloudflare:workers'
import { appendTiming, copyResponse, elapsedMs, serverTimingEnabled } from '@/utils/diagnosticHeaders'

type ContentMeta = Record<string, unknown>

export type TrackEventInput = {
  event: 'visit' | 'collection_visit' | 'collection_share'
  target: string // visit 传 uuid，collection_* 传 code
  token?: string
  visitorId?: string
  userAgent?: string
  durationMs?: number
  statusCode?: number
  isOwner?: boolean // 仅 visit
  extra?: Record<string, unknown> // 仅 collection_*
}

export class ContentEntry extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const edgeStartedAt = performance.now()
    const forwardedHeaders = new Headers(request.headers)
    const pathname = new URL(request.url).pathname
    const authorization = forwardedHeaders.get('Authorization') || ''
    if (pathname.startsWith('/content/') && authorization.startsWith('Bearer ')) {
      forwardedHeaders.set('x-slax-token', authorization.slice(7))
      forwardedHeaders.delete('Authorization')
    }

    const coreStartedAt = performance.now()
    const response = await this.env.CORE.fetch(new Request(request, { headers: forwardedHeaders }))
    if (!serverTimingEnabled(this.env)) return response

    const headers = new Headers(response.headers)
    appendTiming(headers, 'edge', 'core-fetch', elapsedMs(coreStartedAt))
    appendTiming(headers, 'edge', 'total', elapsedMs(edgeStartedAt))
    return copyResponse(response, headers)
  }

  async getContentMeta(uuid: string, token?: string): Promise<ContentMeta | null> {
    const response = await this.fetch(
      new Request(`https://content.internal/content/meta?uuid=${encodeURIComponent(uuid)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      })
    )

    if (response.status === 404) return null
    if (!response.ok) throw new Error(`content meta returned ${response.status}`)
    return (await response.json()) as ContentMeta
  }

  // 埋点统一入口，匿名事件走 dweb nitro 绕开 edge 鉴权
  async trackEvent(input: TrackEventInput): Promise<void> {
    const { event, target, visitorId, durationMs, statusCode } = input
    const isCollection = event !== 'visit'

    // 两端字段名不同：visit 收 camelCase，collection_* 收 snake_case
    const collectionExtra: Record<string, unknown> = { ...input.extra }
    if (durationMs !== undefined) collectionExtra.duration_ms = durationMs
    if (statusCode !== undefined) collectionExtra.status_code = statusCode

    const body = isCollection ? { event, code: target, visitorId, extra: collectionExtra } : { uuid: target, visitorId, durationMs, statusCode, isOwner: input.isOwner }

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (input.token) headers.Authorization = `Bearer ${input.token}`
    // 转发访客 UA，否则 platform 只能落成 web
    if (input.userAgent) headers['User-Agent'] = input.userAgent

    const path = isCollection ? '/content/collection_event' : '/content/visit'
    const response = await this.env.CORE.fetch(new Request(`https://content.internal${path}`, { method: 'POST', headers, body: JSON.stringify(body) }))
    if (!response.ok) throw new Error(`${event} returned ${response.status}`)
  }

  async trackVisit(uuid: string, token?: string, visitorId?: string, durationMs?: number, statusCode?: number, isOwner?: boolean): Promise<void> {
    return this.trackEvent({ event: 'visit', target: uuid, token, visitorId, durationMs, statusCode, isOwner })
  }

  async trackCollectionEvent(event: string, code: string, token?: string, visitorId?: string, extra?: Record<string, unknown>): Promise<void> {
    if (event !== 'collection_visit' && event !== 'collection_share') throw new Error(`unsupported collection event: ${event}`)
    return this.trackEvent({ event, target: code, token, visitorId, extra })
  }

  async getBookmarkUserUuidByShareCode(shareCode: string): Promise<string | undefined> {
    const response = await this.env.CORE.fetch(`https://content.internal/content/share_uuid?code=${encodeURIComponent(shareCode)}`)
    if (!response.ok) throw new Error(`content share lookup returned ${response.status}`)
    const payload = (await response.json()) as { uuid?: string | null }
    return payload.uuid || undefined
  }
}
