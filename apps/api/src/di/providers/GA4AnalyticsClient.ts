import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { GA4AnalyticsClient } from '@/infra/external/ga4Analytics'

export const provide = (ctx: ContextManager, target: Container): void => target.register(GA4AnalyticsClient, { useFactory: () => new GA4AnalyticsClient(ctx.env), uncached: true })
