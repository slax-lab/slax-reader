import type { PrismaConfig } from 'prisma'
import { env } from 'prisma/config'
import { loadApiEnv } from '../script/env'

loadApiEnv()

export default {
  schema: './pgsql.prisma',
  migrations: {
    path: './pg_migrations'
  },
  datasource: {
    url: env('HYPERDRIVE_DATABASE_URL')
  }
} satisfies PrismaConfig
