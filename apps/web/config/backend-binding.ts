import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify, type TomlTable } from 'smol-toml'

const modulePath = import.meta.url.startsWith('file:') ? fileURLToPath(import.meta.url) : path.join(process.cwd(), 'config/backend-binding.ts')
export const WEB_ROOT = path.resolve(path.dirname(modulePath), '..')
export const REPO_ROOT = path.resolve(WEB_ROOT, '../..')
export const GENERATED_DIR = path.join(REPO_ROOT, 'deploy/local_web/.generated')
export const WEB_WRANGLER_CONFIG = path.join(GENERATED_DIR, 'wrangler.toml')
// CLI appends v3; getPlatformProxy (used by Nuxt) takes the versioned path.
export const WEB_STATE_DIR = path.join(REPO_ROOT, 'deploy/local/.wrangler/state')
export const WEB_STATE_V3 = path.join(WEB_STATE_DIR, 'v3')
const TEMPLATE = path.join(REPO_ROOT, 'deploy/cloudflare/api.toml.example')
const LEGACY_EDGE: Record<string, string> = {
  'reader-core': 'slax-read-backend',
  'reader-core-dev': 'reader-backend-dev',
  'reader-core-beta': 'slax-read-backend-beta'
}

const rows = (value: unknown): TomlTable[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as TomlTable[] : []
export type WebBindingSelection = {
  apiConfigPath: string
  apiEnvironment?: string
  apiWorkerName: string
  bucketName: string
  previewBucketName?: string
  generatedConfigPath: string
  stateDir: string
  configFound: boolean
}
export type BindingOptions = { env?: NodeJS.ProcessEnv; local?: boolean }

export function resolveApiConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(REPO_ROOT, env.SLAX_API_CONFIG || 'deploy/local/api.toml')
}

export function selectApiBindings(source: TomlTable, environment?: string, local = false): { config: TomlTable; environment?: string } {
  const environments = source.env as TomlTable | undefined
  const selected = environment || (local && environments?.dev ? 'dev' : undefined)
  if (!selected) return { config: source }
  const override = environments?.[selected]
  if (!override || typeof override !== 'object' || Array.isArray(override)) throw new Error(`API configuration does not define [env.${selected}]`)
  const config = override as TomlTable
  // services and r2_buckets are not inherited by Wrangler environments.
  return { config: { ...config, name: config.name ?? `${source.name}-${selected}` }, environment: selected }
}

export function readWebBindingSelection(options: BindingOptions = {}): WebBindingSelection {
  const env = options.env ?? process.env
  const local = options.local ?? false
  const configPath = resolveApiConfigPath(env)
  const configFound = fs.existsSync(configPath)
  if (!configFound && (env.SLAX_API_CONFIG || env.SLAX_API_ENV)) {
    throw new Error('The selected API configuration is missing. Check SLAX_API_CONFIG or run pnpm api -- config:init.')
  }
  // Only an absent default configuration can fall back to the public template.
  // This permits offline prepare/check/build; local dev prints a setup hint.
  const source = parse(fs.readFileSync(configFound ? configPath : TEMPLATE, 'utf8'))
  const selected = selectApiBindings(source, env.SLAX_API_ENV?.trim(), local)
  const config = selected.config
  const edge = rows(config.services).find(row => row.binding === 'EDGE')?.service
  const core = String(config.name ?? '')
  const apiWorkerName = env.BACKEND_SERVICE_NAME?.trim() || String(edge ?? LEGACY_EDGE[core] ?? `${core}-edge`)
  if (!/^[a-z0-9_][a-z0-9_-]*$/.test(apiWorkerName)) throw new Error('API EDGE service name or BACKEND_SERVICE_NAME is invalid')
  const bucket = rows(config.r2_buckets).find(row => row.binding === 'OSS')
  if (typeof bucket?.bucket_name !== 'string' || !bucket.bucket_name) {
    throw new Error('Selected API configuration must define an OSS r2_buckets binding; named environments do not inherit it')
  }
  return {
    apiConfigPath: configPath,
    apiEnvironment: selected.environment,
    apiWorkerName,
    bucketName: bucket.bucket_name,
    previewBucketName: typeof bucket.preview_bucket_name === 'string' ? bucket.preview_bucket_name : undefined,
    generatedConfigPath: WEB_WRANGLER_CONFIG,
    stateDir: WEB_STATE_DIR,
    configFound
  }
}

export function projectWebWranglerConfig(selection: WebBindingSelection, outputDirectory = GENERATED_DIR): string {
  // Whitelist the Web surface only. Never spread API vars, secrets, bindings,
  // compatibility flags or entrypoint paths into a frontend configuration.
  return stringify({
    name: 'slax-reader',
    compatibility_date: '2026-05-26',
    compatibility_flags: ['nodejs_compat'],
    pages_build_output_dir: path.relative(outputDirectory, path.join(WEB_ROOT, 'dist')).split(path.sep).join('/') || '.',
    r2_buckets: [{ binding: 'OSS', bucket_name: selection.bucketName, ...(selection.previewBucketName ? { preview_bucket_name: selection.previewBucketName } : {}) }],
    services: [{ binding: 'BACKEND', service: selection.apiWorkerName, entrypoint: 'ContentEntry' }]
  })
}

export function ensureWebWranglerConfig(options: BindingOptions = {}): WebBindingSelection {
  const selection = readWebBindingSelection(options)
  fs.mkdirSync(GENERATED_DIR, { recursive: true })
  fs.writeFileSync(WEB_WRANGLER_CONFIG, projectWebWranglerConfig(selection))
  return selection
}

export function writeWebBuildConfig(selection: WebBindingSelection, directory = path.join(WEB_ROOT, 'dist')): void {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'wrangler.toml'), projectWebWranglerConfig(selection, directory))
}

export function warnIfApiConfigMissing(selection: WebBindingSelection, local: boolean): void {
  if (!selection.configFound && local) {
    console.warn('[web] API 尚未配置，当前使用公开模板的绑定。请运行 pnpm api -- config:init，配置 deploy/local/api.toml，再运行 pnpm api -- dev 进行联调。')
  }
}
