import type { PrismaConfig } from 'prisma'
import { env } from 'prisma/config'
import { loadApiEnv } from '../script/env'

loadApiEnv()

export default {
  schema: './logs.prisma',
  migrations: {
    path: './logs_migrations'
  },
  datasource: {
    url: env('LOGS_DATABASE_URL')
  }
} satisfies PrismaConfig
