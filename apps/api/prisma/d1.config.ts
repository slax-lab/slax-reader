import type { PrismaConfig } from 'prisma'
import { loadApiEnv } from '../script/env'

loadApiEnv()

export default {
  schema: './schema.prisma',
  migrations: {
    path: './d1_migrations'
  }
} satisfies PrismaConfig
