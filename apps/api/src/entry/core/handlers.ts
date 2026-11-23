import { NewsletterTiming } from '@/utils/newsletterTiming'
import { NewsletterService, receiveNewsletterEmail } from '@/domain/newsletter'
import { container } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { initializeInfrastructure } from '@/di/generated/core/dependency'
import { handleMessage } from '@/di/generated/core/consumer'
import { handleCronjob } from '@/di/generated/core/cronjob'

// Core's queue, cron and email handlers, shared by the Worker's own handlers and the jobs Edge forwards.
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
