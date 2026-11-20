import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { VectorPreferenceClient } from '@/infra/repository/vectorPreferenceClient'

export const provide = (ctx: ContextManager, target: Container): void =>
  target.register(VectorPreferenceClient, { useFactory: () => new VectorPreferenceClient(ctx.env), uncached: false })
