import { spawnSync } from 'node:child_process'
import { loadApiEnv } from '../env'
import { API_ROOT, CONFIG_PATH, LOCAL_STATE, TARGETS, checkRemote, readConfig, writeGenerated, type Target } from './config'

const [target, ...args] = process.argv.slice(2)
if (!TARGETS.includes(target as Target) || !args.length) throw new Error('Usage: pnpm api -- wrangler <core|edge|ai|browser> <wrangler arguments>')
if (args.some(arg => arg === '--config' || arg === '-c' || arg.startsWith('--config=')))
  throw new Error('Select the API configuration with SLAX_API_CONFIG, not a generated Wrangler config')
const local = args.includes('--local')
let environment = process.env.SLAX_API_ENV
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--env' || args[i] === '-e') {
    if (!args[i + 1]) throw new Error('--env requires a name')
    environment = args[i + 1]
    args.splice(i, 2)
    i--
  } else if (args[i].startsWith('--env=')) {
    environment = args.splice(i--, 1)[0].slice(6)
    if (!environment) throw new Error('--env requires a name')
  }
}
const subcommand = args.find(arg => !arg.startsWith('-'))
if (['deploy', 'publish', 'versions'].includes(subcommand ?? ''))
  throw new Error('Deployment is not available through the Wrangler wrapper; use pnpm api -- deploy so the remote preflight checks run')
const config = readConfig(CONFIG_PATH, environment, local)
loadApiEnv()
if (args.includes('--remote')) checkRemote(config)
const filename = writeGenerated(config, target as Target, undefined, local)
const result = spawnSync('wrangler', [...args, '--config', filename, ...(local ? ['--persist-to', LOCAL_STATE] : [])], {
  cwd: API_ROOT,
  stdio: 'inherit',
  env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' }
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
