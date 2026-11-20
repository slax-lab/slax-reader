import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { SlaxAlertBotClient } from '@/infra/external/slaxAlertBot'

export const provide = (ctx: ContextManager, target: Container): void => target.register(SlaxAlertBotClient, { useFactory: () => new SlaxAlertBotClient(ctx.env), uncached: true })
