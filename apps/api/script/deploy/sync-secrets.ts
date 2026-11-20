import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse as parseDotenv } from 'dotenv'
import { API_ROOT, ROOT, parseArgs, readConfig, workerNames, writeGenerated, type ApiConfig } from './config'
import { accountApi, missingRuntimeValues, type CloudflareApi } from './topology'
import { loadApiEnv } from '../env'

const TARGETS = ['core', 'ai', 'objects', 'edge'] as const
type SecretTarget = (typeof TARGETS)[number]
export type Upload = (target: SecretTarget, values: Record<string, string>) => number

// Cloudflare never returns a secret's value, so values come from a file the operator holds (a password manager
// export or the original .env), outside the repository or in an ignored path. Values are never printed.
export function readSecretsFile(filename: string, isIgnored: (file: string) => boolean): Record<string, string> {
  const resolved = path.resolve(ROOT, filename)
  const relative = path.relative(ROOT, resolved)
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && !isIgnored(resolved))
    throw new Error(`${relative} is inside the repository and not ignored by git; keep secret files outside the repository or in deploy/local/`)
  const text = fs.readFileSync(resolved, 'utf8')
  const values: Record<string, unknown> = /^\s*\{/.test(text) ? JSON.parse(text) : parseDotenv(text)
  for (const [key, value] of Object.entries(values)) if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return values as Record<string, string>
}

// Uploads, per Worker, only the keys its code reads that another API Worker already holds but it lacks. Existing
// secrets are never overwritten, and a Worker that is not deployed yet is skipped rather than created by Wrangler.
export async function syncSecrets(options: {
  api: CloudflareApi
  config: ApiConfig
  values: Record<string, string>
  dryRun: boolean
  upload: Upload
  log?: (line: string) => void
}): Promise<number> {
  const { api, config, values, dryRun, upload, log = console.log } = options
  const names = workerNames(config)
  const scripts = new Set((await api.list<{ id: string }>('/workers/scripts')).map(script => script.id))
  const missing = await missingRuntimeValues(api, config, TARGETS)
  let failed = false
  for (const target of TARGETS) {
    const keys = missing[names[target]]
    if (!keys?.length) continue
    if (!scripts.has(names[target])) {
      log(`${names[target]}: not deployed yet; run the transition step that publishes it, then sync again (${keys.join(', ')})`)
      continue
    }
    const absent = keys.filter(key => !(key in values))
    const selected = Object.fromEntries(keys.filter(key => key in values).map(key => [key, values[key]]))
    if (absent.length) {
      failed = true
      log(`${names[target]}: not in the secrets file: ${absent.join(', ')}`)
    }
    if (!Object.keys(selected).length) continue
    log(`${dryRun ? 'would set' : 'set'} on ${names[target]}: ${Object.keys(selected).join(', ')}`)
    if (!dryRun) {
      const status = upload(target, selected)
      if (status) return status
    }
  }
  if (!Object.keys(missing).length) log('Every Worker already holds the values its code reads.')
  return failed ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const index = args.indexOf('--from')
  const source = index >= 0 ? args[index + 1] : undefined
  const rest = index >= 0 ? [...args.slice(0, index), ...args.slice(index + 2)] : args
  try {
    if (!source) throw new Error('Usage: pnpm api -- secrets:sync --from <secrets .env or .json> [--dry-run] [--config <path>] [--env <name>]')
    const options = parseArgs(rest, ['--dry-run'])
    if (options.target) throw new Error('secrets:sync selects the Workers that lack values itself')
    loadApiEnv()
    const config = readConfig(options.config, options.environment)
    const isIgnored = (file: string) => spawnSync('git', ['check-ignore', '-q', file], { cwd: ROOT }).status === 0
    const values = readSecretsFile(source, isIgnored)
    syncSecrets({
      api: accountApi(config),
      config,
      values,
      dryRun: options.flags.has('--dry-run'),
      // Values go to Wrangler on stdin, so they are never written to disk or passed on a command line.
      upload: (target, selected) => {
        const result = spawnSync('wrangler', ['secret', 'bulk', '--config', writeGenerated(config, target)], {
          cwd: API_ROOT,
          input: JSON.stringify(selected),
          stdio: ['pipe', 'inherit', 'inherit'],
          env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' }
        })
        if (result.error) throw result.error
        return result.status ?? 1
      }
    })
      .then(code => {
        process.exitCode = code
      })
      .catch(error => {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
