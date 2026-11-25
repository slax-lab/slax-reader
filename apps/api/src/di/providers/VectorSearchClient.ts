import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { VectorSearchClient } from '@/infra/external/vectorSearchClient'

export const provide = (ctx: ContextManager, target: Container): void => target.register(VectorSearchClient, { useFactory: () => new VectorSearchClient(ctx.env), uncached: false })
