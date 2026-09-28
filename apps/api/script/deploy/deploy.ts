import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { API_ROOT, CONFIG_DIR, GENERATED_DIR, LOCAL_STATE, TARGETS, checkRemote, parseArgs, readConfig, writeGenerated, type Target } from './config'
import { fileURLToPath } from 'node:url'
import { loadApiEnv } from '../env'

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

export async function deploy(args: string[]): Promise<number> {
  const options = parseArgs(args, ['--dev', '--dry-run', '--bootstrap'])
  const local = options.flags.has('--dev')
  const config = readConfig(options.config, options.environment, local)
  const bootstrap = options.flags.has('--bootstrap')
  if (bootstrap && (local || options.target)) throw new Error('--bootstrap requires all four remote Workers')
  if (!local && !options.flags.has('--dry-run')) checkRemote(config)
  // Validate every configuration before the first remote mutation.
  const files = Object.fromEntries(TARGETS.map(target => [target, writeGenerated(config, target, GENERATED_DIR, local)]))
  const initial = bootstrap ? writeGenerated(config, 'core', GENERATED_DIR, false, true) : undefined
  if (options.flags.has('--dry-run')) {
    console.log('Generated Worker configs in deploy/local/.generated')
    return 0
  }
  loadApiEnv()
  const ports: Record<Target, number> = { edge: 8787, core: 8686, ai: 8788, browser: 8789 }
  const children = new Set<ReturnType<typeof spawn>>()
  const stop = () => {
    for (const child of children) child.kill('SIGTERM')
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const run = (target: Target, filename = files[target]) =>
    new Promise<number>((resolve, reject) => {
      const common = [path.join(API_ROOT, `src/entry/${target}/index.ts`), '--tsconfig', path.join(API_ROOT, 'tsconfig.json'), '--config', filename]
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
      const child = spawn('wrangler', local ? dev : ['deploy', ...common, '--minify'], {
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
      // All four ports are probed even for --target: the dev registry and the
      // database containers are machine-wide singletons, so a partial session
      // is still a session. Fixtures that stub wrangler never bind ports and
      // opt out to stay independent of the machine's dev-session state.
      if (!process.env.SLAX_API_SKIP_DEV_PORT_GUARD) {
        for (const target of TARGETS) {
          if (await devPortOccupied(ports[target])) {
            console.error(devPortInUseMessage(ports[target]))
            return 1
          }
        }
      }
      const results = await Promise.all(targets.map(target => run(target)))
      return results.find(code => code !== 0) ?? 0
    }
    const order: Target[] = options.target ? [options.target] : bootstrap ? ['browser', 'ai', 'edge', 'core'] : ['browser', 'ai', 'core', 'edge']
    for (const target of order) {
      if (initial && target === 'ai') {
        const status = await run('core', initial)
        if (status) return status
      }
      const status = await run(target)
      if (status) return status
    }
    return 0
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
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
