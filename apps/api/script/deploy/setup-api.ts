import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse } from 'dotenv'
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { CONFIG_DIR, CONFIG_PATH, ROOT, TARGETS, parseArgs, readConfig, workerConfig } from './config'
import { parse as parseToml, type TomlTable } from 'smol-toml'

/** The API signing key is the sole source of local PowerSync verification keys. */
export function powerSyncPublicEnvironment(value: string): Record<string, string> {
  let jwk: Record<string, unknown>
  try {
    jwk = JSON.parse(value.replace(/\\/g, ''))
  } catch {
    throw new Error('POWERSYNC_JWK_PRIVATE_KEY in deploy/local/.dev.vars must be valid JSON')
  }
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk) || jwk.kty !== 'RSA') throw new Error('POWERSYNC_JWK_PRIVATE_KEY must be a single RSA private JWK object')
  const missing = ['kid', 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'].filter(key => typeof jwk[key] !== 'string' || !(jwk[key] as string).trim())
  if (missing.length) throw new Error(`POWERSYNC_JWK_PRIVATE_KEY is missing RSA fields: ${missing.join(', ')}`)
  if ((jwk.alg && jwk.alg !== 'RS256') || (jwk.use && jwk.use !== 'sig') || (jwk.key_ops && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes('sign'))))
    throw new Error('POWERSYNC_JWK_PRIVATE_KEY must allow RS256 signing')
  try {
    const privateKey = createPrivateKey({ key: jwk, format: 'jwk' })
    const publicKey = createPublicKey(privateKey)
    const challenge = Buffer.from('slax-local-powersync-key-check')
    if (!verify('RSA-SHA256', challenge, publicKey, sign('RSA-SHA256', challenge, privateKey))) throw new Error('invalid key pair')
    const publicJwk = publicKey.export({ format: 'jwk' })
    return { PS_JWK_N: publicJwk.n!, PS_JWK_E: publicJwk.e!, PS_JWK_KID: jwk.kid as string }
  } catch {
    throw new Error('POWERSYNC_JWK_PRIVATE_KEY cannot sign and verify RS256; check the private JWK contents (no keys were changed)')
  }
}

export function checkDevelopment(filename = CONFIG_PATH, environment = process.env.SLAX_API_ENV): Record<string, string> {
  const required = [filename, path.join(CONFIG_DIR, '.dev.vars')]
  const missing = required.filter(file => !fs.existsSync(file))
  if (missing.length)
    throw new Error(
      `Missing local prerequisites:\n${missing.map(file => `- ${path.relative(ROOT, file)}`).join('\n')}\nPrepare the listed files in deploy/local, then rerun setup. See docs/api/DEV-AND-CI-CN.md; no configuration files are created or rewritten.`
    )
  const config = readConfig(filename, environment, true)
  for (const target of TARGETS) {
    const effective = workerConfig(config, target, true)
    const vars = effective.vars as TomlTable
    if (vars.RUN_ENV !== 'development' || vars.RUN_TYPE !== 'dev') throw new Error('setup requires RUN_ENV=development and RUN_TYPE=dev for every Worker')
    const bindings = (effective.hyperdrive ?? []) as TomlTable[]
    if (target !== 'browser' && ['HYPERDRIVE', 'HYPERDRIVE_LOGS'].some(name => !bindings.some(binding => binding.binding === name)))
      throw new Error('setup requires both HYPERDRIVE and HYPERDRIVE_LOGS bindings')
    for (const binding of bindings) {
      const database = binding.binding === 'HYPERDRIVE' ? 'slax-reader-backend-internal' : binding.binding === 'HYPERDRIVE_LOGS' ? 'slax-reader-logs' : undefined
      if (!database) throw new Error('setup only supports the local main and logs Hyperdrive bindings')
      let url: URL
      try {
        url = new URL(String(binding.localConnectionString))
      } catch {
        throw new Error('Set Hyperdrive localConnectionString to the local Compose database')
      }
      if (
        url.protocol !== 'postgresql:' ||
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.port !== '15432' ||
        url.username !== 'admin' ||
        url.password !== 'admin' ||
        url.pathname !== `/${database}`
      )
        throw new Error('Hyperdrive localConnectionString must match deploy/local/dockerfile-local-pgsql.yaml; setup will not use a remote database')
    }
  }
  const runtimeFile = path.join(CONFIG_DIR, '.dev.vars')
  if (!fs.existsSync(runtimeFile)) throw new Error('Create deploy/local/.dev.vars with local Worker secrets before setup')
  const runtime = parse(fs.readFileSync(runtimeFile))
  for (const key of ['JWT_SECRET_TEXT', 'HASH_IDS_SALT', 'EDGE_SHARED_SECRET', 'POWERSYNC_JWK_PRIVATE_KEY']) {
    if (!runtime[key]?.trim()) throw new Error(`Missing ${key} in deploy/local/.dev.vars`)
  }
  const powerSync = powerSyncPublicEnvironment(runtime.POWERSYNC_JWK_PRIVATE_KEY)
  const sync = new URL(String((config.vars as TomlTable).POWERSYNC_SG_API_URL))
  if (sync.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(sync.hostname) || sync.port !== '18080')
    throw new Error('setup requires the local PowerSync endpoint http://localhost:18080')
  return powerSync
}

export async function setupApi(args: string[] = []): Promise<number> {
  const options = parseArgs(args, ['--check'])
  if (options.target) throw new Error('setup prepares shared infrastructure; use pnpm api -- dev <worker> to start a Worker')
  const environment =
    options.environment || (fs.existsSync(options.config) && (parseToml(fs.readFileSync(options.config, 'utf8')).env as TomlTable | undefined)?.dev ? 'dev' : undefined)
  const powerSync = checkDevelopment(options.config, environment)
  for (const args of [['compose', 'version'], ['info']]) {
    const result = spawnSync('docker', args, { stdio: 'ignore' })
    if (result.error || result.status !== 0) throw new Error('Docker Compose and a running Docker daemon are required')
  }
  console.log('Local prerequisites passed. Dedicated Cloudflare development resources and provider credentials are still required for cloud-backed features.')
  if (options.flags.has('--check')) return 0
  let child: ChildProcess | undefined
  let interrupted = 0
  const interrupt = () => {
    interrupted = 130
    child?.kill('SIGINT')
  }
  const terminate = () => {
    interrupted = 143
    child?.kill('SIGTERM')
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  try {
    for (const command of ['login', 'infrastructure']) {
      if (interrupted) return interrupted
      const status = await new Promise<number>((resolve, reject) => {
        console.log(command === 'login' ? 'Authenticating with Cloudflare (wrangler login)...' : 'Setting up PostgreSQL, migrations and PowerSync...')
        child = spawn(
          command === 'infrastructure' ? 'bash' : 'pnpm',
          command === 'infrastructure' ? [path.join(ROOT, 'apps/api/script/deploy/setup-backend.sh')] : ['exec', 'wrangler', 'login'],
          {
            cwd: command === 'login' ? path.join(ROOT, 'apps/api') : ROOT,
            stdio: 'inherit',
            env: { ...process.env, ...powerSync, SLAX_API_CONFIG: options.config, ...(environment ? { SLAX_API_ENV: environment } : {}) }
          }
        )
        child.once('error', reject)
        child.once('exit', code => resolve(code ?? 1))
      })
      child = undefined
      if (interrupted) return interrupted
      if (status !== 0) {
        console.error(`${command} failed (exit ${status}); setup did not complete. Fix the error above and rerun.`)
        return status
      }
    }
    console.log('API setup complete. Start the application separately: pnpm api -- dev')
    console.log('If you selected a custom --config or --env, use the same selection when starting dev.')
    return 0
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setupApi(process.argv.slice(2))
    .then(code => {
      process.exitCode = code
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
