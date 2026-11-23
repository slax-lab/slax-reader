import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { RemoteVectorizeIndex } from '@/infra/repository/remoteVectorizeIndex'
import { VECTORIZE_CLIENTS } from '@/const/symbol'

export const provide = (ctx: ContextManager, target: Container): void =>
  target.register(VECTORIZE_CLIENTS, {
    useFactory: () => {
      if (ctx.env.VECTOR) return [0, 1, 2, 3, 4].map(shardIdx => new RemoteVectorizeIndex(ctx.env.VECTOR, shardIdx))
      return [ctx.env.VECTORIZE1, ctx.env.VECTORIZE2, ctx.env.VECTORIZE3, ctx.env.VECTORIZE4, ctx.env.VECTORIZE5]
    },
    uncached: false
  })
