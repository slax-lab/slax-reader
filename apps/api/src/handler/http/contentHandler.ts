import { ContextManager } from '@/utils/context'
import { Hashid } from '@/utils/hashids'
import { container } from '@/decorators/di'
import { initializeInfrastructure } from '@/di/generated/dependency'
import { ContentOrchestrator } from '@/domain/orchestrator/content'
import { LogsService } from '@/domain/logs'
import { ShareService } from '@/domain/share'
import { BookmarkService } from '@/domain/bookmark'
import { CollectionService } from '@/domain/collection'
import { CollectionController } from '@/handler/http/collectionController'
import { authToken } from '@/middleware/auth'
import { requestLog } from '@/middleware/requestLog'
import { MultiLangError } from '@/utils/multiLangError'
import { appendTiming, copyResponse, elapsedMs, serverTimingEnabled } from '@/utils/diagnosticHeaders'

const CONTENT_HOST = 'content.internal'
const MAX_PAGE = 10000

export const isContentRequest = (request: Request): boolean => new URL(request.url).hostname === CONTENT_HOST

export async function handleContentRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const requestStartedAt = performance.now()
  const timings: Record<string, number> = {}
  const url = new URL(request.url)
  const authorization = request.headers.get('Authorization')
  const token = authorization !== null ? (authorization.startsWith('Bearer ') ? authorization.slice(7) : '') : (request.headers.get('x-slax-token') ?? undefined)
  let response: Response

  try {
    if (url.pathname === '/content/meta' && request.method === 'GET') response = await handleMeta(env, ctx, request, token, timings)
    else if (url.pathname === '/content/visit' && request.method === 'POST') response = await handleVisit(env, ctx, request, token, timings)
    else if (url.pathname === '/content/share_uuid' && request.method === 'GET') response = await handleShareUuid(env, ctx, url, timings, token)
    else if (url.pathname === '/content/collection' && request.method === 'GET') response = await handleCollection(env, ctx, url, token, timings)
    else if (url.pathname === '/content/collections_sitemap' && request.method === 'GET') response = await handleCollectionsSitemap(env, ctx, timings, token)
    else if (url.pathname === '/content/collection_event' && request.method === 'POST') response = await handleCollectionEvent(env, ctx, request, token, timings)
    else response = json({ error: 'not found' }, 404, 'no-store')
  } catch (e) {
    const errorCode = e instanceof MultiLangError ? e.errCode : 500
    const status = errorCode >= 400 && errorCode <= 599 ? errorCode : 500
    if (status >= 500) console.error('[content] request failed:', e)
    response = json({ error: status === 404 ? 'not found' : 'content service error' }, status, 'no-store')
  }

  timings.total = elapsedMs(requestStartedAt)
  if (!serverTimingEnabled(env)) return response
  return addServerTiming(response, timings)
}

function addServerTiming(response: Response, timings: Record<string, number>): Response {
  const headers = new Headers(response.headers)
  for (const [step, duration] of Object.entries(timings)) appendTiming(headers, 'core', step, duration)
  return copyResponse(response, headers)
}

function json(data: unknown, status = 200, cacheControl?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cacheControl) headers['Cache-Control'] = cacheControl
  return new Response(JSON.stringify(data), { status, headers })
}

function buildCtx(env: Env, ctx: ExecutionContext) {
  const currentContainer = container.clone()
  const ctxManager = new ContextManager(ctx, env)
  ctxManager.setHashIds(new Hashid(env))
  return { currentContainer, ctxManager }
}

async function withContext(
  env: Env,
  ctx: ExecutionContext,
  timings: Record<string, number>,
  handler: (runtime: ReturnType<typeof buildCtx>) => Promise<Response>
): Promise<Response> {
  const contextStartedAt = performance.now()
  const runtime = buildCtx(env, ctx)
  timings.context = elapsedMs(contextStartedAt)
  try {
    const infrastructureStartedAt = performance.now()
    initializeInfrastructure(runtime.ctxManager, runtime.currentContainer)
    timings.infrastructure = elapsedMs(infrastructureStartedAt)
    return await handler(runtime)
  } finally {
    const cleanupStartedAt = performance.now()
    await runtime.ctxManager.cleanup()
    timings.cleanup = elapsedMs(cleanupStartedAt)
  }
}

async function authenticate(ctx: ContextManager, currentContainer: ReturnType<typeof container.clone>, token?: string): Promise<void> {
  if (token === undefined) return
  await authToken(ctx, token)
  const { requireActiveUser } = await import('@/utils/activeUser')
  await requireActiveUser(currentContainer, ctx.getUserId())
}

async function handleMeta(env: Env, ctx: ExecutionContext, request: Request, token: string | undefined, timings: Record<string, number>): Promise<Response> {
  const uuid = new URL(request.url).searchParams.get('uuid') || ''
  if (!uuid) return json({ error: 'missing uuid' }, 400, 'no-store')

  return withContext(env, ctx, timings, async ({ currentContainer, ctxManager }) => {
    const authStartedAt = performance.now()
    await authenticate(ctxManager, currentContainer, token)
    timings.auth = elapsedMs(authStartedAt)

    requestLog(request, ctxManager)

    const queryStartedAt = performance.now()
    const meta = await currentContainer.resolve(ContentOrchestrator).getContentMeta(ctxManager, uuid, (step, duration) => {
      timings[step] = duration
    })
    timings.meta = elapsedMs(queryStartedAt)

    const serializeStartedAt = performance.now()
    const response = json(meta, 200, 'private, no-store')
    timings.serialize = elapsedMs(serializeStartedAt)
    return response
  })
}

async function handleVisit(env: Env, ctx: ExecutionContext, request: Request, token: string | undefined, timings: Record<string, number>): Promise<Response> {
  const payload = (await request.json()) as {
    uuid: string
    visitorId?: string
    durationMs?: number
    statusCode?: number
    isOwner?: boolean
  }

  return withContext(env, ctx, timings, async ({ currentContainer, ctxManager }) => {
    await authenticate(ctxManager, currentContainer, token)

    requestLog(request, ctxManager)

    await currentContainer.resolve(LogsService).track(ctxManager.getUserId(), 'visit', {
      platform: ctxManager.getPlatform(),
      uuid: payload.uuid,
      visitor_id: payload.visitorId,
      duration_ms: payload.durationMs,
      status_code: payload.statusCode,
      success: typeof payload.statusCode === 'number' ? payload.statusCode < 400 : undefined,
      is_owner: payload.isOwner
    })
    return json({ ok: true }, 200, 'no-store')
  })
}

// 星标合集观测：匿名侧事件收口点
const COLLECTION_EVENTS = new Set(['collection_visit', 'collection_share'])
// 公开入口，extra 按 key 白名单过滤
// 不含 visitor_id，防经 extra 覆盖
const COLLECTION_EXTRA_KEYS = new Set(['entry_page', 'is_curator', 'is_bot', 'via', 'duration_ms', 'status_code'])
const MAX_EXTRA_STRING = 512
// code 独立传参，不经 sanitize
const MAX_CODE_LEN = 64

function sanitizeCollectionExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!extra) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra)) {
    if (!COLLECTION_EXTRA_KEYS.has(key)) continue
    if (value === undefined || value === null) continue
    out[key] = typeof value === 'string' ? value.slice(0, MAX_EXTRA_STRING) : value
  }
  return out
}

async function handleCollectionEvent(env: Env, ctx: ExecutionContext, request: Request, token: string | undefined, timings: Record<string, number>): Promise<Response> {
  const payload = (await request.json()) as {
    event?: string
    code?: string
    visitorId?: string
    extra?: Record<string, unknown>
  }

  const event = payload.event || ''
  const code = payload.code || ''
  if (!COLLECTION_EVENTS.has(event)) return json({ error: 'unsupported event' }, 400, 'no-store')

  if (!code || code.length > MAX_CODE_LEN || !CollectionController.collectionCodeIsValidate(code)) return json({ error: 'invalid code' }, 400, 'no-store')

  return withContext(env, ctx, timings, async ({ currentContainer, ctxManager }) => {
    await authenticate(ctxManager, currentContainer, token)

    requestLog(request, ctxManager)

    const extra = sanitizeCollectionExtra(payload.extra)

    const statusCode = extra.status_code
    await currentContainer.resolve(LogsService).track(ctxManager.getUserId(), event, {
      platform: ctxManager.getPlatform(),
      collect_code: code,
      ...extra,
      success: typeof statusCode === 'number' ? statusCode < 400 : undefined,
      visitor_id: payload.visitorId
    })
    return json({ ok: true }, 200, 'no-store')
  })
}

async function handleShareUuid(env: Env, ctx: ExecutionContext, url: URL, timings: Record<string, number>, token?: string): Promise<Response> {
  const code = url.searchParams.get('code') || ''
  if (!code) return json({ error: 'missing code' }, 400, 'no-store')

  return withContext(env, ctx, timings, async ({ currentContainer, ctxManager }) => {
    await authenticate(ctxManager, currentContainer, token)
    const share = await currentContainer.resolve(ShareService).getBookmarkShareByShareCode(code)
    if (!share) return json({ uuid: null }, 200, 'private, no-store')

    const userBookmark = await currentContainer.resolve(BookmarkService).getUserBookmark(share.bookmark_id, share.user_id)
    return json({ uuid: userBookmark?.uuid ?? null }, 200, 'private, no-store')
  })
}

async function handleCollection(env: Env, ctx: ExecutionContext, url: URL, token: string | undefined, timings: Record<string, number>): Promise<Response> {
  const collectCode = url.searchParams.get('collect_code') || ''
  if (!collectCode) return json({ error: 'missing collect_code' }, 400, 'no-store')
  const pageNum = Number(url.searchParams.get('page'))
  const page = Number.isInteger(pageNum) && pageNum >= 1 ? pageNum : 1

  return withContext(env, ctx, timings, async ({ currentContainer, ctxManager }) => {
    await authenticate(ctxManager, currentContainer, token)

    // page 上限兜底
    const safePage = Number.isFinite(page) ? Math.min(Math.max(1, Math.floor(page)), MAX_PAGE) : 1
    const size = 10

    const info = await currentContainer.resolve(CollectionService).getShareCollectionInfo(ctxManager, collectCode, safePage, size)
    return json(info, 200, 'private, no-store')
  })
}

// sitemap 专用，公开只读
async function handleCollectionsSitemap(env: Env, ctx: ExecutionContext, timings: Record<string, number>, token?: string): Promise<Response> {
  return withContext(env, ctx, timings, async ({ currentContainer, ctxManager }) => {
    await authenticate(ctxManager, currentContainer, token)
    const list = await currentContainer.resolve(CollectionService).listActiveCollectionsForSitemap()
    return json({ collections: list }, 200, 'public, max-age=3600')
  })
}
