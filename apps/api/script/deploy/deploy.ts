import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { API_ROOT, CONFIG_DIR, GENERATED_DIR, LOCAL_STATE, TARGETS, checkRemote, parseArgs, readConfig, writeGenerated, type Target } from './config'
import { fileURLToPath } from 'node:url'
import { loadApiEnv } from '../env'

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
      const results = await Promise.all((options.target ? [options.target] : TARGETS).map(target => run(target)))
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
