import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { StripeClient } from '@/infra/external/stripe'

export const provide = (ctx: ContextManager, target: Container): void => target.register(StripeClient, { useFactory: () => new StripeClient(ctx.env), uncached: true })
