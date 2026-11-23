import type { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'
import { PrismaClient } from '@prisma/client'
import { PrismaD1 } from '@prisma/adapter-d1'
import { PRISIMA_FULLTEXT_CLIENT } from '@/const/symbol'

export const provide = (ctx: ContextManager, target: Container): void =>
  target.register(PRISIMA_FULLTEXT_CLIENT, {
    useFactory: () => new PrismaClient({ adapter: new PrismaD1(ctx.env.DB_FULLTEXT) }),
    uncached: false
  })
