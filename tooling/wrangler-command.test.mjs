import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'slax-wrangler-wrapper-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ['apps/web/config', 'tooling', 'bin', 'deploy/local_web', 'deploy/cloudflare']) mkdirSync(join(root, dir), { recursive: true })
  for (const file of ['apps/web/config/wrangler-command.mjs', 'apps/web/config/backend-binding.ts', 'tooling/env-files.mjs', 'tooling/pnpm-command.mjs', 'deploy/cloudflare/api.toml.example']) {
    copyFileSync(new URL('../' + file, import.meta.url), join(root, file))
  }
  symlinkSync(fileURLToPath(new URL('../apps/web/node_modules', import.meta.url)), join(root, 'apps/web/node_modules'), 'dir')
  writeFileSync(join(root, 'deploy/local_web/.env'), 'BACKEND_SERVICE_NAME=base-edge\n')
  writeFileSync(join(root, 'deploy/local_web/.env.dev'), 'BACKEND_SERVICE_NAME=profile-edge\n')
  writeFileSync(join(root, 'apps/web/.env'), 'BACKEND_SERVICE_NAME=stale-app-edge\n')
  const calls = join(root, 'calls.jsonl')
  writeFileSync(join(root, 'bin/pnpm'), `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), edge: process.env.BACKEND_SERVICE_NAME }) + '\\n')
if (process.env.FIXTURE_WAIT === '1') {
  process.on('SIGTERM', () => process.exit(0))
  console.log('READY')
  setInterval(() => {}, 1000)
}
`, { mode: 0o755 })
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  const env = { PATH: [join(root, 'bin'), dirname(process.execPath), process.env.PATH].join(delimiter), HOME: process.env.HOME, SLAX_ENV: 'development' }
  const script = join(root, 'apps/web/config/wrangler-command.mjs')
  return { root, calls, env, script }
}

test('direct Wrangler types loads deploy profile and respects process overrides', { skip: process.platform === 'win32' }, t => {
  const { root, calls, env, script } = fixture(t)
  for (const override of [undefined, 'process-edge']) {
    const result = spawnSync(process.execPath, [script, 'types'], { cwd: tmpdir(), env: { ...env, ...(override ? { BACKEND_SERVICE_NAME: override } : {}) }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const invocation = JSON.parse(readFileSync(calls, 'utf8').trim().split('\n').at(-1))
    assert.equal(invocation.edge, override || 'profile-edge')
    const config = readFileSync(join(root, 'deploy/local_web/.generated/wrangler.toml'), 'utf8')
    assert.match(config, new RegExp('service = "' + (override || 'profile-edge') + '"'))
    assert.deepEqual(invocation.args.slice(0, 4), ['exec', 'wrangler', 'types', '-c'])
  }
})

test('SSR warns when API is unconfigured and shares the unversioned CLI state directory', { skip: process.platform === 'win32' }, t => {
  const { root, calls, env, script } = fixture(t)
  const result = spawnSync(process.execPath, [script, 'ssr-dev'], { env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /pnpm api -- config:init/)
  const invocations = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(invocations[0].args, ['build'])
  const args = invocations[1].args
  assert.equal(args[args.indexOf('--persist-to') + 1], join(root, 'deploy/local/.wrangler/state'))
  // Pages dev rejects --config for custom paths; --cwd is how it discovers the generated wrangler.toml.
  assert.equal(args.includes('--config'), false)
  assert.equal(args[args.indexOf('--cwd') + 1], join(root, 'deploy/local_web/.generated'))
})

test('interrupting SSR build prevents server startup even when the child exits zero', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const { calls, env, script } = fixture(t)
  const child = spawn(process.execPath, [script, 'ssr-dev'], { env: { ...env, FIXTURE_WAIT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM') })
  const closed = once(child, 'close')
  await new Promise((resolve, reject) => {
    let output = ''
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('READY')) resolve() })
    child.on('error', reject)
    child.on('close', () => reject(new Error('Wrapper exited before build was ready')))
  })
  child.kill('SIGTERM')
  const [code] = await closed
  assert.equal(code, 143)
  const invocations = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(invocations.map(call => call.args), [['build']])
})
