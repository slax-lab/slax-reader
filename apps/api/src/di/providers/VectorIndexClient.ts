import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { VectorIndexClient } from '@/infra/repository/vectorIndexClient'

export const provide = (ctx: ContextManager, target: Container): void => target.register(VectorIndexClient, { useFactory: () => new VectorIndexClient(ctx.env), uncached: false })
