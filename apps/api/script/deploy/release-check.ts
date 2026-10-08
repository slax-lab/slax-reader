import fs from 'node:fs'
import { readConfig, checkRemote, workerNames } from './config'

// This command emits no configuration values. The public release wrapper also
// captures its exceptions, including those produced by the native validator.
const settings = JSON.parse(fs.readFileSync(process.env.SLAX_API_RELEASE_SETTINGS!, 'utf8'))
const config = readConfig()
checkRemote(config)
const hasBinding = (rows: unknown, binding: string) =>
  Array.isArray(rows) && rows.some(row => row !== null && typeof row === 'object' && 'binding' in row && row.binding === binding)
for (const [key, required] of [
  ['d1_databases', ['DB', 'DB_FULLTEXT']],
  ['hyperdrive', ['HYPERDRIVE', 'HYPERDRIVE_LOGS']],
  ['kv_namespaces', ['KV']]
] as const) {
  if (required.some(binding => !hasBinding(config[key], binding))) throw new Error('Release resource binding missing')
}
if (config.account_id !== settings.accountId) throw new Error('Release account mismatch')
if (!hasBinding(config.services, 'EDGE')) throw new Error('Explicit release Edge binding required')
const names = workerNames(config)
for (const target of ['core', 'edge', 'ai', 'browser'] as const) {
  if (names[target] !== settings.workers[target]) throw new Error('Release Worker identity mismatch')
}
if ((config.vars as Record<string, unknown>).RUN_TYPE !== process.env.SLAX_API_RELEASE_ENVIRONMENT) throw new Error('Release runtime mode mismatch')
