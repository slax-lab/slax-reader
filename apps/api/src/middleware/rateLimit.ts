import { ContextManager } from '@/utils/context'
import { TooManyRequestsError } from '../const/err'
import { EDGE_IDENTITY_HEADER, EDGE_SECRET_HEADER } from '../const/edge'
import { captureEventContext, submitServerEvent } from '../domain/events'

const rateLimitedRoutes: Array<{ path: string; method: string }> = [
  { path: '/v1/bookmark/add', method: 'POST' },
  { path: '/v1/bookmark/add_url', method: 'POST' }
]

export const rateLimit = async (request: Request, ctx: ContextManager) => {
  const edgeSecret = ctx.env.EDGE_SHARED_SECRET
  if (edgeSecret && request.headers.get(EDGE_SECRET_HEADER) === edgeSecret && request.headers.has(EDGE_IDENTITY_HEADER)) return

  const pathname = new URL(request.url).pathname
  const method = request.method.toUpperCase()
  if (!rateLimitedRoutes.some(route => route.path === pathname && route.method === method)) return

  const limiter = ctx.env.BOOKMARK_ADD_RATE_LIMITER
  if (!limiter) {
    if (ctx.env.RUN_ENV !== 'development') throw new Error('BOOKMARK_ADD_RATE_LIMITER is required')
    return
  }

  const userId = ctx.getUserId()
  const key = userId > 0 ? `uid:${userId}` : `ip:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`

  const { success } = await limiter.limit({ key })
  if (!success) {
    console.log(`rate limit exceeded: ${key} ${method} ${pathname}`)
    if (userId > 0 && typeof ctx.execution?.waitUntil === 'function') {
      const context = captureEventContext(ctx, request)
      ctx.execution.waitUntil(
        (async () => {
          // A rejected large/streaming body must not bypass the rate limiter through telemetry parsing.
          const length = Number(request.headers.get('content-length') || 0)
          const body =
            length > 0 && length <= 100 * 1024
              ? ((await request
                  .clone()
                  .json()
                  .catch(() => null)) as { target_url?: unknown } | null)
              : null
          let domain = ''
          try {
            if (typeof body?.target_url === 'string') domain = new URL(body.target_url).hostname
          } catch {}
          submitServerEvent(ctx, request, 'bookmark_save_failed', {
            bookmark_id: null,
            url_domain: domain,
            source: context.source,
            content_type: 'full_content',
            error_class: 'bookmark_add'
          })
        })()
      )
    }
    throw TooManyRequestsError()
  }
}
