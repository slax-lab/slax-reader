import '@commons/contracts'
import type { z } from 'zod'
import type { extensionsEnvSchema } from './env.schema'

type SlaxEnv = z.infer<typeof extensionsEnvSchema>

declare global {
  namespace NodeJS {
    interface ProcessEnv extends SlaxEnv {}
  }
}

export {}
