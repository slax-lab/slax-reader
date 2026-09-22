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
    SLAX_API_ENV_FILE: emptyEnv,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    WRANGLER_SEND_METRICS: 'false'
  }
}

export function localDevOptions(args: string[]) {
  const values = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    if (!['--edge-config', '--core-config', '--state', '--env-file', '--port'].includes(args[i]) || !args[i + 1] || values.has(args[i])) {
      throw new Error(
        'Usage: api -- dev:local --edge-config <isolated.json> --core-config <isolated.json> --state <isolated directory> --env-file <empty file> [--port <loopback port>]'
      )
    }
    values.set(args[i], args[i] === '--port' ? args[i + 1] : resolve(ROOT, args[i + 1]))
  }
  if (!['--edge-config', '--core-config', '--state', '--env-file'].every(key => values.has(key)))
    throw new Error('All four explicit local paths are required; there are no default configurations.')
  const port = Number(values.get('--port') ?? '8787')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Local port must be an integer between 1 and 65535')
  const edge = values.get('--edge-config')!
  const core = values.get('--core-config')!
  const state = values.get('--state')!
  const emptyEnv = values.get('--env-file')!
  const workspace = dirname(edge)
  if (!/^\.tmp-root-tooling-http-[\w-]+$/.test(relative(ROOT, workspace))) throw new Error('Configs must be in a repository .tmp-root-tooling-http-* workspace')
  if (realpathSync(workspace) !== workspace || dirname(core) !== workspace) throw new Error('Configs must share a real, non-symlink workspace')
  const inside = (path: string) => {
    const rel = relative(workspace, path)
    if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel) || realpathSync(path) !== path)
      throw new Error('Local inputs and state must stay inside the isolated workspace without symlinks')
    if (rel.split(sep).some(part => part.startsWith('.env') || part.startsWith('.dev.vars') || part.endsWith('.local.toml')))
      throw new Error('Secret files and overrides are not accepted')
  }
  for (const path of [edge, core, state, emptyEnv]) inside(path)
  if (![edge, core].every(path => path.endsWith('.json'))) throw new Error('Explicit JSON configurations are required')
  if (readFileSync(emptyEnv).length !== 0) throw new Error('The explicit env file must be empty')
  const configs = [edge, core].map(path => JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>)
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
    'ratelimits'
  ])
  configs.forEach((config, index) => {
    if (Object.keys(config).some(key => !allowed.has(key))) throw new Error('Only the minimal local binding configuration is supported')
    if (resolve(workspace, config.main) !== resolve(ROOT, `apps/api/src/entry/${index === 0 ? 'edge' : 'core'}/index.ts`)) throw new Error('Use the actual Edge/Core entrypoints')
    if (resolve(workspace, config.tsconfig) !== resolve(ROOT, 'apps/api/tsconfig.json')) throw new Error('Use the root API tsconfig')
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      for (const [key, item] of Object.entries(value)) {
        if (key === 'remote' || key === 'script_name' || key === 'account_id') throw new Error('Remote resources are forbidden')
        walk(item)
      }
    }
    walk(config)
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
  })
  if (configs[1].services?.length || configs[0].services?.length !== 1 || configs[0].services[0].binding !== 'CORE' || configs[0].services[0].service !== configs[1].name) {
    throw new Error('Only the local Edge-to-Core service binding is supported')
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
      '-c',
      edge,
      '-c',
      core,
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
  const child = spawn('pnpm', options.args, { cwd: options.cwd, env: options.env, stdio: 'inherit' })
  const stop = () => child.kill('SIGTERM')
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  await new Promise<void>((done, reject) => {
    child.once('error', reject)
    child.once('exit', code => {
      process.exitCode = code ?? 1
      done()
    })
  })
  process.removeListener('SIGINT', stop)
  process.removeListener('SIGTERM', stop)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
