import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse as parseDotenv } from 'dotenv'
import { parse as parseToml } from 'smol-toml'
import { API_ROOT, ROOT, parseArgs, readConfig, workerNames, writeGenerated, type ApiConfig } from './config'
import { accountApi, missingRuntimeValues, type CloudflareApi } from './topology'
import { loadApiEnv } from '../env'

const TARGETS = ['core', 'ai', 'objects', 'vector', 'edge'] as const
type SecretTarget = (typeof TARGETS)[number]
export type Upload = (target: SecretTarget, values: Record<string, string>) => number

// Cloudflare never returns a secret's value, so values come from a file the operator holds (a password manager
// export, the original .env or an old TOML backup), outside the repository or in an ignored path. Values are never
// printed, including in errors: a syntax error reports only its position, and an unsupported shape lists key names and
// value types.
export function readSecretsFile(filename: string, isIgnored: (file: string) => boolean): Record<string, string> {
  const resolved = path.resolve(ROOT, filename)
  const relative = path.relative(ROOT, resolved)
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && !isIgnored(resolved))
    throw new Error(`${relative} is inside the repository and not ignored by git; keep secret files outside the repository or in deploy/local/`)
  const text = fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, '')
  if (resolved.endsWith('.toml')) return secretsFromEntries(Object.entries(parseTomlFile(text)), TOML_EXPECTED)
  if (!/^\s*[{[]/.test(text) && !resolved.endsWith('.json')) return parseDotenv(text)
  return secretsFromJson(parseJson(text))
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    const position = error instanceof Error ? /position \d+(?: \(line \d+ column \d+\))?/.exec(error.message)?.[0] : undefined
    throw new Error(`The secrets file is not valid JSON${position ? ` at ${position}` : ''}`)
  }
}

// smol-toml quotes the offending line in its message, so only the line and column are kept.
function parseTomlFile(text: string): Record<string, unknown> {
  try {
    return parseToml(text)
  } catch (error) {
    const { line, column } = (error ?? {}) as { line?: unknown; column?: unknown }
    throw new Error(`The secrets file is not valid TOML${typeof line === 'number' && typeof column === 'number' ? ` at line ${line} column ${column}` : ''}`)
  }
}

const describe = (value: unknown) => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value)
const article = (type: string) => (/^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`)
const JSON_EXPECTED = 'expected {"KEY": "value"} or [{"name": "KEY", "value": "value"}]'
const TOML_EXPECTED = 'expected top-level KEY = "value" lines'

// Accepts {"KEY": "value"} and [{"name" | "key": "KEY", "value": "value"}].
function secretsFromJson(data: unknown): Record<string, string> {
  if (Array.isArray(data))
    return secretsFromEntries(
      data.map((entry: unknown, index) => {
        const item = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {}
        const name = item.name ?? item.key
        if (typeof name !== 'string' || !name || !('value' in item)) throw new Error(`Entry ${index} of the secrets file needs a "name" (or "key") and a "value"`)
        return [name, item.value]
      }),
      JSON_EXPECTED
    )
  if (describe(data) === 'object') return secretsFromEntries(Object.entries(data as Record<string, unknown>), JSON_EXPECTED)
  throw new Error(`The secrets file holds ${article(describe(data))}; ${JSON_EXPECTED}`)
}

// Numbers and booleans become strings; anything else names its key and type only.
function secretsFromEntries(entries: [string, unknown][], expected: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (typeof value === 'string') values[key] = value
    else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') values[key] = String(value)
    else
      throw new Error(
        `${key} holds ${article(describe(value))}, not a string; ${expected}. This file has: ${entries.map(([name, item]) => `${name} (${describe(item)})`).join(', ')}`
      )
  }
  return values
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
      log(`${names[target]}: not deployed yet, so it cannot hold secrets; add these keys to [vars] of the selected configuration for its first release (${keys.join(', ')})`)
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
    if (!source) throw new Error('Usage: pnpm api -- secrets:sync --from <secrets .env, .json or .toml file> [--dry-run] [--config <path>] [--env <name>]')
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
