import { SlaxJieba } from '@/utils/hybridSearch/jieba'
import { MultiLangError } from '@/utils/multiLangError'
import { Failed } from '@/utils/responseUtils'
import { ServerError } from '@/const/err'
import { container } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { SlaxWebSocketServer } from '@/infra/message/websocket'
import { initializeInfrastructure, initializeCore } from '@/di/generated/dependency'
import { getRouter } from '@/di/router'
import { handleMessage } from '@/di/generated/consumer'
import { handleCronjob } from '@/di/generated/cronjob'
import { SlaxMcpServer } from '@/domain/orchestrator/mcp'
import { handleContentRequest, isContentRequest } from '@/handler/http/contentHandler'
import { ScreenshotBrowser } from './screenshotBrowser'
import { EDGE_RAY_ID_HEADER } from '@/const/edge'
import { applyApiResponseHeaders } from '@/middleware/cors'

initializeCore()

const internalRoutes: ReadonlyArray<{
  match: (request: Request) => boolean
  handle: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>
}> = [{ match: isContentRequest, handle: handleContentRequest }]

async function handleFetch(request: Request, env: Env, ctx: ExecutionContext) {
  for (const route of internalRoutes) {
    if (route.match(request)) return route.handle(request, env, ctx)
  }

  const currentContainer = container.clone()
  const ctxManager = new ContextManager(ctx, env)
  ctxManager.set('rayId', request.headers.get(EDGE_RAY_ID_HEADER) ?? '')

  const router = getRouter(new URL(request.url).host, currentContainer, env.BACKEND_API_PREFIX)
  if (!router) return Failed('host not found')

  initializeInfrastructure(ctxManager, currentContainer)

  const response = await router
    .fetch(request, ctxManager)
    .catch(err => {
      if (err instanceof MultiLangError) return Failed(err)
      console.error(err)
      return Failed(ServerError())
    })
    .then(res => {
      if (res instanceof Response) return res
      console.error(`[${request.method}] ${request.url} ${res} is not a response`)
      return Failed(ServerError())
    })
  await ctxManager.cleanup()

  return response
}

export async function handleQueueEvent(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
  const ctxManager = new ContextManager(ctx, env)
  const currentContainer = container.clone()

  initializeInfrastructure(ctxManager, currentContainer)
  return await handleMessage(currentContainer, batch, env, ctx)
}

export async function handleScheduledEvent(event: Event, env: Env, ctx: ExecutionContext) {
  const ctxManager = new ContextManager(ctx, env)
  const currentContainer = container.clone()

  initializeInfrastructure(ctxManager, currentContainer)
  return await handleCronjob(currentContainer, event, env, ctx)
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return applyApiResponseHeaders(await handleFetch(request, env, ctx), request, env.FRONT_END_URL)
  }
}

export { SlaxJieba, SlaxWebSocketServer, SlaxMcpServer, ScreenshotBrowser }
