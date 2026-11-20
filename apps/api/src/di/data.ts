import type { Container } from '../decorators/di'
import { ContextManager } from '@/utils/context'

export type InfrastructureProvider = (ctx: ContextManager, target: Container) => void

// Registers request-scoped infrastructure clients. Each Worker's generated registry constructs it with
// only the providers (src/di/providers) whose tokens that Worker's classes inject.
export class DatabaseRegistry {
  constructor(private readonly providers: readonly InfrastructureProvider[] = []) {}

  public register(ctx: ContextManager, targetContainer: Container): void {
    for (const provide of this.providers) provide(ctx, targetContainer)
  }

  public async clean(): Promise<void> {}
}
