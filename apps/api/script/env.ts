import path from 'node:path'
import { config } from 'dotenv'
import { ROOT, LOCAL_DIR } from './root'

/** Load CLI credentials, never Worker bindings. Explicit shell/CI values win. */
export function loadApiEnv(): void {
  const explicit = process.env.SLAX_API_ENV_FILE
  const filename = explicit ? path.resolve(ROOT, explicit) : path.join(LOCAL_DIR, '.env')
  const { error } = config({ path: filename, override: false, quiet: true })
  if (error && (explicit || (error as NodeJS.ErrnoException).code !== 'ENOENT')) {
    throw new Error('Cannot load API environment file; check deploy/local/.env or SLAX_API_ENV_FILE')
  }
}
