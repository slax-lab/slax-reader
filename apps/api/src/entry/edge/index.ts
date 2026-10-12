import { ContextManager } from '@/utils/context'
import { authToken, isWhitelisted } from '@/middleware/auth'
import { rateLimit } from '@/middleware/rateLimit'
import { cors, applyApiResponseHeaders } from '@/middleware/cors'
import { Failed } from '@/utils/responseUtils'
import { ServerError, UnauthorizedError } from '@/const/err'
import { MultiLangError } from '@/utils/multiLangError'
import { EDGE_SECRET_HEADER, EDGE_IDENTITY_HEADER, EDGE_RAY_ID_HEADER, encodeEdgeIdentity } from '@/const/edge'
import { matchCacheableRequest } from '@/middleware/cacheableRoutes'
import { applyCacheHeaders } from '@/middleware/cacheHeaders'
import { ContentEntry } from './contentEntry'
import { handleImageProxy } from '@/handler/http/imageProxy'
import { handleQueueEvent, handleScheduledEvent } from '../core'

type ForwardMode = 'user' | 'anon' | 'apikey'

const AIGC_PATHS = new Set(['/v1/aigc/summaries', '/v1/aigc/chat', '/v1/bookmark/overview', '/v1/bookmark/outline', '/v1/bookmark/search'])

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    request = new Request(request)
    request.headers.delete(EDGE_SECRET_HEADER)
    request.headers.delete(EDGE_IDENTITY_HEADER)
    request.headers.delete(EDGE_RAY_ID_HEADER)
    const ctxManager = new ContextManager(ctx, env)
    ctxManager.set('rayId', request.headers.get('CF-Ray') ?? '')

    const preflight = await cors(request, ctxManager)
    if (preflight) return preflight

    const pathname = new URL(request.url).pathname
    const authorization = request.headers.get('Authorization') ?? ''
    const apiKey = request.headers.get('X-API-Key') ?? ''

    try {
      if (matchCacheableRequest(new URL(request.url), request.method)) {
        const response = await handleImageProxy(ctxManager, request)
        return applyCacheHeaders(response, request)
      }

      if (apiKey !== '') return await forward(env, request, 'apikey', ctxManager)

      if (isWhitelisted(pathname) && authorization === '') return await forward(env, request, 'anon', ctxManager)

      if (authorization === '') return Failed(UnauthorizedError())

      await authToken(ctxManager, authorization.replace('Bearer ', ''))

      await rateLimit(request, ctxManager)

      return await forward(env, request, 'user', ctxManager)
    } catch (err) {
      if (err instanceof MultiLangError) return Failed(err)
      console.error(`[edge] ${request.method} ${pathname} error: ${err}`)
      return Failed(ServerError())
    }
  },

  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
    return handleQueueEvent(batch, env, ctx)
  },

  async scheduled(event: Event, env: Env, ctx: ExecutionContext) {
    return handleScheduledEvent(event, env, ctx)
  }
}

export default {
  ...worker,
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return applyApiResponseHeaders(await worker.fetch(request, env, ctx), request, env.FRONT_END_URL)
  }
}

async function forward(env: Env, request: Request, mode: ForwardMode, ctx: ContextManager): Promise<Response> {
  const forwarded = new Request(request)

  forwarded.headers.delete(EDGE_SECRET_HEADER)
  forwarded.headers.delete(EDGE_IDENTITY_HEADER)
  forwarded.headers.delete(EDGE_RAY_ID_HEADER)
  const rayId = ctx.get('rayId')
  if (rayId) forwarded.headers.set(EDGE_RAY_ID_HEADER, rayId)

  const secret = env.EDGE_SHARED_SECRET
  if (mode === 'user' && !secret) throw new Error('EDGE_SHARED_SECRET is not configured')
  if (secret) forwarded.headers.set(EDGE_SECRET_HEADER, secret)

  if (mode === 'user') {
    forwarded.headers.delete('Authorization')
    if (secret) {
      forwarded.headers.set(
        EDGE_IDENTITY_HEADER,
        encodeEdgeIdentity({
          deId: ctx.getUserId(),
          enId: ctx.getEncodeUserId(),
          email: ctx.getUserEmail(),
          lang: ctx.getlang(),
          audience: 'reader'
        })
      )
    }
  }

  const target = AIGC_PATHS.has(new URL(request.url).pathname) ? env.AIGC : env.CORE
  return target.fetch(forwarded)
}

export { ContentEntry }
export { CrawlWorkflow } from './workflows/crawlWorkflow'
export { ContentValidationWorkflow } from './workflows/contentValidationWorkflow'
export { ImportParseWorkflow } from './workflows/importParseWorkflow'
export { SlaxJieba, SlaxWebSocketServer, SlaxMcpServer, ScreenshotBrowser } from '../core'
