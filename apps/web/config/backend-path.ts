import { ensureWebWranglerConfig, GENERATED_DIR, WEB_STATE_DIR, WEB_STATE_V3, WEB_WRANGLER_CONFIG } from './backend-binding'
import { pathToFileURL } from 'node:url'

/** Generated Web Wrangler config and shared local state paths. */
export const webWranglerConfig = (): string => {
  ensureWebWranglerConfig({ local: true })
  return WEB_WRANGLER_CONFIG
}
export const backendStateDir = (): string => WEB_STATE_DIR
export const backendStateV3 = (): string => WEB_STATE_V3
export const generatedWebDir = (): string => GENERATED_DIR

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const target = process.argv[2]
  const values: Record<string, () => string> = { config: webWranglerConfig, stateDir: backendStateDir, stateV3: backendStateV3 }
  if (!target || !values[target]) {
    console.error(`Usage: jiti backend-path.ts <${Object.keys(values).join('|')}>`)
    process.exit(1)
  }
  process.stdout.write(values[target]())
}
