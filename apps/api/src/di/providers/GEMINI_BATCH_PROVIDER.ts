import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { GeminiBatchProvider } from '@/infra/external/batchCompletion'
import { GEMINI_BATCH_PROVIDER } from '@/const/symbol'

export const provide = (ctx: ContextManager, target: Container): void =>
  target.register(GEMINI_BATCH_PROVIDER, {
    useFactory: () => new GeminiBatchProvider(ctx.env.GEMINI_BATCH_API_KEY, ctx.env.GEMINI_BATCH_API_URL, 'unnoo-zhishixingqiu'),
    uncached: false
  })
