import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { VectorSourceRepo } from '@/infra/repository/vectorSources'

export const provide = (ctx: ContextManager, target: Container): void => target.register(VectorSourceRepo, { useFactory: () => new VectorSourceRepo(ctx.env), uncached: false })
