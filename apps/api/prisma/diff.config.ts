import { defineConfig, env } from 'prisma/config'
import { loadApiEnv } from '../script/env'

loadApiEnv()

export default defineConfig({
  schema: './schema.prisma',
  datasource: { url: env('D1_DIFF_DATABASE_URL') }
})
