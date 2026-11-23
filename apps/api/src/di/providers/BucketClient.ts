import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { BucketClient } from '@/infra/repository/bucketClient'

export const provide = (ctx: ContextManager, target: Container): void => target.register(BucketClient, { useFactory: () => new BucketClient(ctx.env), uncached: true })
