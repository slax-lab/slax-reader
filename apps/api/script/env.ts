import path from 'node:path'
import { config } from 'dotenv'
import { LOCAL_DIR } from './root'

/** Load CLI credentials, never Worker bindings. Explicit shell/CI values win. */
export function loadApiEnv(): void {
  const filename = path.join(LOCAL_DIR, '.env')
  const { error } = config({ path: filename, override: false, quiet: true })
  if (error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw new Error(`Cannot load deploy/local/.env (${(error as NodeJS.ErrnoException).code || 'read failed'})`)
  }
}
