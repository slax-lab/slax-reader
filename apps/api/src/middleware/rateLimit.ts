import { ContextManager } from '@/utils/context'
import { TooManyRequestsError } from '../const/err'
import { EDGE_IDENTITY_HEADER, EDGE_SECRET_HEADER } from '../const/edge'
import { captureEventContext, submitServerEvent } from '../domain/events'
import { readerBookmarkUuid } from '@slax-reader/contracts'

const rateLimitedRoutes: Array<{ path: string; method: string }> = [
  { path: '/v1/bookmark/add', method: 'POST' },
  { path: '/v1/bookmark/add_url', method: 'POST' }
]

const EVENT_BODY_LIMIT = 100 * 1024

const readBoundedJson = async (request: Request, limit: number): Promise<{ target_url?: unknown } | null> => {
  let clone: Request
  try {
    clone = request.clone()
  } catch {
    return null
  }
  const reader = clone.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    let result = await reader.read()
    while (!result.done) {
      size += result.value.byteLength
      if (size > limit) {
        void reader.cancel().catch(() => {})
        return null
      }
      chunks.push(result.value)
      result = await reader.read()
    }
  } catch {
    void reader.cancel().catch(() => {})
    return null
  }
  try {
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as { target_url?: unknown } | null
  } catch {
    return null
  }
}

const readRejectedJson = async (request: Request, limit: number): Promise<{ target_url?: unknown } | null> => {
  try {
    if (!request.headers.has('content-length')) return await readBoundedJson(request, limit)
    const length = Number(request.headers.get('content-length') || 0)
    if (!(length > 0 && length <= limit)) return null
    return (await request.clone().json()) as { target_url?: unknown } | null
  } catch {
    return null
  }
}

const normalizeTargetUrl = (value: string) => (value.startsWith('https://') || value.startsWith('http://') ? value : `https://${value}`)

export const rateLimit = async (request: Request, ctx: ContextManager) => {
  const edgeSecret = ctx.env.EDGE_SHARED_SECRET
  if (edgeSecret && request.headers.get(EDGE_SECRET_HEADER) === edgeSecret && request.headers.has(EDGE_IDENTITY_HEADER)) return

  const pathname = new URL(request.url).pathname
  const method = request.method.toUpperCase()
  const diagnosticUpload = pathname === '/v1/user/report' && method === 'POST' && /^multipart\/form-data(?:;|$)/i.test(request.headers.get('content-type') || '')
  if (!diagnosticUpload && !rateLimitedRoutes.some(route => route.path === pathname && route.method === method)) return

  const limiter = ctx.env.BOOKMARK_ADD_RATE_LIMITER
  if (!limiter) {
    if (ctx.env.RUN_ENV !== 'development') throw new Error('BOOKMARK_ADD_RATE_LIMITER is required')
    return
  }

  const userId = ctx.getUserId()
  const identity = userId > 0 ? `uid:${userId}` : `ip:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`
  const key = diagnosticUpload ? `diagnostic:${identity}` : identity

  const { success } = await limiter.limit({ key })
  if (!success) {
    console.log(`rate limit exceeded: ${key} ${method} ${pathname}`)
    if (!diagnosticUpload && userId > 0 && typeof ctx.execution?.waitUntil === 'function') {
      const context = captureEventContext(ctx, request)
      ctx.execution.waitUntil(
        (async () => {
          // A rejected large/streaming body must not bypass the rate limiter through telemetry parsing.
          // A missing Content-Length is bounded explicitly instead of skipping a legitimate small body.
          // A clone failure (locked or consumed body) drops telemetry, never the rate-limited response.
          const body = await readRejectedJson(request, EVENT_BODY_LIMIT)
          const targetUrl = typeof body?.target_url === 'string' && body.target_url ? normalizeTargetUrl(body.target_url) : ''
          let domain = ''
          try {
            if (targetUrl) domain = new URL(targetUrl).hostname
          } catch {}
          const sourceBookmarkId = pathname === '/v1/bookmark/add_url' && targetUrl ? readerBookmarkUuid(targetUrl, [ctx.env.FRONT_END_URL]) : null
          submitServerEvent(ctx, request, 'bookmark_save_failed', {
            bookmark_id: null,
            url_domain: domain,
            source: context.source,
            content_type: 'full_content',
            error_class: 'bookmark_add',
            ...(sourceBookmarkId ? { source_bookmark_id: sourceBookmarkId } : {})
          })
        })()
      )
    }
    throw TooManyRequestsError()
  }
}
