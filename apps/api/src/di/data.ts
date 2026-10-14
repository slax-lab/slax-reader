import { PrismaClient } from '@prisma/client'
import { PRISIMA_CLIENT, PRISIMA_FULLTEXT_CLIENT, VECTORIZE_CLIENTS } from '../const/symbol'
import { singleton, Container } from '../decorators/di'
import { PrismaD1 } from '@prisma/adapter-d1'
import { RedisClient } from '../infra/repository/redisClient'
import { BucketClient } from '../infra/repository/bucketClient'
import { KVClient } from '../infra/repository/KVClient'
import { RemoteVectorizeIndex } from '../infra/repository/remoteVectorizeIndex'
import { QueueClient } from '../infra/queue/queueClient'
import { StripeClient } from '../infra/external/stripe'
import { SlaxAlertBotClient } from '../infra/external/slaxAlertBot'
import { GEMINI_BATCH_PROVIDER } from '../const/symbol'
import { GeminiBatchProvider } from '@/infra/external/batchCompletion'
import { ContextManager } from '@/utils/context'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { PRISIMA_HYPERDRIVE_CLIENT } from '../const/symbol'
import { PRISMA_LOGS_CLIENT } from '../const/symbol'
import { GA4AnalyticsClient } from '@/infra/external/ga4Analytics'
import { VertexAIClient } from '@/infra/external/vertexAIClient'
import { GEMINI_AGENT } from '@/const/symbol'

@singleton()
export class DatabaseRegistry {
  public register(ctx: ContextManager, targetContainer: Container): void {
    targetContainer.register(PRISIMA_CLIENT, {
      useFactory: () => new PrismaClient({ adapter: new PrismaD1(ctx.env.DB) }),
      uncached: false
    })
    targetContainer.register(PRISIMA_FULLTEXT_CLIENT, {
      useFactory: () => new PrismaClient({ adapter: new PrismaD1(ctx.env.DB_FULLTEXT) }),
      uncached: false
    })
    targetContainer.register(PRISIMA_HYPERDRIVE_CLIENT, {
      useFactory: () => {
        const client = new HyperdrivePrismaClient({
          adapter: new PrismaPg(new Pool({ connectionString: ctx.env.HYPERDRIVE.connectionString, max: 1 })),
          transactionOptions: { timeout: 25000 }
        })
        ctx.onCleanup(async () => await client.$disconnect())
        return client
      },
      uncached: false
    })
    targetContainer.register(PRISMA_LOGS_CLIENT, {
      useFactory: () => {
        const client = new HyperdrivePrismaClient({
          adapter: new PrismaPg(new Pool({ connectionString: ctx.env.HYPERDRIVE_LOGS.connectionString, max: 1 })),
          transactionOptions: { timeout: 25000 }
        })
        ctx.onCleanup(async () => await client.$disconnect())
        return client
      },
      uncached: false
    })
    targetContainer.register(VECTORIZE_CLIENTS, {
      useFactory: () => {
        if (ctx.env.VECTOR) return [0, 1, 2, 3, 4].map(shardIdx => new RemoteVectorizeIndex(ctx.env.VECTOR, shardIdx))
        return [ctx.env.VECTORIZE1, ctx.env.VECTORIZE2, ctx.env.VECTORIZE3, ctx.env.VECTORIZE4, ctx.env.VECTORIZE5]
      },
      uncached: false
    })
    targetContainer.register(GEMINI_AGENT, {
      useFactory: () => new VertexAIClient(ctx.env),
      uncached: false
    })
    targetContainer.register(StripeClient, { useFactory: () => new StripeClient(ctx.env), uncached: true })
    targetContainer.register(RedisClient, { useFactory: () => new RedisClient(ctx.env), uncached: true })
    targetContainer.register(BucketClient, { useFactory: () => new BucketClient(ctx.env), uncached: true })
    targetContainer.register(KVClient, { useFactory: () => new KVClient(ctx.env), uncached: true })
    targetContainer.register(QueueClient, { useFactory: () => new QueueClient(ctx.env), uncached: true })
    targetContainer.register(SlaxAlertBotClient, { useFactory: () => new SlaxAlertBotClient(ctx.env), uncached: true })
    targetContainer.register(GEMINI_BATCH_PROVIDER, {
      useFactory: () => new GeminiBatchProvider(ctx.env.GEMINI_BATCH_API_KEY, ctx.env.GEMINI_BATCH_API_URL, 'unnoo-zhishixingqiu'),
      uncached: false
    })
    targetContainer.register(GA4AnalyticsClient, { useFactory: () => new GA4AnalyticsClient(ctx.env), uncached: true })
  }

  public async clean(): Promise<void> {}
}
