import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { RedisClient } from '@/infra/repository/redisClient'

export const provide = (ctx: ContextManager, target: Container): void => target.register(RedisClient, { useFactory: () => new RedisClient(ctx.env), uncached: true })
