import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export { ROOT } from '../root'
import { ROOT, API_ROOT } from '../root'

export function isolatedEnvironment(home: string, emptyEnv: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    HOME: home,
    XDG_CONFIG_HOME: resolve(home, 'config'),
    XDG_CACHE_HOME: resolve(home, 'cache'),
    XDG_DATA_HOME: resolve(home, 'data'),
    TMPDIR: resolve(home, 'tmp'),
    CI: 'true',
    DOTENV_CONFIG_PATH: emptyEnv,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    WRANGLER_SEND_METRICS: 'false'
  }
}

const ROLES = ['edge', 'core', 'ai', 'objects'] as const
type Role = (typeof ROLES)[number]
const FLAGS: Record<Role, string> = { edge: '--edge-config', core: '--core-config', ai: '--ai-config', objects: '--objects-config' }
const OBJECT_CLASSES = ['SlaxJieba', 'SlaxWebSocketServer', 'ScreenshotBrowser']
const USAGE =
  'Usage: api -- dev:local --edge-config <isolated.json> --core-config <isolated.json> --ai-config <isolated.json> --objects-config <isolated.json> --state <isolated directory> --env-file <empty file> [--port <loopback port>]'

export function localDevOptions(args: string[]) {
  const values = new Map<string, string>()
  const flags = [...Object.values(FLAGS), '--state', '--env-file']
  for (let i = 0; i < args.length; i += 2) {
    if (![...flags, '--port'].includes(args[i]) || !args[i + 1] || values.has(args[i])) throw new Error(USAGE)
    values.set(args[i], args[i] === '--port' ? args[i + 1] : resolve(ROOT, args[i + 1]))
  }
  if (!flags.every(key => values.has(key))) throw new Error('All six explicit local paths are required; there are no default configurations.')
  const port = Number(values.get('--port') ?? '8787')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Local port must be an integer between 1 and 65535')
  const files = Object.fromEntries(ROLES.map(role => [role, values.get(FLAGS[role])!])) as Record<Role, string>
  const state = values.get('--state')!
  const emptyEnv = values.get('--env-file')!
  const workspace = dirname(files.edge)
  if (!/^\.tmp-root-tooling-http-[\w-]+$/.test(relative(ROOT, workspace))) throw new Error('Configs must be in a repository .tmp-root-tooling-http-* workspace')
  if (realpathSync(workspace) !== workspace || ROLES.some(role => dirname(files[role]) !== workspace)) throw new Error('Configs must share a real, non-symlink workspace')
  const inside = (path: string) => {
    const rel = relative(workspace, path)
    if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel) || realpathSync(path) !== path)
      throw new Error('Local inputs and state must stay inside the isolated workspace without symlinks')
    if (rel.split(sep).some(part => part.startsWith('.env') || part.startsWith('.dev.vars') || part.endsWith('.local.toml')))
      throw new Error('Secret files and overrides are not accepted')
  }
  for (const path of [...Object.values(files), state, emptyEnv]) inside(path)
  if (!ROLES.every(role => files[role].endsWith('.json'))) throw new Error('Explicit JSON configurations are required')
  if (readFileSync(emptyEnv).length !== 0) throw new Error('The explicit env file must be empty')
  const configs = Object.fromEntries(ROLES.map(role => [role, JSON.parse(readFileSync(files[role], 'utf8')) as Record<string, any>])) as Record<Role, Record<string, any>>
  const names = Object.fromEntries(ROLES.map(role => [role, configs[role].name])) as Record<Role, string>
  if (new Set(Object.values(names)).size !== ROLES.length || Object.values(names).some(name => typeof name !== 'string' || !name))
    throw new Error('Each local Worker needs its own name')
  const allowed = new Set([
    'name',
    'main',
    'tsconfig',
    'compatibility_date',
    'compatibility_flags',
    'vars',
    'rules',
    'services',
    'd1_databases',
    'kv_namespaces',
    'r2_buckets',
    'hyperdrive',
    'durable_objects',
    'migrations',
    'ratelimits',
    'workflows'
  ])
  // Each local Worker may bind only to the other local Workers, in the same direction as the published topology.
  // Edge needs both callees; Core's vector RPC to AI is optional because local runs may omit Vectorize.
  const expectedServices: Record<Role, Record<string, string>> = {
    edge: { CORE: names.core, AIGC: names.ai },
    core: { VECTOR: names.ai },
    ai: {},
    objects: {}
  }
  const requiredServices: Record<Role, number> = { edge: 2, core: 0, ai: 0, objects: 0 }
  for (const role of ROLES) {
    const config = configs[role]
    if (Object.keys(config).some(key => !allowed.has(key))) throw new Error('Only the minimal local binding configuration is supported')
    const expected = resolve(ROOT, `apps/api/src/entry/${role}/index.ts`)
    const fixtures: Partial<Record<Role, string>> = { core: 'apps/api/test/runtime/diagnosticWorker.ts', edge: 'apps/api/test/runtime/edgeEmailFixture.ts' }
    const diagnosticFixture = !!fixtures[role] && process.env.SLAX_API_DIAGNOSTIC_HTTP_FIXTURE === '1' && resolve(workspace, config.main) === resolve(ROOT, fixtures[role]!)
    if (resolve(workspace, config.main) !== expected && !diagnosticFixture) throw new Error('Use the actual Edge/Core/AI/Objects entrypoints')
    if (resolve(workspace, config.tsconfig) !== resolve(ROOT, 'apps/api/tsconfig.json')) throw new Error('Use the root API tsconfig')
    const workflows = config.workflows ?? []
    if (
      !Array.isArray(workflows) ||
      workflows.length > 1 ||
      (role !== 'core' && workflows.length) ||
      workflows.some(
        workflow =>
          workflow.binding !== 'CRAWL_WORKFLOW' || workflow.class_name !== 'CrawlWorkflow' || Object.keys(workflow).some(key => !['binding', 'name', 'class_name'].includes(key))
      )
    )
      throw new Error('Only the declared local Crawl Workflow on Core is supported')
    const services = config.services ?? []
    const wanted = expectedServices[role]
    if (
      !Array.isArray(services) ||
      services.length < requiredServices[role] ||
      new Set(services.map(service => service.binding)).size !== services.length ||
      services.some(service => wanted[service.binding] !== service.service || Object.keys(service).some(key => !['binding', 'service', 'entrypoint'].includes(key)))
    )
      throw new Error('Only local Edge-to-Core, Edge-to-AI and Core-to-AI service bindings are supported')
    const objects = config.durable_objects?.bindings ?? []
    for (const binding of objects) {
      const owned = (role === 'objects' || role === 'core') && OBJECT_CLASSES.includes(binding.class_name)
      if (!owned || Object.keys(binding).some(key => !['name', 'class_name', 'script_name'].includes(key)))
        throw new Error('Only Objects-owned Durable Objects, bound from Core, are supported')
      if (role === 'objects' ? binding.script_name !== undefined : binding.script_name !== names.objects)
        throw new Error('Core must reach Durable Objects through the local Objects Worker')
    }
    if (role !== 'objects' && config.migrations) throw new Error('Only the local Objects Worker declares Durable Object migrations')
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      for (const [key, item] of Object.entries(value)) {
        if (key === 'remote' || key === 'script_name' || key === 'account_id') throw new Error('Remote resources are forbidden')
        walk(item)
      }
    }
    // Validated service and Durable Object targets can refer only to this launcher's local Workers.
    const { workflows: _workflows, services: _services, durable_objects: _objects, ...otherBindings } = config
    walk(otherBindings)
    for (const binding of config.hyperdrive ?? []) {
      const url = new URL(binding.localConnectionString)
      if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || !url.port) throw new Error('Hyperdrive requires an explicit loopback PostgreSQL URL')
    }
    if (config.vars?.RUN_ENV !== 'development' || config.vars?.RUN_TYPE !== 'dev') throw new Error('Only development/dev runtime is supported')
    for (const db of config.d1_databases ?? []) {
      const migrations = resolve(workspace, db.migrations_dir)
      if (![resolve(ROOT, 'apps/api/prisma/d1_migrations'), resolve(ROOT, 'apps/api/prisma/d1_migrations/fulltext')].includes(migrations))
        throw new Error('Use the historical D1 migrations')
    }
  }
  // Wrangler 4 normalizes tsconfig against cwd, then resolves it against each config's project root.
  const shim = resolve(workspace, 'tsconfig.json')
  const shimContent = JSON.stringify({ extends: relative(workspace, resolve(ROOT, 'apps/api/tsconfig.json')) })
  try {
    writeFileSync(shim, shimContent, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    inside(shim)
    if (readFileSync(shim, 'utf8') !== shimContent) throw error
  }
  const home = resolve(workspace, 'worker-home')
  mkdirSync(resolve(home, 'tmp'), { recursive: true })
  return {
    cwd: API_ROOT,
    env: isolatedEnvironment(home, emptyEnv),
    args: [
      'exec',
      'wrangler',
      'dev',
      ...ROLES.flatMap(role => ['-c', files[role]]),
      '--tsconfig',
      resolve(ROOT, 'apps/api/tsconfig.json'),
      '--local',
      '--env-file',
      emptyEnv,
      '--persist-to',
      state,
      '--ip',
      '127.0.0.1',
      '--host',
      `localhost:${port}`,
      '--port',
      String(port),
      '--inspector-port',
      '0'
    ]
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = localDevOptions(args)
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const ipc = mkdtempSync(resolve(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'slax-worker-'))
  const child = spawn('pnpm', options.args, { cwd: options.cwd, env: { ...options.env, TMPDIR: ipc }, stdio: 'inherit' })
  const stop = () => child.kill('SIGTERM')
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    await new Promise<void>((done, reject) => {
      child.once('error', reject)
      child.once('exit', code => {
        process.exitCode = code ?? 1
        done()
      })
    })
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    rmSync(ipc, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
