import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { VertexAIClient } from '@/infra/external/vertexAIClient'
import { GEMINI_AGENT } from '@/const/symbol'

export const provide = (ctx: ContextManager, target: Container): void =>
  target.register(GEMINI_AGENT, {
    useFactory: () => new VertexAIClient(ctx.env),
    uncached: false
  })
