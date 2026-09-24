import fs from 'node:fs'
import path from 'node:path'
import { parse, stringify, type TomlTable } from 'smol-toml'
import { API_ROOT, API_TSCONFIG, ROOT, LOCAL_DIR } from '../root'

export { API_ROOT, ROOT }
export const TARGETS = ['core', 'edge', 'ai', 'browser'] as const
export type Target = (typeof TARGETS)[number]
export const CONFIG_DIR = LOCAL_DIR
export const CONFIG_TEMPLATE = path.join(ROOT, 'deploy/cloudflare/api.toml.example')
export const CONFIG_PATH = path.resolve(ROOT, process.env.SLAX_API_CONFIG || path.join(CONFIG_DIR, 'api.toml'))
export const GENERATED_DIR = path.join(CONFIG_DIR, '.generated')
export const LOCAL_STATE = path.join(ROOT, 'deploy/local/.wrangler/state')
export type ApiConfig = TomlTable
const channels: Record<string, string> = {
  TWITTER_PARSER: 'slax-reader-parser-twitter',
  FETCH_RETRY_PARSER: 'slax-reader-parser-fetch-retry-prod',
  STRIPE_QUEUE: 'slax-reader-parser-stripe',
  IMPORT_OTHER: 'slax-reader-import-other',
  IMPORT_OTHER_SLOW: 'slax-reader-import-other-slow',
  IMPORT_OTHER_DQL: 'slax-reader-import-other-dql',
  USER_DELETION_QUEUE: 'slax-reader-user-deletion'
}
const rows = (value: unknown): TomlTable[] => (Array.isArray(value) ? (value as TomlTable[]) : [])

// Wrangler bindings and vars are not inherited by named environments.
const environmentBindings = [
  'agent_memory',
  'ai',
  'ai_search',
  'ai_search_namespaces',
  'analytics_engine_datasets',
  'artifacts',
  'browser',
  'cloudchamber',
  'connect',
  'containers',
  'd1_databases',
  'define',
  'dispatch_namespaces',
  'durable_objects',
  'flagship',
  'hyperdrive',
  'images',
  'kv_namespaces',
  'media',
  'mtls_certificates',
  'pipelines',
  'queues',
  'r2_buckets',
  'ratelimits',
  'secrets',
  'secrets_store_secrets',
  'send_email',
  'services',
  'stream',
  'streaming_tail_consumers',
  'tail_consumers',
  'unsafe',
  'unsafe_hello_world',
  'vars',
  'vectorize',
  'version_metadata',
  'vpc_networks',
  'vpc_services',
  'websearch',
  'worker_loaders',
  'workflows'
]

export function selectEnvironment(source: TomlTable, environment?: string, local = false): ApiConfig {
  const config = structuredClone(source)
  const environments = config.env as TomlTable | undefined
  const selected = environment || (local && environments?.dev ? 'dev' : undefined)
  if (selected) {
    const override = environments?.[selected]
    if (!override || typeof override !== 'object' || Array.isArray(override)) throw new Error(`Missing [env.${selected}] in api.toml; no configuration files were changed`)
    // A Pipeline stream is only reachable through the top-level binding (`remote = true`), and the
    // [env.*] sections do not declare one. A locally started Worker still has to submit events, so
    // the local run keeps it; deployments keep Wrangler's "not inherited" semantics.
    const pipelines = local ? config.pipelines : undefined
    for (const key of environmentBindings) delete config[key]
    Object.assign(config, override)
    if (pipelines !== undefined && config.pipelines === undefined) config.pipelines = structuredClone(pipelines)
    config.name = (override as TomlTable).name ?? `${source.name}-${selected}`
  }
  delete config.env
  delete config.dev
  return config
}

export function readConfig(filename = CONFIG_PATH, environment = process.env.SLAX_API_ENV, local = false): ApiConfig {
  const resolved = path.resolve(ROOT, filename)
  if (!fs.existsSync(resolved)) throw new Error('API configuration is missing. Prepare api.toml using deploy/cloudflare/api.toml.example.')
  const config = selectEnvironment(parse(fs.readFileSync(resolved, 'utf8')), environment, local)
  return validateConfig(config, resolved)
}

export function workerNames(config: ApiConfig): Record<Target, string> {
  const services = rows(config.services)
  const service = (binding: string) => services.find(row => row.binding === binding)?.service
  const core = String(config.name ?? '')
  // Preserve the deployment identities used by the original backend. An optional
  // native EDGE service binding selects a different public Worker explicitly.
  const legacyEdge: Record<string, string> = { 'reader-core': 'slax-read-backend', 'reader-core-dev': 'reader-backend-dev', 'reader-core-beta': 'slax-read-backend-beta' }
  return {
    core,
    edge: String(service('EDGE') ?? legacyEdge[core] ?? `${core}-edge`),
    ai: String(service('AIGC') ?? service('VECTOR') ?? ''),
    browser: String(service('SlaxBrowser') ?? '')
  }
}

export function validateConfig(config: ApiConfig, filename: string): ApiConfig {
  if (config.workers) throw new Error(`${filename}: use native Wrangler name/services/[env.*] configuration; [workers.*] is not supported`)
  const names = workerNames(config)
  const fields = { core: 'name', edge: 'services.EDGE.service', ai: 'services.AIGC.service (or VECTOR)', browser: 'services.SlaxBrowser.service' }
  const owners = new Map<string, string>()
  for (const target of TARGETS) {
    const name = names[target]
    if (!/^[a-z0-9_][a-z0-9_-]*$/.test(name)) throw new Error(`${filename}: ${fields[target]} is missing or invalid; use lowercase letters, digits, underscores or hyphens`)
    if (owners.has(name)) throw new Error(`${filename}: ${fields[target]} and ${fields[owners.get(name) as Target]} must be distinct`)
    owners.set(name, target)
  }
  if (!config.compatibility_date || !Array.isArray(config.compatibility_flags) || !config.compatibility_flags.includes('global_fetch_strictly_public'))
    throw new Error('Set compatibility_date and retain global_fetch_strictly_public in compatibility_flags')
  const vars = config.vars as TomlTable | undefined
  if (!vars?.BACKEND_API_PREFIX) throw new Error('vars.BACKEND_API_PREFIX is required for HTTP host routing')
  const origin = new URL(String(vars.BACKEND_API_PREFIX))
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
    throw new Error('BACKEND_API_PREFIX must be an HTTP(S) origin without credentials or a path')
  for (const table of [vars]) {
    for (const key of Object.keys(table ?? {})) {
      if (/^(STRIPE_CONNECT|NOTE_STRIPE|SES_)/.test(key)) throw new Error(`${key} is retired and must be removed from Reader configuration`)
      if (
        /SECRET|PASSWORD|PRIVATE_KEY|API_KEY|AUTH_KEY|TOKEN/.test(key) ||
        ['IMAGER_CHECK_DIGST_SALT', 'HASH_IDS_SALT', 'REPORT_PUSH_API', 'STRIPE_PUSH_API', 'ERROR_LOG_PUSH_API', 'CRAWL_PUSH_API'].includes(key)
      )
        throw new Error(`${key} must be configured as a Worker secret, not a TOML variable`)
    }
  }
  queueMapping(config)
  // Build every target before any remote operation to validate merged values.
  for (const target of TARGETS) workerConfig(config, target)
  return config
}

export function queueMapping(config: ApiConfig): Record<string, string> {
  const queues = config.queues as TomlTable | undefined
  const producers = rows(queues?.producers)
  const result: Record<string, string> = Object.create(null)
  for (const consumer of rows(queues?.consumers)) {
    const producer = producers.find(producer => producer.queue === consumer.queue)
    // Preserve the original config; this obsolete queue has no dispatch mapping.
    if (producer?.binding === 'PRODUCER' && consumer.queue === 'slax-reader-parser-dev') continue
    const logical =
      producer?.binding ??
      (consumer.queue === channels.IMPORT_OTHER_DQL ||
      rows(queues?.consumers).some(row => row.dead_letter_queue === consumer.queue && producers.some(p => p.queue === row.queue && p.binding === 'IMPORT_OTHER'))
        ? 'IMPORT_OTHER_DQL'
        : undefined)
    if (typeof consumer.queue !== 'string' || !Object.prototype.hasOwnProperty.call(channels, String(logical)))
      throw new Error('Every queue consumer needs a supported logical channel or matching producer binding')
    if (result[consumer.queue]) throw new Error('Duplicate queue consumer name')
    result[consumer.queue] = channels[String(logical)]
  }
  return result
}

export function workerConfig(config: ApiConfig, target: Target, local = false): TomlTable {
  const output = structuredClone(config)
  const names = workerNames(config)
  output.name = names[target]
  const internal = { CORE: names.core, EDGE: names.edge, AIGC: names.ai, VECTOR: names.ai, SlaxBrowser: names.browser }
  const services = rows(output.services).filter(service => !Object.prototype.hasOwnProperty.call(internal, String(service.binding)))
  if (target === 'edge') services.push({ binding: 'CORE', service: names.core }, { binding: 'AIGC', service: names.ai })
  if (target === 'core' || target === 'edge') services.push({ binding: 'VECTOR', service: names.ai, entrypoint: 'AiEntry' })
  if (target !== 'browser') services.push({ binding: 'SlaxBrowser', service: names.browser })
  output.services = services
  const queue = output.queues as TomlTable | undefined
  if (target === 'edge') {
    ;(output.vars as TomlTable).API_QUEUE_CHANNELS = JSON.stringify(queueMapping(output as ApiConfig))
  } else {
    delete output.triggers
    if (queue?.producers) output.queues = { producers: queue.producers }
    else delete output.queues
  }
  const bindings = rows((output.durable_objects as TomlTable | undefined)?.bindings)
  if (target === 'core' || target === 'edge') {
    output.durable_objects = {
      bindings: bindings.map(binding => {
        if (binding.name === 'SLAX_BROWSER') return { ...binding, script_name: names.browser }
        if (target === 'edge') return { ...binding, script_name: names.core }
        const own = { ...binding }
        delete own.script_name
        return own
      })
    }
    output.workflows = rows(output.workflows).map(workflow => {
      const result = { ...workflow }
      if (target === 'edge') delete result.script_name
      else result.script_name = names.edge
      return result
    })
    if (target === 'edge') delete output.migrations
  }
  if (target === 'core') delete output.vectorize
  if (target === 'ai') {
    for (const key of ['ai', 'browser', 'migrations', 'workflows', 'rules', 'placement']) delete output[key]
    const jieba = bindings.find(binding => binding.name === 'SLAX_JIEBA')
    output.durable_objects = { bindings: jieba ? [{ ...jieba, script_name: names.core }] : [] }
    if (local) output.vectorize = rows(output.vectorize).map(binding => ({ ...binding, remote: true }))
  }
  if (target === 'browser') {
    for (const key of [
      'ai',
      'd1_databases',
      'hyperdrive',
      'kv_namespaces',
      'limits',
      'placement',
      'queues',
      'r2_buckets',
      'ratelimits',
      'rules',
      'services',
      'triggers',
      'vectorize',
      'workflows'
    ])
      delete output[key]
    output.durable_objects = { bindings: [{ name: 'SLAX_BROWSER', class_name: 'SlaxBrowser' }] }
    output.migrations = [{ tag: 'v1', new_classes: ['SlaxBrowser'] }]
  }
  if (!['core', 'edge'].includes(target)) delete output.pipelines
  if (target !== 'edge') {
    output.workers_dev = false
    delete output.route
    output.routes = []
    output.preview_urls = false
  }
  if (local) {
    delete output.route
    delete output.routes
    delete output.placement
  }
  return output
}

export function writeGenerated(config: ApiConfig, target: Target, outputDir = GENERATED_DIR, local = false, bootstrap = false): string {
  const directory = path.resolve(outputDir)
  const output = workerConfig(config, target, local)
  if (bootstrap) {
    delete output.services
    delete output.workflows
  }
  output.main = path.relative(directory, path.join(API_ROOT, `src/entry/${target}/index.ts`))
  output.tsconfig = path.relative(directory, API_TSCONFIG)
  for (const db of rows(output.d1_databases))
    db.migrations_dir = path.relative(directory, path.join(API_ROOT, 'prisma/d1_migrations', db.binding === 'DB_FULLTEXT' ? 'fulltext' : ''))
  fs.mkdirSync(directory, { recursive: true })
  const filename = path.join(directory, `${target}${bootstrap ? '.bootstrap' : ''}.toml`)
  fs.writeFileSync(filename, stringify(output))
  return filename
}

export function checkRemote(config: ApiConfig): void {
  const origin = new URL(String((config.vars as TomlTable).BACKEND_API_PREFIX))
  if (origin.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.hostname.endsWith('.invalid'))
    throw new Error('Remote deployment requires your real HTTPS BACKEND_API_PREFIX')
  if (TARGETS.some(target => (workerConfig(config, target).vars as TomlTable).RUN_ENV !== 'prod'))
    throw new Error('Remote deployment requires RUN_ENV = prod to disable development endpoints and enforce production checks')
  for (const [list, field] of [
    ['d1_databases', 'database_id'],
    ['kv_namespaces', 'id'],
    ['hyperdrive', 'id']
  ] as const) {
    for (const target of TARGETS)
      for (const row of rows(workerConfig(config, target)[list]))
        if (!row[field] || /^0{8}/.test(String(row[field]))) throw new Error(`${list}: replace placeholder resource IDs before deploying`)
  }
}

export function parseArgs(args: string[], allow: string[] = []) {
  let config = CONFIG_PATH
  let environment = process.env.SLAX_API_ENV || undefined
  let target: Target | undefined
  const flags = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--config' && args[i + 1]) config = path.resolve(ROOT, args[++i])
    else if ((arg === '--env' || arg === '-e') && args[i + 1]) environment = args[++i]
    else if (allow.includes(arg)) flags.add(arg)
    else if (TARGETS.includes(arg as Target) && !target) target = arg as Target
    else throw new Error(`Unknown argument: ${arg}. Use [core|edge|ai|browser] [--config <path>] [--env <name>] ${allow.join(' ')}`)
  }
  return { config, environment, target, flags }
}
