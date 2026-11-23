import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { QueueClient } from '@/infra/queue/queueClient'

export const provide = (ctx: ContextManager, target: Container): void => target.register(QueueClient, { useFactory: () => new QueueClient(ctx.env), uncached: true })
