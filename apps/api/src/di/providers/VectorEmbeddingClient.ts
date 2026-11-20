import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { VectorEmbeddingClient } from '@/infra/external/vectorEmbedding'

export const provide = (ctx: ContextManager, target: Container): void =>
  target.register(VectorEmbeddingClient, { useFactory: () => new VectorEmbeddingClient(ctx.env), uncached: false })
