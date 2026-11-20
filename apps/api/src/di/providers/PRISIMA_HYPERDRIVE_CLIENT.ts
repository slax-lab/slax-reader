import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'

export const provide = (ctx: ContextManager, target: Container): void =>
  target.register(PRISIMA_HYPERDRIVE_CLIENT, {
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
