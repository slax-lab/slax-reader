import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { releaseInputs, validateBuildConfig, buildWeb, inspectProject, stageBuild, assertConfigFree, cloudflareGet, confirmDeployment, deploymentId, deployWeb, runCommand } from './web-pages-deploy.mjs'

const publicConfig = {
  PUBLIC_BASE_URL: 'https://web.example.test', AUTH_BASE_URL: 'https://web.example.test', SHARE_BASE_URL: 'https://web.example.test', DWEB_API_BASE_URL: 'https://api.example.test',
  COOKIE_DOMAIN: 'example.test', COOKIE_TOKEN_NAME: 'reader_session', GOOGLE_OAUTH_CLIENT_ID: 'fixture-client-id'
}
const environment = () => ({ ...process.env, TARGET_BRANCH: 'dev', MERGE_SHA: 'a'.repeat(40), CLOUDFLARE_ACCOUNT_ID: '0'.repeat(32), CF_ZONE_ID: '1'.repeat(32), PAGES_PROJECT_NAME: 'fixture-web', WEB_BUILD_CONFIG: JSON.stringify(publicConfig), CLOUDFLARE_API_TOKEN: 'fixture-credential' })
const project = () => ({
  name: 'fixture-web', production_branch: 'master', deployment_configs: { production: {
    compatibility_date: '2026-05-26', compatibility_flags: ['nodejs_compat'],
    services: { BACKEND: { service: 'fixture-api', entrypoint: 'ContentEntry' } }, r2_buckets: { OSS: { name: 'fixture-bucket' } },
    d1_databases: { DB: { id: 'keep-existing' } }, env_vars: { PRIVATE_KEY: { type: 'secret_text' } }
  } }
})
const id = '00000000-0000-4000-8000-000000000000'
const deployment = (status = 'success', name = 'deploy') => ({ id, environment: 'production', deployment_trigger: { metadata: { branch: 'master', commit_hash: 'a'.repeat(40) } }, latest_stage: { name, status } })
const response = result => new Response(JSON.stringify({ success: true, result }), { status: 200 })

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'web-pages-fixture-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, value) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), value) }
  put('source/index.html', '<!doctype html><h1>Fixture</h1>')
  put('source/_worker.js/index.js', 'export default { fetch() { return new Response("fixture") } }')
  put('source/_worker.js/chunks/server.mjs', 'export const value = 1')
  put('source/_nuxt/client.js', 'console.log("fixture")')
  put('source/_nuxt/client.wasm', new Uint8Array([0, 97, 115, 109]))
  put('source/_routes.json', JSON.stringify({ version: 1, include: ['/b/*'], exclude: ['/_nuxt/*'] }))
  put('source/_headers', '/*\n  X-Test: fixture')
  put('source/_redirects', '/old /new 302')
  put('source/wrangler.toml', 'name = "do-not-deploy"')
  put('source/_worker.js/wrangler.json', '{"name":"nested-do-not-deploy"}')
  put('source/.wrangler/deploy/config.json', '{"configPath":"elsewhere"}')
  put('source/.env', 'SECRET=fixture-only')
  put('source/.dev.vars', 'SECRET=fixture-only')
  put('source/private.key', 'fixture-only')
  put('source/nitro.json', '{"metadata":"build"}')
  return { root, put, source: join(root, 'source') }
}

test('three input mappings reject unsupported branches, accounts and credentials', () => {
  for (const [branch, profile] of [['dev', 'preview'], ['beta', 'beta'], ['main', 'production']]) assert.equal(releaseInputs({ ...environment(), TARGET_BRANCH: branch }, true).profile, profile)
  for (const key of ['TARGET_BRANCH', 'MERGE_SHA', 'CLOUDFLARE_ACCOUNT_ID', 'PAGES_PROJECT_NAME', 'CLOUDFLARE_API_TOKEN']) assert.throws(() => releaseInputs({ ...environment(), [key]: '' }, true), new RegExp(key))
  assert.throws(() => releaseInputs({ ...environment(), TARGET_BRANCH: '__proto__' }), /TARGET_BRANCH/)
  assert.throws(() => releaseInputs({ ...environment(), PAGES_PROJECT_NAME: 'foo/../../bar' }), /PAGES_PROJECT_NAME/)
})

test('public JSON schema is strict, required and single-line, and supports unused providers', async () => {
  const validated = await validateBuildConfig(JSON.stringify({ ...publicConfig, TURNSTILE_SITE_KEY: '', STRIPE_PUBLIC_KEY: '' }))
  assert.equal(validated.PUBLIC_BASE_URL, publicConfig.PUBLIC_BASE_URL)
  assert.equal(validated.TURNSTILE_SITE_KEY, undefined)
  assert.equal(validated.STRIPE_PUBLIC_KEY, undefined)
  for (const value of ['', '[]', 'null', '{', JSON.stringify({ ...publicConfig, NODE_OPTIONS: 'unsafe' }), JSON.stringify({ ...publicConfig, CLOUDFLARE_API_TOKEN: 'fixture-private' }), JSON.stringify({ ...publicConfig, COOKIE_TOKEN_NAME: 99 }), JSON.stringify({ ...publicConfig, PUBLIC_BASE_URL: 'httpbad' }), JSON.stringify({ ...publicConfig, PUBLIC_BASE_URL: 'https://name:password@example.test' }), JSON.stringify({ ...publicConfig, GOOGLE_OAUTH_CLIENT_ID: '\nunsafe' })]) {
    await assert.rejects(validateBuildConfig(value), error => { assert.doesNotMatch(error.message, /fixture-private|password|unsafe/); return true })
  }
  for (const key of Object.keys(publicConfig)) await assert.rejects(validateBuildConfig(JSON.stringify({ ...publicConfig, [key]: '' })), new RegExp(key))
})

test('build uses the existing command with allowlisted inputs and no deploy credentials', async () => {
  let called = false
  await buildWeb({ ...environment(), NODE_OPTIONS: '--inspect', SLAX_API_CONFIG: '/untrusted.toml', PUBLIC_BASE_URL: 'https://wrong.example.test', GH_TOKEN: 'fixture-gh', EXTRA_SECRET: 'private' }, { run: async (program, args, options) => {
    called = true
    assert.equal(program, 'pnpm')
    assert.deepEqual(args, ['web', '--', 'build'])
    assert.equal(options.env.SLAX_ENV, 'preview')
    assert.equal(options.env.PUBLIC_BASE_URL, publicConfig.PUBLIC_BASE_URL)
    for (const key of ['CLOUDFLARE_API_TOKEN', 'GH_TOKEN', 'EXTRA_SECRET', 'NODE_OPTIONS', 'SLAX_API_CONFIG', 'WEB_BUILD_CONFIG']) assert.equal(options.env[key], undefined)
  } })
  assert.equal(called, true)
  await assert.rejects(buildWeb({ ...environment(), WEB_BUILD_CONFIG: '{}' }, { run: async () => assert.fail('must not start') }))
})

test('project inspection uses the remote production branch and preserves additional configuration', () => {
  const data = project()
  const original = structuredClone(data)
  assert.equal(inspectProject(data, 'fixture-web'), 'master')
  assert.deepEqual(data, original)
  const mutations = [
    data => { data.name = 'wrong' }, data => { data.production_branch = '' },
    data => { delete data.deployment_configs.production.services.BACKEND },
    data => { data.deployment_configs.production.services.BACKEND.entrypoint = 'WrongEntry' },
    data => { delete data.deployment_configs.production.r2_buckets.OSS }
  ]
  for (const change of mutations) { const data = project(); change(data); assert.throws(() => inspectProject(data, 'fixture-web')) }
})

test('API reads have fixed destinations, bounded timeouts, no redirects and safe errors', async () => {
  const inputs = releaseInputs(environment(), true)
  const result = await cloudflareGet(inputs, '', { fetchImpl: async (url, options) => {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${'0'.repeat(32)}/pages/projects/fixture-web`)
    assert.equal(options.headers.Authorization, 'Bearer fixture-credential')
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    return response(project())
  } })
  assert.equal(result.name, 'fixture-web')
  for (const fetchImpl of [async () => new Response('fixture-private-response', { status: 403 }), async () => { throw new Error('fixture-private-response') }, async () => new Response('invalid'), async () => new Response('{"success":false,"errors":["fixture-private-response"]}')]) {
    await assert.rejects(cloudflareGet(inputs, '', { fetchImpl }), error => { assert.doesNotMatch(error.message, /fixture-private-response/); return true })
  }
})

test('staging preserves executable output but excludes deployment config, credentials and metadata', t => {
  const { source, root } = fixture(t)
  const staging = stageBuild(source, join(root, 'assets'))
  for (const file of ['index.html', '_worker.js/index.js', '_worker.js/chunks/server.mjs', '_nuxt/client.wasm', '_routes.json', '_headers', '_redirects']) assert.ok(existsSync(join(staging, file)), file)
  for (const file of ['wrangler.toml', '_worker.js/wrangler.json', '.wrangler', '.env', '.dev.vars', 'private.key', 'nitro.json']) assert.equal(existsSync(join(staging, file)), false, file)
  assert.ok(existsSync(join(source, 'wrangler.toml')))
})

test('staging rejects symlinks, missing artifacts and configuration discovery in ancestors', t => {
  const { source, root, put } = fixture(t)
  symlinkSync(join(source, 'index.html'), join(source, 'link.html'))
  assert.throws(() => stageBuild(source, join(root, 'bad')), /symbolic/)
  assert.equal(existsSync(join(root, 'bad')), false)
  rmSync(join(source, 'link.html'))
  put('wrangler.toml', 'name = "conflicting-ancestor"')
  assert.throws(() => assertConfigFree(source), /Wrangler/)
  assert.throws(() => stageBuild(source, join(root, 'bad')), /Wrangler/)
  rmSync(join(root, 'wrangler.toml'))
  rmSync(join(source, '_worker.js/index.js'))
  assert.throws(() => stageBuild(source, join(root, 'bad')), /Incomplete Pages/)
})

test('final confirmation checks exact deployment identity and terminal status', async () => {
  const inputs = releaseInputs(environment(), true)
  let count = 0
  await confirmDeployment(inputs, id, 'master', { interval: 1, fetchImpl: async () => response(++count === 1 ? deployment('active') : deployment()) })
  assert.equal(count, 2)
  for (const result of [deployment('failure'), { ...deployment(), environment: 'preview' }, { ...deployment(), deployment_trigger: { metadata: { branch: 'master', commit_hash: 'b'.repeat(40) } } }]) {
    await assert.rejects(confirmDeployment(inputs, id, 'master', { fetchImpl: async () => response(result) }))
  }
  await assert.rejects(confirmDeployment(inputs, id, 'master', { attempts: 2, interval: 1, fetchImpl: async () => response(deployment('success', 'build')) }), /timed out/)
})

function fakeWrangler(put, mode = 'success') {
  put('wrangler.mjs', `
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
const args = process.argv.slice(2)
assert.equal(args[0], 'pages')
assert.equal(args[1], 'deploy')
assert.ok(args.includes('--no-bundle'))
assert.equal(args[args.indexOf('--branch') + 1], 'master')
assert.equal(args[args.indexOf('--commit-hash') + 1], '${'a'.repeat(40)}')
assert.equal(process.env.GH_TOKEN, undefined)
assert.equal(process.env.WEB_BUILD_CONFIG, undefined)
assert.ok(existsSync(join(args[2], '_worker.js/index.js')))
assert.equal(existsSync(join(args[2], 'wrangler.toml')), false)
let cwd = process.cwd()
while (true) {
  for (const file of ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc', '.wrangler/deploy/config.json']) assert.equal(existsSync(join(cwd, file)), false)
  const parent = dirname(cwd); if (parent === cwd) break; cwd = parent
}
console.error('fixture-private-response')
${mode === 'failure' ? 'process.exit(7)' : `writeFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({type:'pages-deploy',version:1,pages_project:'fixture-web',deployment_id:'${id}'}) + '\\n')`}
`)
}

for (const [branch, host] of [['dev', 'r.slax.dev'], ['beta', 'r-beta.slax.com'], ['main', 'r.slax.com']]) {
  test(`${branch} release purges only its hostname after successful deployment`, async t => {
    const { root, source, put } = fixture(t)
    fakeWrangler(put)
    const cloud = project()
    const original = structuredClone(cloud)
    const requests = []
    await deployWeb({ ...environment(), TARGET_BRANCH: branch }, { source, wrangler: join(root, 'wrangler.mjs'), temporaryRoot: root, interval: 1, fetchImpl: async (url, options) => {
      requests.push(url)
      if (url.endsWith('/purge_cache')) {
        assert.equal(requests.length, 4)
        assert.equal(url, `https://api.cloudflare.com/client/v4/zones/${'1'.repeat(32)}/purge_cache`)
        assert.equal(options.method, 'POST')
        assert.equal(options.headers.Authorization, 'Bearer fixture-credential')
        assert.equal(options.headers['Content-Type'], 'application/json')
        assert.equal(options.redirect, 'error')
        assert.ok(options.signal instanceof AbortSignal)
        assert.deepEqual(JSON.parse(options.body), { hosts: [host] })
        return response({ id: 'purge-fixture' })
      }
      return response(url.includes('/deployments/') ? deployment(requests.length === 2 ? 'active' : 'success') : cloud)
    } })
    assert.equal(requests.length, 4)
    assert.deepEqual(cloud, original)
    assert.equal(readdirSync(root).some(name => name.startsWith('slax-web-pages-')), false)
  })
}

for (const [name, settings] of [
  ['missing compatibility metadata', {}],
  ['empty flags', { compatibility_date: '2026-05-26', compatibility_flags: [] }],
  ['old compatibility date', { compatibility_date: '2020-01-01', compatibility_flags: ['nodejs_compat'] }],
  ['explicit opt-out flags', { compatibility_date: '2026-08-04', compatibility_flags: ['no_nodejs_compat', 'no_nodejs_compat_v2'] }]
]) {
  test(`release delegates ${name} to Wrangler without mutation`, async t => {
    const { root, source, put } = fixture(t)
    fakeWrangler(put)
    const cloud = project()
    delete cloud.deployment_configs.production.compatibility_date
    delete cloud.deployment_configs.production.compatibility_flags
    Object.assign(cloud.deployment_configs.production, settings)
    const original = structuredClone(cloud)
    assert.equal(inspectProject(cloud, 'fixture-web'), 'master')
    await deployWeb(environment(), { source, wrangler: join(root, 'wrangler.mjs'), temporaryRoot: root, fetchImpl: async url => response(url.includes('/deployments/') ? deployment() : cloud) })
    assert.deepEqual(cloud, original)
    assert.equal(readdirSync(root).some(name => name.startsWith('slax-web-pages-')), false)
  })
}

test('failed upload and failed final status never purge and clean staged output', async t => {
  const { root, source, put } = fixture(t)
  const fetchImpl = async url => {
    assert.ok(!url.endsWith('/purge_cache'))
    return response(url.includes('/deployments/') ? deployment('failure') : project())
  }
  fakeWrangler(put, 'failure')
  await assert.rejects(deployWeb(environment(), { source, temporaryRoot: root, wrangler: join(root, 'wrangler.mjs'), fetchImpl }), /exit 7/)
  assert.equal(readdirSync(root).some(name => name.startsWith('slax-web-pages-')), false)
  fakeWrangler(put)
  await assert.rejects(deployWeb(environment(), { source, temporaryRoot: root, wrangler: join(root, 'wrangler.mjs'), fetchImpl }), /final deployment failed/)
  assert.equal(readdirSync(root).some(name => name.startsWith('slax-web-pages-')), false)
})

for (const status of [403, 429, 500, 'network', 'json', 'rejected', 'truthy']) {
  test(`purge ${status} fails the release with safe diagnostics and cleanup`, async t => {
    const { root, source, put } = fixture(t)
    fakeWrangler(put)
    await assert.rejects(deployWeb(environment(), { source, temporaryRoot: root, wrangler: join(root, 'wrangler.mjs'), fetchImpl: async url => {
      if (!url.endsWith('/purge_cache')) return response(url.includes('/deployments/') ? deployment() : project())
      if (status === 'network') throw new Error('fixture-private-response')
      if (status === 'json') return new Response('fixture-private-response')
      if (typeof status === 'number') return new Response('fixture-private-response', { status })
      return new Response(JSON.stringify({ success: status === 'truthy' ? 'true' : false, errors: ['fixture-private-response'] }))
    } }), error => {
      assert.match(error.message, /[Cc]ache purge/)
      assert.doesNotMatch(error.message, /fixture-private-response|fixture-credential/)
      return true
    })
    assert.equal(readdirSync(root).some(name => name.startsWith('slax-web-pages-')), false)
  })
}

test('missing or invalid purge zones fail before any publication', async t => {
  const { root, source, put } = fixture(t)
  fakeWrangler(put)
  for (const zone of ['', 'invalid', '../other', 'A'.repeat(32)]) {
    await assert.rejects(deployWeb({ ...environment(), CF_ZONE_ID: zone }, {
      source, temporaryRoot: root, wrangler: join(root, 'wrangler.mjs'),
      fetchImpl: async () => assert.fail('must not contact Cloudflare'),
      run: async () => assert.fail('must not publish')
    }), /CF_ZONE_ID/)
  }
})

test('subprocess interruption rejects and releases its log file', async t => {
  const { root } = fixture(t)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 100)
  t.after(() => clearTimeout(timer))
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: root, env: {}, signal: controller.signal, logPath: join(root, 'child.log') }), /interrupted/)
  rmSync(join(root, 'child.log'))
})

test('missing output and malformed deployment identifiers cannot count as success', t => {
  const { root, put } = fixture(t)
  assert.throws(() => deploymentId(join(root, 'missing'), 'fixture-web'), /deployment ID/)
  put('report.jsonl', JSON.stringify({ type: 'pages-deploy', version: 1, pages_project: 'other', deployment_id: id }))
  assert.throws(() => deploymentId(join(root, 'report.jsonl'), 'fixture-web'), /valid deployment ID/)
})

test('missing executables reject without double-closing the log descriptor', async t => {
  const { root } = fixture(t)
  await assert.rejects(runCommand(join(root, 'not-an-executable'), [], { cwd: root, env: {}, logPath: join(root, 'child.log') }), /Could not start/)
})

test('interrupted publication cleans the entire staging directory', async t => {
  const { root, source, put } = fixture(t)
  put('waiting.mjs', 'setInterval(() => {}, 1000)')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 150)
  t.after(() => clearTimeout(timer))
  await assert.rejects(deployWeb(environment(), { source, temporaryRoot: root, wrangler: join(root, 'waiting.mjs'), signal: controller.signal, fetchImpl: async () => response(project()) }), /interrupted/)
  assert.equal(readdirSync(root).some(name => name.startsWith('slax-web-pages-')), false)
})

test('actual Nuxt output survives the offline publication path', { skip: process.env.SLAX_TEST_PAGES_BUILD !== '1' }, async t => {
  const { root, put } = fixture(t)
  fakeWrangler(put)
  const source = new URL('../apps/web/dist', import.meta.url).pathname
  assert.ok(existsSync(join(source, '_worker.js/index.js')))
  await deployWeb(environment(), { source, temporaryRoot: root, wrangler: join(root, 'wrangler.mjs'), fetchImpl: async url => response(url.includes('/deployments/') ? deployment() : project()) })
  assert.equal(readdirSync(root).some(name => name.startsWith('slax-web-pages-')), false)
})

test('actual precompiled Pages modules render through the installed workerd runtime', { skip: process.env.SLAX_TEST_PAGES_BUILD !== '1', timeout: 30000 }, async t => {
  const { createRequire } = await import('node:module')
  const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
  const { Miniflare, convertV4MiniflareOptions } = createRequire(webRequire.resolve('wrangler/package.json'))('miniflare')
  const { root } = fixture(t)
  const assets = stageBuild(new URL('../apps/web/dist', import.meta.url).pathname, join(root, 'runtime'))
  const worker = join(assets, '_worker.js')
  const files = readdirSync(worker, { recursive: true }).filter(file => /\.(m?js|wasm)$/.test(file))
  const modules = ['index.js', ...files.filter(file => file !== 'index.js')].map(file => ({ type: file.endsWith('.wasm') ? 'CompiledWasm' : 'ESModule', path: join(worker, file) }))
  const runtime = new Miniflare(await convertV4MiniflareOptions({
    modules, modulesRoot: worker, compatibilityDate: '2026-05-26', compatibilityFlags: ['nodejs_compat'],
    serviceBindings: { ASSETS: async () => new Response('missing', { status: 404 }) }
  }))
  try {
    for (const pathname of ['/', '/bookmarks']) {
      const result = await runtime.dispatchFetch(`https://web.example.test${pathname}`)
      assert.equal(result.status, 200)
      assert.match(await result.text(), /slax-reader-dweb/)
    }
  } finally { await runtime.dispose() }
})

test('CLI fails missing settings without exposing supplied values', () => {
  const result = spawnSync(process.execPath, [new URL('./web-pages-deploy.mjs', import.meta.url).pathname, 'deploy'], { encoding: 'utf8', env: { ...environment(), CLOUDFLARE_ACCOUNT_ID: 'fixture-private-value' } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /CLOUDFLARE_ACCOUNT_ID/)
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-private-value|fixture-credential/)
})
