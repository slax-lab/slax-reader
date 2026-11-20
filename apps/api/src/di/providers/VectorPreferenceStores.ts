import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { VectorPreferenceStores } from '@/infra/repository/vectorPreferenceStore'

export const provide = (ctx: ContextManager, target: Container): void =>
  target.register(VectorPreferenceStores, { useFactory: () => new VectorPreferenceStores(ctx.env), uncached: false })
