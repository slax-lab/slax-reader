import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { eligibility, selectors, manifestSettings, declarativeConfiguration, databaseURLs, publicIP, ReleaseError } from './api-release-policy.mjs'
import { runRelease, safeReporter, childEnvironment, capturedCommand, fetchConfiguration, waitDatabases, acquireFirewall, cleanup } from './api-release.mjs'

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { parse, stringify } = apiRequire('smol-toml')
const { parse: yaml } = createRequire(realpathSync(new URL('../node_modules/@fission-ai/openspec/package.json', import.meta.url)))('yaml')
const publicSHA = 'a'.repeat(40)
const privateSHA = 'b'.repeat(40)
const event = branch => ({ action: 'closed', repository: { full_name: 'example/public' }, pull_request: { number: 7, merged: true, merge_commit_sha: publicSHA, base: { ref: branch, repo: { full_name: 'example/public' } }, head: { sha: 'c'.repeat(40), repo: { full_name: 'contributor/fork' } } } })
const context = branch => ({ eventName: 'pull_request_target', repository: 'example/public', environment: branch === 'main' ? 'prod' : branch, codeRef: publicSHA })
const settings = () => ({ config: 'private-config/api.toml', accountId: '1'.repeat(32), firewallZoneId: '2'.repeat(32), tunnel: { hostname: 'database.example.com', port: 15432 }, workers: { core: 'synthetic-core', edge: 'synthetic-edge', ai: 'synthetic-ai', browser: 'synthetic-browser' } })
const manifest = () => ({ version: 1, environments: { dev: settings(), beta: settings(), prod: settings() } })
const secrets = () => ({ API_CONFIG_REPOSITORY: 'synthetic/private-config', API_CONFIG_REF: privateSHA, API_CONFIG_MANIFEST_PATH: 'private-config/releases.json', CONFIG_REPO_TOKEN: 'sentinel-config-token', CLOUDFLARE_API_TOKEN: 'sentinel-deploy-token', CLOUDFLARE_FIREWALL_API_TOKEN: 'sentinel-firewall-token', CLOUDFLARE_TUNNEL_CLIENT_ID: 'sentinel-access-id', CLOUDFLARE_TUNNEL_TOKEN: 'sentinel-access-secret', HYPERDRIVE_DATABASE_URL: 'postgresql://synthetic:sentinel-password@127.0.0.1:15432/primary', LOGS_DATABASE_URL: 'postgresql://synthetic:sentinel-password@127.0.0.1:15432/logs' })
const variants = value => [value, encodeURIComponent(value), Buffer.from(value).toString('base64')]
const leak = [...Object.values(secrets()), settings().tunnel.hostname, ...Object.values(settings().workers), settings().accountId, settings().firewallZoneId, settings().config].flatMap(variants).join('\n') + '\n::error::private\n::set-output name=private::private'

test('only merged target events qualify, including forks and main in dev event context', () => {
  for (const branch of ['dev', 'beta', 'main']) assert.equal(eligibility(event(branch), { ...context(branch), ref: 'refs/heads/dev', sha: 'd'.repeat(40) }).branch, branch)
  const cases = [
    [event('dev'), { ...context('dev'), eventName: 'push' }],
    [event('dev'), { ...context('dev'), eventName: 'workflow_dispatch' }],
    [{ ...event('dev'), action: 'opened' }, context('dev')],
    [{ ...event('dev'), pull_request: { ...event('dev').pull_request, merged: false } }, context('dev')],
    [{ ...event('dev'), pull_request: { ...event('dev').pull_request, merged: 'true' } }, context('dev')],
    [event('dev'), { ...context('dev'), codeRef: 'c'.repeat(40) }],
    [event('dev'), { ...context('dev'), environment: 'prod' }],
    [event('other'), context('dev')],
    [event('dev'), { ...context('dev'), repository: 'elsewhere/public' }],
    [{}, context('dev')], [null, context('dev')]
  ]
  for (const [payload, details] of cases) assert.throws(() => eligibility(payload, details), /ineligible-event/)
})

test('private selectors and manifest reject mutable, escaping, executable or inconsistent data', () => {
  selectors(secrets())
  for (const override of [{ API_CONFIG_REF: 'main' }, { API_CONFIG_REPOSITORY: 'https://example.com/repo' }, { API_CONFIG_MANIFEST_PATH: '../outside.json' }, { API_CONFIG_MANIFEST_PATH: 'x.json\n::error::private' }, { CONFIG_REPO_TOKEN: '' }]) assert.throws(() => selectors({ ...secrets(), ...override }))
  assert.deepEqual(manifestSettings(manifest(), 'dev'), settings())
  for (const mutate of [s => { s.config = '../api.toml' }, s => { s.config = '.env.toml' }, s => { s.wranglerEnvironment = 'a\nb' }, s => { s.tunnel.hostname = 'https://database.example.com/pgsql' }, s => { s.tunnel.port = 0 }, s => { s.accountId = '' }, s => { s.credentials = 'private' }, s => { delete s.workers.edge }]) {
    const value = manifest(); mutate(value.environments.dev)
    assert.throws(() => manifestSettings(value, 'dev'))
  }
  const value = manifest(); value.environments.beta.accountId = '3'.repeat(32)
  assert.throws(() => manifestSettings(value, 'prod'))
  for (const native of [{ build: { command: 'exec private' } }, { vars: { API_TOKEN: 'private' } }, { hyperdrive: [{ localConnectionString: 'postgresql://user:private@host/db' }] }, { vars: { UNKNOWN: '-----BEGIN PRIVATE KEY-----' } }, { vars: { UNKNOWN: 'https://user:private@example.com/' } }, { vars: { UNKNOWN: 'Bearer synthetic-secret' } }, { vars: { UNKNOWN: 'https://api.example.com/?key=synthetic-secret' } }, { vars: { UNKNOWN: '{"client_secret":"synthetic-secret"}' } }]) assert.throws(() => declarativeConfiguration(native))
  assert.equal(databaseURLs(secrets(), settings()).length, 2)
  for (const url of ['postgresql://u:p@other.example.com:15432/db', 'postgresql://u:p@127.0.0.1:5432/db', 'postgresql://u:p@127.0.0.1:15432/db?host=other', 'malformed']) assert.throws(() => databaseURLs({ ...secrets(), LOGS_DATABASE_URL: url }, settings()))
})

function harness({ fail, staleAt, cleanupFail = false, controller = new AbortController(), branch = 'dev' } = {}) {
  const trace = [], logs = [], summaries = [], commands = []
  let lookup = 0
  const invoke = async (name, value) => { trace.push(name); if (name === fail) throw new Error(leak); return value }
  const ports = {
    provenance: value => logs.push(`public source ${value.codeRef}`),
    branchTip: async () => { lookup++; await invoke(`lookup-${lookup}`); return lookup === staleAt ? 'd'.repeat(40) : publicSHA },
    configuration: () => invoke('configuration', { settings: settings(), config: '/synthetic/private/api.toml', settingsFile: '/synthetic/private/settings.json' }),
    command: async (name, env) => { commands.push({ name, env }); await invoke(name); if (name === 'build' && fail === 'cancel') controller.abort() },
    publicIP: () => invoke('public-ip', '8.8.8.8'),
    firewall: async (value, ip, state) => { state.firewall = { id: '3'.repeat(32) }; await invoke('firewall') },
    tunnel: async (value, state) => { state.tunnel = { pid: 1234 }; return invoke('tunnel', {}) },
    readiness: () => invoke('readiness'),
    cleanup: async state => { trace.push('cleanup'); logs.push(`owned cleanup ${Boolean(state.firewall)} ${Boolean(state.tunnel)}`); return !cleanupFail }
  }
  const run = overrides => runRelease({ event: event(branch), context: context(branch), secrets: secrets(), directory: '/synthetic/private', ports, signal: controller.signal, report: safeReporter(line => logs.push(line), line => summaries.push(line)), ...overrides })
  return { run, trace, logs, summaries, commands, ports }
}
function privateAbsent(outputs) {
  for (const sentinel of [...Object.values(secrets()), settings().config, settings().tunnel.hostname, ...Object.values(settings().workers), settings().accountId, settings().firewallZoneId].flatMap(variants)) assert.equal(outputs.includes(sentinel), false, `private value reached public output`)
  assert.equal(outputs.includes('::error::'), false)
  assert.equal(outputs.includes('::set-output'), false)
}
test('complete release validates before access, migrates in order and scopes credentials', async () => {
  const h = harness({ branch: 'main' })
  assert.equal(await h.run(), true)
  assert.deepEqual(h.trace, ['lookup-1', 'configuration', 'release:check', 'gen:all', 'lint', 'typecheck', 'test', 'build', 'lookup-2', 'public-ip', 'firewall', 'tunnel', 'readiness', 'migration:deploy:pgsql', 'migration:deploy:logs', 'migration:remote:d1', 'migration:remote:fulltext', 'deploy', 'cleanup'])
  for (const { name, env } of h.commands) {
    assert.equal(env.CONFIG_REPO_TOKEN, undefined)
    assert.equal(env.CLOUDFLARE_FIREWALL_API_TOKEN, undefined)
    if (name.includes('pgsql')) { assert.equal(env.HYPERDRIVE_DATABASE_URL, secrets().HYPERDRIVE_DATABASE_URL); assert.equal(env.LOGS_DATABASE_URL, undefined); assert.equal(env.CLOUDFLARE_API_TOKEN, undefined) }
    else if (name.includes('logs')) { assert.equal(env.LOGS_DATABASE_URL, secrets().LOGS_DATABASE_URL); assert.equal(env.HYPERDRIVE_DATABASE_URL, undefined); assert.equal(env.CLOUDFLARE_API_TOKEN, undefined) }
    else if (name.startsWith('migration:remote') || name === 'deploy') { assert.equal(env.CLOUDFLARE_API_TOKEN, secrets().CLOUDFLARE_API_TOKEN); assert.equal(env.HYPERDRIVE_DATABASE_URL, undefined) }
    else { assert.equal(env.CLOUDFLARE_API_TOKEN, undefined); assert.match(env.HYPERDRIVE_DATABASE_URL, /generation_only/) }
  }
  privateAbsent([...h.logs, ...h.summaries].join('\n'))
  assert.ok(h.logs.join('\n').includes(publicSHA))
})
test('every failure and cancellation stops later operations without publishing private diagnostics', async () => {
  for (const fail of ['lookup-1', 'configuration', 'release:check', 'gen:all', 'lint', 'typecheck', 'test', 'build', 'lookup-2', 'public-ip', 'firewall', 'tunnel', 'readiness', 'migration:deploy:pgsql', 'migration:deploy:logs', 'migration:remote:d1', 'migration:remote:fulltext', 'deploy', 'cancel']) {
    const h = harness({ fail })
    assert.equal(await h.run(), false, fail)
    assert.equal(h.trace.at(-1), 'cleanup')
    if (!['deploy'].includes(fail)) assert.equal(h.trace.includes('deploy'), false, fail)
    if (['configuration', 'gen:all', 'build', 'lookup-2', 'cancel'].includes(fail)) assert.equal(h.trace.includes('firewall'), false)
    privateAbsent([...h.logs, ...h.summaries].join('\n'))
  }
  for (const staleAt of [1, 2]) {
    const h = harness({ staleAt }); assert.equal(await h.run(), true); assert.equal(h.trace.includes('firewall'), false); assert.ok(h.logs.some(line => line.includes('superseded')))
    const failing = harness({ staleAt, cleanupFail: true }); assert.equal(await failing.run(), false)
  }
  const missing = harness(); assert.equal(await missing.run({ secrets: {} }), false); assert.equal(missing.trace.includes('configuration'), false)
  const forged = harness(); assert.equal(await forged.run({ event: {} }), false); assert.deepEqual(forged.trace, ['cleanup'])
})

test('private fetch verifies private status and commit, fetches only contained data, persists no tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'api-release-test-'))
  const requested = []
  const native = { name: 'synthetic-core', account_id: '1'.repeat(32), vars: { RUN_TYPE: 'dev' } }
  const http = async (url, options) => {
    requested.push(url); assert.equal(options.token, secrets().CONFIG_REPO_TOKEN)
    if (url.includes('/commits/')) return { sha: privateSHA, commit: { message: leak } }
    if (url.includes('/contents/')) {
      const filename = url.includes('releases.json') ? secrets().API_CONFIG_MANIFEST_PATH : settings().config
      const content = filename.endsWith('.json') ? JSON.stringify(manifest()) : stringify(native)
      return { type: 'file', path: filename, encoding: 'base64', size: content.length, content: Buffer.from(content).toString('base64') }
    }
    return { private: true, full_name: secrets().API_CONFIG_REPOSITORY }
  }
  try {
    await fetchConfiguration(secrets(), 'dev', directory, { http, parse })
    assert.equal(requested.length, 4)
    assert.deepEqual((await readdir(directory)).sort(), ['api.toml', 'settings.json'])
    assert.equal((await stat(join(directory, 'api.toml'))).mode & 0o777, 0o600)
    assert.equal((await readFile(join(directory, 'api.toml'), 'utf8')).includes(secrets().CONFIG_REPO_TOKEN), false)
    for (const metadata of [{ private: false }, {}, { private: true, full_name: 'other/repo' }]) {
      let calls = 0
      await assert.rejects(fetchConfiguration(secrets(), 'dev', directory, { parse, http: async () => { calls++; return metadata } }), /repository-not-private/)
      assert.equal(calls, 1)
    }
    await assert.rejects(fetchConfiguration(secrets(), 'dev', directory, { parse, http: async url => url.includes('/commits/') ? { sha: publicSHA } : { private: true, full_name: secrets().API_CONFIG_REPOSITORY } }), /private-fetch-failed/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('authenticated readiness requires both databases and has bounded failure and process checks', async () => {
  const urls = ['synthetic-primary', 'synthetic-logs'], checked = []
  let attempts = 0
  await waitDatabases(urls, { alive: () => true, interval: 1, timeout: 100, connect: async url => { checked.push(url); if (url === urls[1] && attempts++ === 0) throw new Error(leak) } })
  assert.ok(checked.filter(value => value === urls[0]).length >= 2)
  await assert.rejects(waitDatabases(urls, { alive: () => true, connect: async () => { throw new Error(leak) }, timeout: 5, interval: 1 }), /readiness-timeout/)
  await assert.rejects(waitDatabases(urls, { alive: () => false, connect: async () => {}, timeout: 5, interval: 1 }), /tunnel-failed/)
  await assert.rejects(waitDatabases(urls, { alive: () => true, connect: () => new Promise(() => {}), timeout: 5, interval: 1 }), /readiness-timeout/)
})

test('firewall owns only newly created access and recovers interrupted requests safely', async () => {
  const state = {}, trace = [], id = '3'.repeat(32), note = 'api-release:123:1'
  const existing = { id, mode: 'whitelist', configuration: { target: 'ip', value: '8.8.8.8' }, notes: 'preexisting' }
  const http = async (url, options) => {
    trace.push(options.method ?? 'GET')
    if (!url.includes('access_rules')) return { success: true, result: { account: { id: settings().accountId } } }
    return options.method === 'POST' ? { success: true, result: { id } } : { success: true, result: [] }
  }
  await acquireFirewall(settings(), '8.8.8.8', note, secrets(), state, { http, save: async () => {} })
  assert.equal(state.firewall.id, id)
  const reused = {}
  await acquireFirewall(settings(), '8.8.8.8', note, secrets(), reused, { save: async () => {}, http: async url => url.includes('access_rules') ? { success: true, result: [existing] } : { success: true, result: { account: { id: settings().accountId } } } })
  assert.equal(reused.firewall, undefined)
  const deletions = [], cleanLogs = []
  const ports = { secrets: secrets(), report: safeReporter(line => cleanLogs.push(line)), save: async () => {}, removeFiles: async () => {}, stopTunnel: async () => {}, http: async (url, options) => {
    if (options.method === 'DELETE') { deletions.push(url); return { success: true } }
    return { success: true, result: [existing, { ...existing, id: '4'.repeat(32), notes: note }] }
  } }
  assert.equal(await cleanup({ firewall: { ...state.firewall, id: null }, tunnel: { pid: 123 } }, ports), true)
  assert.equal(deletions.length, 1)
  assert.match(deletions[0], new RegExp('4'.repeat(32)))
  assert.equal(await cleanup({ firewall: state.firewall }, { ...ports, http: async (url, options) => options.method === 'DELETE' ? { success: true } : { success: true, result: { ...existing, notes: note } } }), true)
  assert.equal(await cleanup({ firewall: state.firewall }, { ...ports, http: async () => null }), true)
  let removed = false
  assert.equal(await cleanup({ firewall: state.firewall, tunnel: { pid: 123 } }, { ...ports, stopTunnel: async () => { throw new Error(leak) }, http: async () => { throw new Error(leak) }, removeFiles: async () => { removed = true } }), false)
  assert.equal(removed, true)
  privateAbsent(cleanLogs.join('\n'))
  await assert.rejects(acquireFirewall(settings(), '8.8.8.8', note, secrets(), {}, { save: async () => {}, http: async () => ({ success: false, errors: [leak] }) }), /remote-api-failed/)
  for (const ip of ['not-ip', '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '255.255.255.255']) assert.throws(() => publicIP(ip))
})

test('capture fails on timeout, cancellation and a missing executable', async () => {
  await assert.rejects(capturedCommand(process.execPath, ['-e', "process.on('SIGTERM', () => process.exit(0));setInterval(() => {}, 1000)"], { env: {}, timeout: 200 }), /command-failed/)
  const controller = new AbortController()
  const command = capturedCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env: {}, signal: controller.signal })
  const timer = setTimeout(() => controller.abort(), 50)
  try { await assert.rejects(command, /cancelled/) } finally { clearTimeout(timer) }
  await assert.rejects(capturedCommand('/synthetic/nonexistent/cloudflared', [], { env: {}, persistent: true }), /tunnel-failed/)
})

test('private HTTP/parse failures and successful storage stay off public surfaces and are removed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'api-release-private-test-'))
  const native = { name: settings().workers.core, account_id: settings().accountId, vars: { RUN_TYPE: 'dev' } }
  try {
    for (const failure of ['metadata', 'commit', 'manifest', 'native', null]) {
      const h = harness()
      h.ports.configuration = () => fetchConfiguration(secrets(), 'dev', directory, { parse, http: async url => {
        const phase = url.includes('/commits/') ? 'commit' : url.includes('/contents/') ? (url.includes('.json?') ? 'manifest' : 'native') : 'metadata'
        if (failure === phase) throw new Error(leak)
        if (phase === 'metadata') return { private: true, full_name: secrets().API_CONFIG_REPOSITORY }
        if (phase === 'commit') return { sha: privateSHA, commit: { message: leak } }
        const content = phase === 'manifest' ? JSON.stringify(manifest()) : stringify(native)
        return { type: 'file', path: phase === 'manifest' ? secrets().API_CONFIG_MANIFEST_PATH : settings().config, encoding: 'base64', size: content.length, content: Buffer.from(content).toString('base64') }
      } })
      h.ports.cleanup = async () => {
        const files = await readdir(directory)
        for (const file of files) {
          const content = await readFile(join(directory, file), 'utf8')
          for (const key of ['CONFIG_REPO_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_TUNNEL_TOKEN', 'HYPERDRIVE_DATABASE_URL', 'LOGS_DATABASE_URL']) assert.equal(content.includes(secrets()[key]), false)
          await rm(join(directory, file))
        }
        return true
      }
      assert.equal(await h.run(), failure === null)
      assert.deepEqual(await readdir(directory), [])
      privateAbsent([...h.logs, ...h.summaries].join('\n'))
    }
    const h = harness()
    h.ports.configuration = () => fetchConfiguration(secrets(), 'dev', directory, { parse, http: async url => {
      if (!url.includes('/contents/') && !url.includes('/commits/')) return { private: true, full_name: secrets().API_CONFIG_REPOSITORY }
      if (url.includes('/commits/')) return { sha: privateSHA }
      return { type: 'file', path: secrets().API_CONFIG_MANIFEST_PATH, encoding: 'base64', size: 100, content: Buffer.from(leak).toString('base64') }
    } })
    assert.equal(await h.run(), false)
    privateAbsent([...h.logs, ...h.summaries].join('\n'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('actual subprocess capture drains private stdout/stderr and injection without forwarding', async () => {
  const isolated = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { capturedCommand } from './tooling/api-release.mjs';
    for (const code of [0, 9]) {
      let failed = false;
      try { await capturedCommand(process.execPath, ['-e', 'process.stdout.write(process.env.SYNTHETIC);process.stderr.write(process.env.SYNTHETIC);process.exit(Number(process.env.EXIT))'], { env: { SYNTHETIC: process.env.SYNTHETIC, EXIT: String(code) } }); }
      catch { failed = true; }
      if (failed !== Boolean(code)) process.exit(2);
    }
  `], { cwd: new URL('../', import.meta.url), env: { SYNTHETIC: leak.repeat(100) }, encoding: 'utf8' })
  assert.equal(isolated.status, 0)
  assert.equal(isolated.stdout, '')
  assert.equal(isolated.stderr, '')
  const logs = []
  safeReporter(line => logs.push(line))('deploy', 'failed', new ReleaseError(leak))
  privateAbsent(logs.join('\n'))
  const env = childEnvironment({ PATH: '/synthetic', GH_TOKEN: 'private', ...secrets() }, '/synthetic/temp')
  for (const key of ['GH_TOKEN', ...Object.keys(secrets())]) assert.equal(env[key], undefined)
})

test('workflow YAML enforces merged gates, fixed checkout, shared lock and no private persistence', async () => {
  const entry = yaml(await readFile(new URL('../.github/workflows/api-deploy-on-merge.yml', import.meta.url), 'utf8'))
  const executor = yaml(await readFile(new URL('../.github/workflows/api-deploy.yml', import.meta.url), 'utf8'))
  const ci = yaml(await readFile(new URL('../.github/workflows/api-ci.yml', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(entry.on), ['pull_request_target'])
  assert.deepEqual(entry.on.pull_request_target, { types: ['closed'], branches: ['dev', 'beta', 'main'] })
  assert.deepEqual(Object.keys(executor.on), ['workflow_call'])
  assert.deepEqual(Object.keys(executor.on.workflow_call.inputs).sort(), ['code-ref', 'environment'])
  assert.match(entry.jobs.release.if, /merged == true/)
  assert.equal(entry.concurrency, undefined)
  assert.equal(entry.jobs.release.concurrency, undefined)
  assert.equal(typeof entry.jobs.release.secrets, 'object')
  const job = executor.jobs.deploy
  for (const guard of ['pull_request_target', "'closed'", 'merged == true', 'base.repo.full_name', 'merge_commit_sha', "'dev'", "'beta'", "'main'", "'prod'"]) assert.ok(job.if.includes(guard))
  assert.equal(job.concurrency['cancel-in-progress'], false)
  assert.match(job.concurrency.group, /shared-production/)
  assert.match(job.concurrency.group, /test/)
  assert.equal(job.steps.find(step => step.uses === 'actions/checkout@v4').with.ref, '${{ inputs.code-ref }}')
  assert.equal(job.steps.find(step => step.uses === 'actions/checkout@v4').with['persist-credentials'], false)
  assert.equal(job.steps.at(-1).if, '${{ always() }}')
  const text = JSON.stringify(executor)
  for (const forbidden of ['workflow_dispatch', 'bootstrap', 'config-repository', 'config-ref', 'config-path', 'upload-artifact', 'actions/cache', '"cache"', 'GITHUB_OUTPUT', 'set -x', 'secrets: inherit']) assert.equal(text.includes(forbidden), false)
  assert.ok(job.steps.findIndex(step => step.run === 'pnpm install --frozen-lockfile') < job.steps.findIndex(step => step.env?.CONFIG_REPO_TOKEN))
  assert.equal(JSON.stringify(ci).includes('secrets.'), false)
  for (const trigger of ['pull_request', 'push']) { assert.ok(ci.on[trigger].paths.includes('tooling/api-release*.mjs')); assert.ok(ci.on[trigger].paths.includes('.github/workflows/api-deploy-on-merge.yml')) }
  assert.ok(ci.jobs.check.steps.some(step => step.run === 'node --test tooling/api-release.test.mjs'))
  const scripts = JSON.parse(await readFile(new URL('../apps/api/package.json', import.meta.url), 'utf8')).scripts
  for (const key of ['migration:remote:d1', 'migration:remote:fulltext']) { assert.match(scripts[key], /--remote/); assert.doesNotMatch(scripts[key], /--local/) }
})
