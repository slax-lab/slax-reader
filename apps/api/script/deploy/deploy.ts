import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import {
  API_ROOT,
  CONFIG_DIR,
  GENERATED_DIR,
  LOCAL_STATE,
  MCP_RETIREMENT,
  TARGETS,
  checkDeployment,
  entryFile,
  parseArgs,
  readConfig,
  writeGenerated,
  type McpPhase,
  type Target
} from './config'
import { fileURLToPath } from 'node:url'
import { loadApiEnv } from '../env'
import { accountApi, readReleaseState, requireValues, type CloudflareApi, type ReleaseState } from './topology'

const DEFAULT_PORTS: Record<Target, number> = { edge: 8787, core: 8686, ai: 8788, browser: 8789, objects: 8790, vector: 8791 }

// SLAX_API_DEV_PORTS="ai=8798,objects=8792" moves individual local Workers off ports another process holds.
export function devPorts(value = process.env.SLAX_API_DEV_PORTS): Record<Target, number> {
  const ports = { ...DEFAULT_PORTS }
  for (const entry of (value ?? '').split(',').filter(Boolean)) {
    const [target, port] = entry.split('=')
    const number = Number(port)
    if (!(target in ports) || !Number.isInteger(number) || number < 1 || number > 65535)
      throw new Error(`SLAX_API_DEV_PORTS entry "${entry}" must be <${Object.keys(ports).join('|')}>=<port>`)
    ports[target as Target] = number
  }
  if (new Set(Object.values(ports)).size !== Object.keys(ports).length) throw new Error('SLAX_API_DEV_PORTS gives two Workers the same port')
  return ports
}

export const devPortOccupied = (port: number): Promise<boolean> =>
  new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', () => resolve(true))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(false)))
  })

const listenerPid = (port: number): number | undefined => {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
    const pid = Number(out.trim().split('\n')[0])
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

const listenerCommand = (pid: number): string | undefined => {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

// Narrow match for the real dev-session processes: the workerd binary that
// holds the port, or a Wrangler CLI run from a node_modules install. A bare
// substring match would mislabel any argv that merely mentions the names.
const devSessionCommand = (command: string): boolean => {
  const executable = command.split(' ')[0]
  if (/(^|\/)workerd$/.test(executable) || /(^|\/)wrangler$/.test(executable)) return true
  return /node_modules\/\S*(wrangler|workerd)/.test(command)
}

export const devPortInUseMessage = (port: number): string => {
  const pid = listenerPid(port)
  if (pid === undefined) {
    return `Error: 127.0.0.1:${port} is already in use.\nOnly one local API dev session can run at a time. Free the port, then retry.`
  }
  const command = listenerCommand(pid)
  if (command && devSessionCommand(command)) {
    return [
      'Error: `pnpm api -- dev` is already running on this machine.',
      '',
      `Another instance is listening on 127.0.0.1:${port} (PID ${pid}). Only one local`,
      'API dev session can run at a time — ports, the local dev registry, and the',
      'PostgreSQL/PowerSync containers are all machine-wide singletons.',
      '',
      'If you are using that session: stop it first (Ctrl+C in its terminal).',
      `If it crashed or you don't recognize it: kill ${pid}, then retry.`
    ].join('\n')
  }
  return `Error: 127.0.0.1:${port} is already in use by PID ${pid} (not a Slax dev session).\nStop that process or free the port, then retry.`
}

// Remote releases read the account first: they stop while a Worker lacks a value its code reads, and the account
// state decides the publication order (see releaseOrder). `api` is injected by tests.
export async function deploy(args: string[], api?: CloudflareApi): Promise<number> {
  const options = parseArgs(args, ['--dev', '--dry-run', '--bootstrap'])
  const local = options.flags.has('--dev')
  const config = readConfig(options.config, options.environment, local)
  const bootstrap = options.flags.has('--bootstrap')
  if (bootstrap && (local || options.target)) throw new Error('--bootstrap requires every remote Worker')
  const remote = !local && !options.flags.has('--dry-run')
  if (remote) checkDeployment(config)
  let steps: ReleaseStep[] = (options.target ? [options.target] : bootstrap ? BOOTSTRAP_ORDER : NORMAL_ORDER).map(target => ({ target, mcp: 'retired' }))
  if (remote && !bootstrap) {
    loadApiEnv()
    const account = api ?? accountApi(config)
    await requireValues(account, config)
    steps = releaseOrder(await readReleaseState(account, config), options.target)
  }
  // Fail before touching any shared state: the generated configs, the dev
  // registry and the containers are machine-wide singletons, so even a
  // --target session is a session and every Worker port is probed. Fixtures
  // that stub wrangler never bind ports and opt out to stay independent of
  // the machine's dev-session state.
  const ports = local ? devPorts() : DEFAULT_PORTS
  if (local && !options.flags.has('--dry-run')) {
    if (process.env.SLAX_API_SKIP_DEV_PORT_GUARD) {
      console.warn('Dev port guard skipped: SLAX_API_SKIP_DEV_PORT_GUARD is set (test fixtures only).')
    } else {
      for (const target of TARGETS) {
        if (await devPortOccupied(ports[target])) {
          console.error(devPortInUseMessage(ports[target]))
          return 1
        }
      }
    }
  }
  // Validate every configuration before the first remote mutation.
  // Every configuration the release publishes is generated before the first remote mutation; extra MCP phases
  // go to their own subdirectory so the primary set stays the one `--dry-run` shows.
  const files = Object.fromEntries(TARGETS.map(target => [target, writeGenerated(config, target, GENERATED_DIR, local, false)])) as Record<Target, string>
  const phaseFile = new Map<string, string>()
  for (const step of steps)
    if (step.mcp !== 'retired') phaseFile.set(`${step.target}:${step.mcp}`, writeGenerated(config, step.target, path.join(GENERATED_DIR, step.mcp), local, false, step.mcp))
  const initial = bootstrap ? writeGenerated(config, 'core', GENERATED_DIR, false, true) : undefined
  if (options.flags.has('--dry-run')) {
    console.log('Generated Worker configs in deploy/local/.generated')
    return 0
  }
  loadApiEnv()
  const children = new Set<ReturnType<typeof spawn>>()
  const stop = () => {
    for (const child of children) child.kill('SIGTERM')
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const run = (target: Target, mcp: McpPhase = 'retired', filename = phaseFile.get(`${target}:${mcp}`) ?? files[target]) =>
    new Promise<number>((resolve, reject) => {
      const common = [entryFile(target, mcp), '--tsconfig', path.join(API_ROOT, 'tsconfig.json'), '--config', filename]
      const workerEnv = path.join(CONFIG_DIR, '.dev.vars')
      const loadRuntimeFile = local && fs.existsSync(workerEnv)
      const dev = [
        'dev',
        ...common,
        '--persist-to',
        LOCAL_STATE,
        '--ip',
        '127.0.0.1',
        '--port',
        String(ports[target]),
        '--inspector-port',
        '0',
        ...(loadRuntimeFile ? ['--env-file', workerEnv] : []),
        ...(target === 'edge' ? ['--test-scheduled'] : [])
      ]
      // Preserve unrecovered remote bindings; explicit TOML vars replace matching names.
      const child = spawn('wrangler', local ? dev : ['deploy', ...common, '--minify', '--keep-vars'], {
        cwd: API_ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          // Wrangler loads explicit --env-file paths through its dotenv binding loader.
          CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: loadRuntimeFile ? 'true' : 'false',
          CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false'
        }
      })
      children.add(child)
      child.once('error', error => {
        children.delete(child)
        stop()
        reject(error)
      })
      child.once('exit', code => {
        children.delete(child)
        if (local) stop()
        resolve(code ?? 1)
      })
    })
  try {
    if (local) {
      const targets = options.target ? [options.target] : TARGETS
      const results = await Promise.all(targets.map(target => run(target)))
      return results.find(code => code !== 0) ?? 0
    }
    for (const { target, mcp } of steps) {
      if (initial && target === 'ai') {
        const status = await run('core', 'retired', initial)
        if (status) return status
      }
      const status = await run(target, mcp)
      if (status) return status
    }
    return 0
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}
export interface ReleaseStep {
  target: Target
  mcp: McpPhase
}

// Callees publish before callers: Objects and Browser own Durable Objects others bind to, Vector serves AI's search
// fetch, Core runs the jobs and Workflows Edge and AI call, AI serves the VECTOR RPC, and Edge binds to Core and AI. A bootstrap breaks the
// AI -> Core cycle by first publishing a Core stripped of its service bindings and Workflows; the complete Core is
// published last.
const NORMAL_ORDER: Target[] = ['browser', 'objects', 'vector', 'core', 'ai', 'edge']
const BOOTSTRAP_ORDER: Target[] = ['browser', 'objects', 'vector', 'ai', 'edge', 'core']

// While an MCP namespace remains, Core first publishes still exporting the stub class (the old Edge binds Core's
// namespace), Edge then deletes its own namespace and stops binding Core's, and a second Core publication deletes
// Core's. Later releases find no namespace and publish each Worker once.
export function releaseOrder(state: ReleaseState, target?: Target): ReleaseStep[] {
  const retiredCore: McpPhase = state.mcp.length || state.coreMigrationTag === MCP_RETIREMENT.tag ? 'retire-mcp' : 'retired'
  const phase = (worker: Target): McpPhase => (worker === 'core' ? retiredCore : worker === 'edge' && state.mcp.length ? 'retire-mcp' : 'retired')
  if (target) {
    // A single-Worker release cannot sequence the deletion, so Core keeps the stub while Edge still binds it.
    if (target === 'core' && state.mcp.includes(state.edge)) return [{ target, mcp: 'keep-mcp' }]
    return [{ target, mcp: phase(target) }]
  }
  if (!state.mcp.length) return NORMAL_ORDER.map(worker => ({ target: worker, mcp: phase(worker) }))
  return [
    ...(['browser', 'objects', 'vector'] as const).map(worker => ({ target: worker, mcp: 'retired' as const })),
    { target: 'core', mcp: 'keep-mcp' },
    { target: 'ai', mcp: 'retired' },
    { target: 'edge', mcp: phase('edge') },
    { target: 'core', mcp: retiredCore }
  ]
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  deploy(process.argv.slice(2))
    .then(code => {
      process.exitCode = code
    })
    .catch(error => {
      console.error(error)
      process.exitCode = 1
    })
}
