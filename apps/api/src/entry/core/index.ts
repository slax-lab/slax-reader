import { NewsletterTiming } from '@/utils/newsletterTiming'
import { NewsletterService, receiveNewsletterEmail } from '@/domain/newsletter'
import { MultiLangError } from '@/utils/multiLangError'
import { Failed } from '@/utils/responseUtils'
import { ServerError } from '@/const/err'
import { container } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { initializeInfrastructure, initializeCore } from '@/di/generated/core/dependency'
import { getRouter as readerRouter } from '@/di/generated/core/readerRouter'
import { getRouter } from '@/di/router'
import { handleMessage } from '@/di/generated/core/consumer'
import { handleCronjob } from '@/di/generated/core/cronjob'
import { handleContentRequest, isContentRequest } from './contentHandler'
import { VectorPreferenceObject } from './vectorPreferenceObject'
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

  const router = getRouter(new URL(request.url).host, currentContainer, env.BACKEND_API_PREFIX, readerRouter)
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
      console.error(`[${request.method}] ${new URL(request.url).pathname} is not a response`)
      return Failed(ServerError())
    })
  await ctxManager.cleanup()

  return response
}

export async function handleEmailEvent(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
  const timing = new NewsletterTiming(message.rawSize)
  const ctxManager = new ContextManager(ctx, env)
  try {
    const currentContainer = container.clone()
    initializeInfrastructure(ctxManager, currentContainer)
    await receiveNewsletterEmail(message, env, currentContainer.resolve(NewsletterService), timing)
  } finally {
    try {
      await timing.measure('cleanup', () =>
        ctxManager.cleanup(() => {
          timing.cleanupFailed = true
        })
      )
    } catch {
      timing.cleanupFailed = true
    } finally {
      timing.log()
    }
  }
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
  },
  email: handleEmailEvent,
  queue: handleQueueEvent,
  scheduled: handleScheduledEvent
}

export { VectorPreferenceObject }
export { CoreJobs } from './jobs'
export { SlaxJieba, SlaxWebSocketServer, ScreenshotBrowser } from '../retired'
export { CrawlWorkflow } from './workflows/crawlWorkflow'
export { ContentValidationWorkflow } from './workflows/contentValidationWorkflow'
export { ImportParseWorkflow } from './workflows/importParseWorkflow'
export { YoutubeArticleWorkflow } from './workflows/youtubeArticleWorkflow'
export { PodcastWorkflow } from './workflows/podcastWorkflow'
export { VectorMaintenanceWorkflow } from './workflows/vectorMaintenanceWorkflow'
