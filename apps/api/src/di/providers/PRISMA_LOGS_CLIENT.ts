import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { PRISMA_LOGS_CLIENT } from '@/const/symbol'

export const provide = (ctx: ContextManager, target: Container): void =>
  target.register(PRISMA_LOGS_CLIENT, {
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
