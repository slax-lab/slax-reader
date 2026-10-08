import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, rm, chmod, rename } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eligibility, selectors, manifestSettings, declarativeConfiguration, databaseURLs, publicIP, requireValue, ReleaseError, shaPattern } from './api-release-policy.mjs'
import { pnpmInvocation } from './pnpm-command.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url))
const stages = new Set(['policy', 'currency-start', 'selectors', 'configuration', 'remote-preflight', 'gen:all', 'lint', 'typecheck', 'test', 'build', 'currency-final', 'public-ip', 'firewall', 'tunnel', 'readiness', 'migration:deploy:pgsql', 'migration:deploy:logs', 'migration:remote:d1', 'migration:remote:fulltext', 'deploy', 'cleanup-tunnel', 'cleanup-firewall', 'cleanup-files', 'release'])
const categories = new Set(['ineligible-event', 'invalid-selectors', 'missing-secrets', 'invalid-configuration', 'invalid-database-url', 'invalid-public-ip', 'branch-lookup-failed', 'private-fetch-failed', 'repository-not-private', 'remote-api-failed', 'command-failed', 'readiness-timeout', 'tunnel-failed', 'cancelled', 'cleanup-failed', 'internal-error'])
const results = new Set(['started', 'passed', 'failed', 'superseded'])
const secretFields = new Set(['API_CONFIG_REPOSITORY', 'API_CONFIG_REF', 'API_CONFIG_MANIFEST_PATH', 'CONFIG_REPO_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_FIREWALL_API_TOKEN', 'CLOUDFLARE_TUNNEL_CLIENT_ID', 'CLOUDFLARE_TUNNEL_TOKEN', 'HYPERDRIVE_DATABASE_URL', 'LOGS_DATABASE_URL'])
export function safeReporter(write, summary = () => {}) {
  return (stage, result, error) => {
    requireValue(stages.has(stage) && results.has(result), 'internal-error')
    const category = categories.has(error?.category) ? error.category : 'internal-error'
    const exitCode = error instanceof ReleaseError ? error.exitCode : 1
    const field = secretFields.has(error?.field) ? `; field ${error.field}` : ''
    const line = `API release: ${stage}: ${result}${result === 'failed' ? ` (${category}${field}; exit ${exitCode})` : ''}`
    write(line)
    summary(line)
  }
}
const placeholders = {
  HYPERDRIVE_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/generation_only',
  LOGS_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/logs_generation_only'
}
export function childEnvironment(parent, directory, additional = {}) {
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'SystemRoot', 'PNPM_HOME', 'npm_execpath'].filter(key => parent[key]).map(key => [key, parent[key]]))
  return { ...env, CI: 'true', GITHUB_ACTIONS: 'true', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false', SLAX_API_INHERIT_PROCESS_GROUP: '1', XDG_CONFIG_HOME: join(directory, 'xdg'), XDG_CACHE_HOME: join(directory, 'cache'), WRANGLER_CACHE_DIR: join(directory, 'wrangler-cache'), WRANGLER_LOG_PATH: join(directory, 'wrangler.log'), ...additional }
}
// Drain, but never forward, raw diagnostics. Memory and execution are bounded.
export async function capturedCommand(program, args, { env, signal, timeout = 600_000, persistent = false } = {}) {
  requireValue(!signal?.aborted, 'cancelled')
  const child = spawn(program, args, { cwd: root, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  let retained = 0
  let timedOut = false
  let hardTimer
  const chunks = []
  const capture = chunk => {
    if (retained < 65536) { const part = chunk.subarray(0, 65536 - retained); chunks.push(part); retained += part.length }
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  const stop = () => {
    if (!child.pid) return
    try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM') } catch {}
  }
  const hardStop = () => {
    if (!child.pid) return
    try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL') } catch {}
  }
  const abort = () => { stop(); hardTimer = setTimeout(hardStop, 3000); hardTimer.unref() }
  signal?.addEventListener('abort', abort, { once: true })
  let timer
  if (!persistent) timer = setTimeout(() => { timedOut = true; abort() }, timeout)
  const done = new Promise((accept, reject) => {
    child.once('error', () => reject(new ReleaseError('command-failed')))
    child.once('close', code => code === 0 && !signal?.aborted && !timedOut ? accept() : reject(new ReleaseError(signal?.aborted ? 'cancelled' : 'command-failed', code)))
  }).finally(() => { clearTimeout(timer); clearTimeout(hardTimer); signal?.removeEventListener('abort', abort); chunks.length = 0 })
  if (persistent) {
    // Keep rejections observed while readiness is being checked.
    done.catch(() => {})
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', () => reject(new ReleaseError('tunnel-failed'))) })
    return { child, done, stop, hardStop }
  }
  await done
}
async function request(url, { token, method = 'GET', body, signal, json = true, allowNotFound = false } = {}) {
  const response = await fetch(url, {
    method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  if (allowNotFound && response.status === 404) { await response.body?.cancel(); return null }
  requireValue(response.ok, 'remote-api-failed')
  let size = 0
  const chunks = []
  for await (const chunk of response.body) {
    size += chunk.length
    requireValue(size <= 2_000_000, 'remote-api-failed')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return json ? JSON.parse(text) : text
}
export async function fetchConfiguration(secrets, environment, directory, { http = request, parse, mask = () => {}, signal } = {}) {
  selectors(secrets)
  const repo = `https://api.github.com/repos/${secrets.API_CONFIG_REPOSITORY}`
  const options = { token: secrets.CONFIG_REPO_TOKEN, signal }
  const metadata = await http(repo, options)
  requireValue(metadata.private === true && metadata.full_name === secrets.API_CONFIG_REPOSITORY, 'repository-not-private')
  const commit = await http(`${repo}/commits/${secrets.API_CONFIG_REF}`, options)
  requireValue(commit.sha === secrets.API_CONFIG_REF, 'private-fetch-failed')
  // Fetch just the declared data files, never scripts, key files or credentials.
  const content = async filename => {
    const file = await http(`${repo}/contents/${filename.split('/').map(encodeURIComponent).join('/')}?ref=${secrets.API_CONFIG_REF}`, options)
    requireValue(file.type === 'file' && file.path === filename && file.encoding === 'base64' && typeof file.content === 'string' && file.size > 0 && file.size <= 500_000, 'private-fetch-failed')
    return Buffer.from(file.content, 'base64').toString('utf8')
  }
  const manifest = JSON.parse(await content(secrets.API_CONFIG_MANIFEST_PATH))
  const settings = manifestSettings(manifest, environment)
  const text = await content(settings.config)
  // Also reject recognizable credential material in TOML comments.
  declarativeConfiguration({ fetchedText: text })
  const native = parse(text)
  declarativeConfiguration(native)
  mask(manifest)
  mask(native)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const config = join(directory, 'api.toml')
  const settingsFile = join(directory, 'settings.json')
  await writeFile(config, text, { mode: 0o600 })
  await writeFile(settingsFile, JSON.stringify(settings), { mode: 0o600 })
  return { settings, config, settingsFile }
}
export async function waitDatabases(urls, { connect, alive, signal, timeout = 60000, interval = 1000 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    requireValue(!signal?.aborted, 'cancelled')
    requireValue(alive(), 'tunnel-failed')
    const ready = await new Promise(accept => {
      let timer
      const finish = value => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); accept(value) }
      const aborted = () => finish([false])
      signal?.addEventListener('abort', aborted, { once: true })
      timer = setTimeout(aborted, Math.max(1, deadline - Date.now()))
      Promise.all(urls.map(async url => { try { await connect(url); return true } catch { return false } }))
        .then(finish)
    })
    if (ready.every(Boolean)) return
    await new Promise(accept => setTimeout(accept, Math.max(0, Math.min(interval, deadline - Date.now()))))
  }
  requireValue(!signal?.aborted, 'cancelled')
  throw new ReleaseError('readiness-timeout')
}
async function databaseConnect(url) {
  const { Client } = apiRequire('pg')
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000, query_timeout: 3000, statement_timeout: 3000, application_name: 'api-release-readiness' })
  client.on('error', () => {})
  try { await client.connect(); await client.query('SELECT 1') } finally { await client.end().catch(() => {}) }
}
export async function acquireFirewall(settings, ip, note, secrets, state, { http = request, save, signal } = {}) {
  const zoneURL = `https://api.cloudflare.com/client/v4/zones/${settings.firewallZoneId}`
  const options = { token: secrets.CLOUDFLARE_FIREWALL_API_TOKEN, signal }
  const zone = await http(zoneURL, options)
  requireValue(zone.success === true && zone.result?.account?.id === settings.accountId, 'remote-api-failed')
  const rulesURL = `${zoneURL}/firewall/access_rules/rules`
  const listed = await http(`${rulesURL}?configuration.target=ip&configuration.value=${ip}&mode=whitelist&per_page=100`, options)
  requireValue(listed.success === true && Array.isArray(listed.result), 'remote-api-failed')
  if (listed.result.some(rule => rule.mode === 'whitelist' && rule.configuration?.target === 'ip' && rule.configuration.value === ip)) return
  // Persist intent first: an interrupted POST can be recovered by unique notes.
  state.firewall = { zone: settings.firewallZoneId, ip, note, id: null }
  await save(state)
  const created = await http(rulesURL, { ...options, method: 'POST', body: { mode: 'whitelist', configuration: { target: 'ip', value: ip }, notes: note } })
  requireValue(created.success === true && /^[a-f0-9]{32}$/.test(created.result?.id ?? ''), 'remote-api-failed')
  state.firewall.id = created.result.id
  await save(state)
}
async function processIdentity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null
    throw new ReleaseError('cleanup-failed')
  }
}
export async function cleanup(state, { http = request, secrets, save, removeFiles, stopTunnel, report, final = false } = {}) {
  let failed = false
  const attempt = async (stage, fn) => {
    try { await fn(); report(stage, 'passed') } catch { failed = true; report(stage, 'failed', new ReleaseError('cleanup-failed')) }
  }
  await attempt('cleanup-tunnel', async () => {
    if (state.tunnel) { await stopTunnel(state.tunnel); state.tunnel = null; await save(state) }
  })
  await attempt('cleanup-firewall', async () => {
    if (!state.firewall) return
    const { zone, ip, note, id } = state.firewall
    requireValue(/^[a-f0-9]{32}$/.test(zone) && (!id || /^[a-f0-9]{32}$/.test(id)) && /^api-release:\d+:\d+$/.test(note))
    publicIP(ip)
    const url = `https://api.cloudflare.com/client/v4/zones/${zone}/firewall/access_rules/rules`
    const options = { token: secrets.CLOUDFLARE_FIREWALL_API_TOKEN }
    // Direct lookup avoids missing a known ID in a paginated/eventual list.
    const candidates = []
    if (id) {
      const found = await http(`${url}/${id}`, { ...options, allowNotFound: true })
      if (found !== null) {
        requireValue(found.success === true && found.result?.id === id && found.result.notes === note && found.result.configuration?.value === ip && found.result.configuration?.target === 'ip' && found.result.mode === 'whitelist', 'remote-api-failed')
        candidates.push(found.result)
      }
    } else {
      // Recover creation intent by exact notes, with bounded pagination.
      let pages = 1
      for (let page = 1; page <= pages; page++) {
        const listed = await http(`${url}?configuration.target=ip&configuration.value=${ip}&per_page=100&page=${page}`, options)
        requireValue(listed.success === true && Array.isArray(listed.result), 'remote-api-failed')
        pages = listed.result_info?.total_pages ?? 1
        requireValue(Number.isInteger(pages) && pages >= 1 && pages <= 10, 'remote-api-failed')
        candidates.push(...listed.result.filter(rule => rule.notes === note && rule.configuration?.value === ip && rule.configuration?.target === 'ip' && rule.mode === 'whitelist'))
      }
    }
    for (const rule of candidates) {
      requireValue(/^[a-f0-9]{32}$/.test(rule.id))
      const deleted = await http(`${url}/${rule.id}`, { ...options, method: 'DELETE' })
      requireValue(deleted.success === true, 'remote-api-failed')
    }
    state.firewall = null
    await save(state)
  })
  await attempt('cleanup-files', () => removeFiles(final || !failed))
  return !failed
}
export async function runRelease({ event, context, secrets, directory, ports, signal, report }) {
  const state = { firewall: null, tunnel: null }
  let originalFailure = false
  let superseded = false
  const supersededSignal = Symbol('superseded')
  const stage = async (name, fn) => {
    report(name, 'started')
    try { requireValue(!signal?.aborted, 'cancelled'); const value = await fn(); report(name, 'passed'); return value }
    catch (error) { report(name, 'failed', error); throw error }
  }
  try {
    const release = await stage('policy', () => eligibility(event, context))
    ports.provenance?.(release)
    const current = async () => {
      let sha
      try { sha = await ports.branchTip(release.branch) } catch { throw new ReleaseError('branch-lookup-failed') }
      requireValue(shaPattern.test(sha ?? ''), 'branch-lookup-failed')
      return sha === release.codeRef
    }
    if (!await stage('currency-start', current)) { superseded = true; report('release', 'superseded'); throw supersededSignal }
    await stage('selectors', () => {
      selectors(secrets)
      for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_FIREWALL_API_TOKEN', 'CLOUDFLARE_TUNNEL_CLIENT_ID', 'CLOUDFLARE_TUNNEL_TOKEN', 'HYPERDRIVE_DATABASE_URL', 'LOGS_DATABASE_URL']) requireValue(Boolean(secrets[key]), 'missing-secrets', key)
    })
    const { settings, config, settingsFile } = await stage('configuration', () => ports.configuration(release.environment))
    let urls
    const selected = { SLAX_API_CONFIG: config, SLAX_API_ENV: settings.wranglerEnvironment ?? '', SLAX_API_GENERATED_DIR: join(directory, 'generated') }
    const offline = { ...selected, ...placeholders }
    await stage('remote-preflight', () => {
      urls = databaseURLs(secrets, settings)
      return ports.command('release:check', { ...offline, SLAX_API_RELEASE_SETTINGS: settingsFile, SLAX_API_RELEASE_ENVIRONMENT: release.environment })
    })
    for (const name of ['gen:all', 'lint', 'typecheck', 'test', 'build']) await stage(name, () => ports.command(name, offline))
    if (!await stage('currency-final', current)) { superseded = true; report('release', 'superseded'); throw supersededSignal }
    const ip = await stage('public-ip', async () => publicIP(await ports.publicIP()))
    await stage('firewall', () => ports.firewall(settings, ip, state))
    const tunnel = await stage('tunnel', () => ports.tunnel(settings, state))
    await stage('readiness', () => ports.readiness(urls, tunnel))
    for (const name of ['migration:deploy:pgsql', 'migration:deploy:logs', 'migration:remote:d1', 'migration:remote:fulltext', 'deploy']) {
      const credentials = name === 'migration:deploy:pgsql' ? { HYPERDRIVE_DATABASE_URL: urls[0] }
        : name === 'migration:deploy:logs' ? { LOGS_DATABASE_URL: urls[1] }
          : { CLOUDFLARE_API_TOKEN: secrets.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: settings.accountId }
      await stage(name, () => ports.command(name, { ...selected, ...credentials }))
    }
  } catch (error) { if (error !== supersededSignal) originalFailure = true }
  finally {
    if (!await ports.cleanup(state)) originalFailure = true
  }
  if (!superseded) report('release', originalFailure ? 'failed' : 'passed', new ReleaseError('internal-error'))
  return !originalFailure
}
function maskPrivate(value) {
  if (value && typeof value === 'object') return Object.values(value).forEach(maskPrivate)
  if (typeof value !== 'string' || !value) return
  // Runner consumes masking commands; these are never public diagnostics.
  for (const representation of new Set([value, encodeURIComponent(value), Buffer.from(value).toString('base64')])) {
    process.stdout.write(`::add-mask::${representation.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}\n`)
  }
}
async function main() {
  const env = process.env
  requireValue(env.GITHUB_ACTIONS === 'true' && /^\d+$/.test(env.GITHUB_RUN_ID ?? '') && /^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? '') && Boolean(env.RUNNER_TEMP), 'ineligible-event')
  const directory = join(env.RUNNER_TEMP, `api-release-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`)
  const workspace = join(directory, 'private')
  const stateFile = join(directory, 'state.json')
  const summary = []
  const report = safeReporter(line => process.stdout.write(`${line}\n`), line => summary.push(line))
  const save = async state => {
    await writeFile(`${stateFile}.tmp`, JSON.stringify(state), { mode: 0o600 })
    await rename(`${stateFile}.tmp`, stateFile)
  }
  const stopTunnel = async tunnel => {
    requireValue(Number.isInteger(tunnel.pid) && tunnel.pid > 1 && typeof tunnel.start === 'string')
    const identity = await processIdentity(tunnel.pid)
    if (identity === null) return
    requireValue(identity === tunnel.start)
    try { process.kill(-tunnel.pid, 'SIGTERM') } catch (error) { if (error.code === 'ESRCH') return; throw error }
    for (let count = 0; count < 30; count++) {
      if (await processIdentity(tunnel.pid) !== tunnel.start) return
      await new Promise(accept => setTimeout(accept, 100))
    }
    try { process.kill(-tunnel.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  const removeFiles = async all => {
    const targets = [workspace, join(root, 'apps/api/worker-configuration.d.ts'), ...['apps/api/.wrangler', 'apps/api/node_modules/.cache/wrangler', 'node_modules/.cache/wrangler'].map(relative => join(root, relative))]
    const removed = await Promise.allSettled(targets.map(filename => rm(filename, { recursive: true, force: true })))
    if (all) removed.push(...await Promise.allSettled([rm(directory, { recursive: true, force: true })]))
    requireValue(removed.every(result => result.status === 'fulfilled'), 'cleanup-failed')
  }
  const cleanupPorts = { secrets: env, save, removeFiles, stopTunnel, report }
  if (process.argv[2] === 'cleanup') {
    let state
    try { state = JSON.parse(await readFile(stateFile, 'utf8')) } catch (error) {
      if (error.code === 'ENOENT') { await removeFiles(true); return }
      await removeFiles(true)
      throw new ReleaseError('cleanup-failed')
    }
    if (!await cleanup(state, { ...cleanupPorts, final: true })) process.exitCode = 1
    return
  }
  requireValue(process.argv[2] === 'run', 'ineligible-event')
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  const signal = controller.signal
  let tunnel
  const baseEnv = additional => childEnvironment(env, workspace, additional)
  try {
    const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'))
    const context = { eventName: env.GITHUB_EVENT_NAME, repository: env.GITHUB_REPOSITORY, environment: env.RELEASE_ENVIRONMENT, codeRef: env.RELEASE_CODE_REF }
    // Repeat eligibility before touching any private bootstrap value.
    eligibility(event, context)
    for (const key of ['API_CONFIG_REPOSITORY', 'API_CONFIG_REF', 'API_CONFIG_MANIFEST_PATH', 'CONFIG_REPO_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_FIREWALL_API_TOKEN', 'CLOUDFLARE_TUNNEL_CLIENT_ID', 'CLOUDFLARE_TUNNEL_TOKEN', 'HYPERDRIVE_DATABASE_URL', 'LOGS_DATABASE_URL']) maskPrivate(env[key])
    const ports = {
      provenance: release => {
        const line = `API release source: PR #${release.number}; ${release.environment}; ${release.codeRef}`
        process.stdout.write(`${line}\n`)
        summary.push(line)
      },
      branchTip: async branch => (await request(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/git/ref/heads/${branch}`, { token: env.GH_TOKEN, signal })).object?.sha,
      configuration: environment => fetchConfiguration(env, environment, workspace, { parse: apiRequire('smol-toml').parse, mask: maskPrivate, signal }),
      command: (command, additional) => {
        const invocation = pnpmInvocation(['api', '--', command], { env: baseEnv(additional) })
        return capturedCommand(invocation.program, invocation.args, { env: baseEnv(additional), signal })
      },
      publicIP: async () => (await request('https://api.ipify.org', { json: false, signal })).trim(),
      firewall: (settings, ip, state) => acquireFirewall(settings, ip, `api-release:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}`, env, state, { save, signal }),
      tunnel: async (settings, state) => {
        tunnel = await capturedCommand('/usr/local/bin/cloudflared', ['access', 'tcp'], { persistent: true, signal, env: baseEnv({ TUNNEL_SERVICE_HOSTNAME: settings.tunnel.hostname, TUNNEL_SERVICE_URL: `127.0.0.1:${settings.tunnel.port}`, TUNNEL_SERVICE_TOKEN_ID: env.CLOUDFLARE_TUNNEL_CLIENT_ID, TUNNEL_SERVICE_TOKEN_SECRET: env.CLOUDFLARE_TUNNEL_TOKEN }) })
        const start = await processIdentity(tunnel.child.pid)
        if (!start) { tunnel.stop(); throw new ReleaseError('tunnel-failed') }
        state.tunnel = { pid: tunnel.child.pid, start }
        await save(state)
        return tunnel
      },
      readiness: (urls, active) => waitDatabases(urls, { connect: databaseConnect, alive: () => active.child.exitCode === null && active.child.signalCode === null, signal }),
      cleanup: state => cleanup(state, cleanupPorts)
    }
    if (!await runRelease({ event, context, secrets: env, directory: workspace, ports, signal, report })) process.exitCode = 1
  } finally {
    tunnel?.stop()
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
    if (env.GITHUB_STEP_SUMMARY) await writeFile(env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`, { flag: 'a' }).catch(() => { process.exitCode = 1 })
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('API release: release: failed (internal-error; exit 1)\n'); process.exitCode = 1 })
}
