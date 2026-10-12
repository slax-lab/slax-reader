import { ContextManager } from '@/utils/context'
import { resolvePlatform } from '@/utils/clientPlatform'
import { captureEventContext, EVENT_CONTEXT_KEY } from '@/domain/events'

const printLog = async (request: Request, ctx: ContextManager) => {
  const pathname = new URL(request.url).pathname
  const userId = ctx.getUserId()
  if (userId > 0) console.log(`[req] user ${userId} ${request.method} ${pathname}`)
}

export const requestLog = (request: Request, ctx: ContextManager): void => {
  ctx.setPlatform(resolvePlatform(request))
  ctx.set(EVENT_CONTEXT_KEY, captureEventContext(ctx, request))
  ctx.execution.waitUntil(printLog(request, ctx).catch(() => {}))
}
