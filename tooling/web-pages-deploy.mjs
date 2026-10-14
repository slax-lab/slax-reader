import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { existsSync, lstatSync, readdirSync, readFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync, openSync, closeSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { pnpmInvocation } from './pnpm-command.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const profiles = { dev: 'preview', beta: 'beta', main: 'production' }
const required = ['PUBLIC_BASE_URL', 'AUTH_BASE_URL', 'SHARE_BASE_URL', 'DWEB_API_BASE_URL', 'COOKIE_DOMAIN', 'COOKIE_TOKEN_NAME', 'GOOGLE_OAUTH_CLIENT_ID']
const cleanEnvironment = env => Object.fromEntries(['PATH', 'HOME', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP', 'npm_execpath', 'PNPM_HOME'].filter(key => env[key] !== undefined).map(key => [key, env[key]]))
const failure = message => new Error(message)

export function releaseInputs(env, needsToken = false) {
  if (!Object.hasOwn(profiles, env.TARGET_BRANCH)) throw failure('Invalid TARGET_BRANCH')
  if (!/^[a-f0-9]{40}$/.test(env.MERGE_SHA || '')) throw failure('Invalid MERGE_SHA')
  if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '')) throw failure('Missing or invalid CLOUDFLARE_ACCOUNT_ID')
  if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(env.PAGES_PROJECT_NAME || '')) throw failure('Missing or invalid PAGES_PROJECT_NAME')
  if (needsToken && (!env.CLOUDFLARE_API_TOKEN?.trim() || /\s/.test(env.CLOUDFLARE_API_TOKEN))) throw failure('Missing or invalid CLOUDFLARE_API_TOKEN')
  if (needsToken && !/^[a-f0-9]{32}$/.test(env.CF_ZONE_ID || '')) throw failure('Missing or invalid CF_ZONE_ID')
  const hosts = { dev: 'r.slax.dev', beta: 'r-beta.slax.com', main: 'r.slax.com' }
  return { profile: profiles[env.TARGET_BRANCH], account: env.CLOUDFLARE_ACCOUNT_ID, project: env.PAGES_PROJECT_NAME, sha: env.MERGE_SHA, token: needsToken ? env.CLOUDFLARE_API_TOKEN : undefined, zone: needsToken ? env.CF_ZONE_ID : undefined, host: hosts[env.TARGET_BRANCH] }
}

export async function validateBuildConfig(text) {
  let values
  try { values = JSON.parse(text) } catch { throw failure('Missing or invalid WEB_BUILD_CONFIG JSON') }
  if (!values || Array.isArray(values) || typeof values !== 'object') throw failure('Invalid WEB_BUILD_CONFIG object')
  const { createJiti } = webRequire('jiti')
  const { dwebEnvSchema } = await createJiti(import.meta.url, { fsCache: false }).import(join(root, 'apps/web/env.schema.ts'))
  const keys = Object.keys(dwebEnvSchema.shape)
  if (Object.keys(values).some(key => !keys.includes(key))) throw failure('WEB_BUILD_CONFIG contains unsupported keys')
  if (Object.values(values).some(value => typeof value !== 'string' || /[\r\n\0]/.test(value))) throw failure('WEB_BUILD_CONFIG values must be single-line strings')
  for (const key of required) if (!values[key]?.trim()) throw failure(`WEB_BUILD_CONFIG requires ${key}`)
  for (const key of keys) if (!required.includes(key) && values[key] === '') delete values[key]
  const parsed = dwebEnvSchema.strict().safeParse(values)
  if (!parsed.success) throw failure('WEB_BUILD_CONFIG does not match the public Web schema')
  for (const key of ['PUBLIC_BASE_URL', 'AUTH_BASE_URL', 'SHARE_BASE_URL', 'DWEB_API_BASE_URL']) {
    let url
    try { url = new URL(values[key]) } catch { throw failure(`Invalid WEB_BUILD_CONFIG ${key}`) }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw failure(`Invalid WEB_BUILD_CONFIG ${key}`)
  }
  return parsed.data
}

export function runCommand(program, args, { cwd, env, signal, logPath, timeout = 20 * 60_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const fd = logPath ? openSync(logPath, 'w', 0o600) : undefined
    const grouped = process.platform !== 'win32'
    let child
    try { child = spawn(program, args, { cwd, env, stdio: fd === undefined ? 'inherit' : ['ignore', fd, fd], shell: false, detached: grouped }) }
    catch { if (fd !== undefined) closeSync(fd); reject(failure('Could not start release subprocess')); return }
    let aborted = false
    let killTimer
    const kill = sig => {
      if (!child.pid) return
      try { grouped ? process.kill(-child.pid, sig) : child.kill(sig) } catch {}
    }
    const stop = () => {
      if (aborted) return
      aborted = true
      kill('SIGTERM')
      killTimer = setTimeout(() => kill('SIGKILL'), 3000)
    }
    const timer = setTimeout(stop, timeout)
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) stop()
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', stop)
      if (fd !== undefined) closeSync(fd)
    }
    child.once('error', () => { cleanup(); reject(failure('Could not start release subprocess')) })
    child.once('close', (code, sig) => {
      cleanup()
      if (aborted || sig) reject(failure('Release subprocess interrupted or timed out'))
      else if (code !== 0) reject(failure(`Release subprocess failed (exit ${code})`))
      else resolvePromise()
    })
  })
}

export async function buildWeb(env = process.env, { run = runCommand, signal } = {}) {
  const inputs = releaseInputs(env)
  const config = await validateBuildConfig(env.WEB_BUILD_CONFIG)
  const childEnv = { ...cleanEnvironment(env), ...config, SLAX_ENV: inputs.profile, CI: 'true', NUXT_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' }
  const invocation = pnpmInvocation(['web', '--', 'build'], { env: childEnv })
  await run(invocation.program, invocation.args, { cwd: root, env: childEnv, signal })
}

export async function cloudflareGet(inputs, suffix = '', { fetchImpl = fetch, signal } = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${inputs.account}/pages/projects/${inputs.project}${suffix}`
  let response
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${inputs.token}` }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) })
  } catch { throw failure('Pages API request failed or timed out; response withheld') }
  if (!response.ok) throw failure(`Pages API request failed (HTTP ${response.status}); response withheld`)
  let body
  try { body = await response.json() } catch { throw failure('Invalid Pages API response; response withheld') }
  if (!body?.success || !body.result) throw failure('Pages API rejected request; response withheld')
  return body.result
}

export function inspectProject(project, expectedName) {
  if (project.name !== expectedName) throw failure('Pages project identity mismatch')
  const branch = project.production_branch
  if (typeof branch !== 'string' || !branch.trim() || branch.length > 255 || /[\s\0]/.test(branch) || branch.startsWith('-')) throw failure('Pages production branch is unavailable or invalid')
  const config = project.deployment_configs?.production
  if (!config?.services?.BACKEND?.service || config.services.BACKEND.entrypoint !== 'ContentEntry') throw failure('Pages production requires BACKEND with ContentEntry')
  if (!config.r2_buckets?.OSS?.name) throw failure('Pages production requires OSS R2 binding')
  return branch
}

function forbidden(name) {
  return /^(?:wrangler(?:\.|$)|\.wrangler$|\.env(?:\.|$)|\.dev\.vars(?:\.|$)|\.git$|node_modules$|\.DS_Store$|nitro\.json$|package(?:-lock)?\.json$|credentials(?:\.|$)|id_(?:rsa|ed25519)(?:\.|$))/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name)
}

export function assertConfigFree(directory) {
  let current = realpathSync(directory)
  while (true) {
    for (const name of ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc', '.wrangler/deploy/config.json']) {
      if (existsSync(join(current, name))) throw failure('Deployment staging can discover a Wrangler configuration')
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

export function stageBuild(source, destination) {
  const copy = (from, to) => {
    if (lstatSync(from).isSymbolicLink()) throw failure('Build contains a symbolic link')
    mkdirSync(to, { recursive: true, mode: 0o700 })
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (forbidden(entry.name)) continue
      if (entry.isSymbolicLink()) throw failure('Build contains a symbolic link')
      const input = join(from, entry.name)
      const output = join(to, entry.name)
      if (entry.isDirectory()) copy(input, output)
      else if (entry.isFile()) copyFileSync(input, output)
      else throw failure('Build contains a non-regular file')
    }
  }
  try {
    if (!existsSync(source)) throw failure('Web build output is missing')
    copy(source, destination)
    for (const file of ['_worker.js/index.js', 'index.html', '_routes.json']) if (!existsSync(join(destination, file))) throw failure('Incomplete Pages build output')
    const routes = JSON.parse(readFileSync(join(destination, '_routes.json'), 'utf8'))
    if (routes.version !== 1 || !Array.isArray(routes.include) || !Array.isArray(routes.exclude)) throw failure('Invalid Pages routes output')
    assertConfigFree(destination)
  } catch (error) {
    rmSync(destination, { recursive: true, force: true })
    throw failure(error.message.startsWith('Build contains') || error.message.includes('Pages') || error.message.includes('Wrangler') ? error.message : 'Could not stage Web build output')
  }
  return destination
}

export function deploymentId(filename, projectName) {
  let rows
  try { rows = readFileSync(filename, 'utf8').trim().split('\n').map(line => JSON.parse(line)) } catch { throw failure('Wrangler did not report a deployment ID') }
  const result = rows.findLast(row => row.type === 'pages-deploy' && row.version === 1 && row.pages_project === projectName)
  if (!/^[a-f0-9-]{36}$/.test(result?.deployment_id || '')) throw failure('Wrangler did not report a valid deployment ID')
  return result.deployment_id
}

export async function confirmDeployment(inputs, id, branch, { fetchImpl = fetch, signal, attempts = 30, interval = 2000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const deployment = await cloudflareGet(inputs, `/deployments/${id}`, { fetchImpl, signal })
    if (deployment.id !== id || deployment.environment !== 'production' || deployment.deployment_trigger?.metadata?.commit_hash !== inputs.sha || deployment.deployment_trigger?.metadata?.branch !== branch) throw failure('Pages deployment identity mismatch')
    const stage = deployment.latest_stage
    if (['failure', 'canceled', 'cancelled'].includes(stage?.status)) throw failure('Pages final deployment failed')
    if (stage?.name === 'deploy' && stage.status === 'success') return
    await delay(interval, undefined, { signal })
  }
  throw failure('Pages final deployment status timed out')
}

export async function deployWeb(env = process.env, { source = join(root, 'apps/web/dist'), run = runCommand, fetchImpl = fetch, signal, temporaryRoot = tmpdir(), wrangler = join(dirname(webRequire.resolve('wrangler/package.json')), 'bin/wrangler.js'), attempts, interval } = {}) {
  const inputs = releaseInputs(env, true)
  await validateBuildConfig(env.WEB_BUILD_CONFIG)
  const project = await cloudflareGet(inputs, '', { fetchImpl, signal })
  const branch = inspectProject(project, inputs.project)
  const temporary = mkdtempSync(join(temporaryRoot, 'slax-web-pages-'))
  try {
    assertConfigFree(temporary)
    const assets = stageBuild(source, join(temporary, 'assets'))
    const report = join(temporary, 'wrangler-output.jsonl')
    const childEnv = {
      ...cleanEnvironment(env), CI: 'true',
      HOME: temporary, XDG_CONFIG_HOME: join(temporary, 'config'), XDG_CACHE_HOME: join(temporary, 'cache'),
      CLOUDFLARE_ACCOUNT_ID: inputs.account, CLOUDFLARE_API_TOKEN: inputs.token,
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
      WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(temporary, 'wrangler.log'), WRANGLER_OUTPUT_FILE_PATH: report
    }
    await run(process.execPath, [wrangler, 'pages', 'deploy', assets, '--no-bundle', '--project-name', inputs.project, '--branch', branch, '--commit-hash', inputs.sha, '--commit-dirty=false'], { cwd: temporary, env: childEnv, signal, logPath: join(temporary, 'upload.log'), timeout: 10 * 60_000 })
    await confirmDeployment(inputs, deploymentId(report, inputs.project), branch, { fetchImpl, signal, attempts, interval })
    await purgeCache(inputs, { fetchImpl, signal })
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}

export async function purgeCache(inputs, { fetchImpl = fetch, signal } = {}) {
  let response
  try {
    response = await fetchImpl(`https://api.cloudflare.com/client/v4/zones/${inputs.zone}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${inputs.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hosts: [inputs.host] }),
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
    })
  } catch { throw failure('Cache purge request failed or timed out; response withheld') }
  if (!response.ok) throw failure(`Cache purge failed (HTTP ${response.status}); response withheld`)
  let body
  try { body = await response.json() } catch { throw failure('Invalid cache purge response; response withheld') }
  if (body?.success !== true) throw failure('Cache purge rejected; response withheld')
  console.log(`Cloudflare accepted cache purge for ${inputs.host}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController()
  let interrupted
  const stop = signal => { interrupted = signal; controller.abort() }
  const interrupt = () => stop('SIGINT')
  const terminate = () => stop('SIGTERM')
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  try {
    const mode = process.argv[2]
    if (mode === 'build') await buildWeb(process.env, { signal: controller.signal })
    else if (mode === 'deploy') await deployWeb(process.env, { signal: controller.signal })
    else throw failure('Usage: node tooling/web-pages-deploy.mjs <build|deploy>')
    console.log(`Web Pages ${mode} passed`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = interrupted ? 128 + constants.signals[interrupted] : 1
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
  }
}
