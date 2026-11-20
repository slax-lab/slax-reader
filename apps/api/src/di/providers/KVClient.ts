import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { KVClient } from '@/infra/repository/KVClient'

export const provide = (ctx: ContextManager, target: Container): void => target.register(KVClient, { useFactory: () => new KVClient(ctx.env), uncached: true })
