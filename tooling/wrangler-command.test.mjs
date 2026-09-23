import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'slax-wrangler-wrapper-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ['apps/web/config', 'tooling', 'bin', 'deploy/local', 'deploy/cloudflare']) mkdirSync(join(root, dir), { recursive: true })
  for (const file of ['apps/web/config/wrangler-command.mjs', 'apps/web/config/backend-binding.ts', 'tooling/env-files.mjs', 'tooling/pnpm-command.mjs', 'deploy/cloudflare/api.toml.example']) {
    copyFileSync(new URL('../' + file, import.meta.url), join(root, file))
  }
  symlinkSync(fileURLToPath(new URL('../apps/web/node_modules', import.meta.url)), join(root, 'apps/web/node_modules'), 'dir')
  writeFileSync(join(root, 'deploy/local/.env.web'), 'BACKEND_SERVICE_NAME=base-edge\n')
  writeFileSync(join(root, 'deploy/local/.env.web.dev'), 'BACKEND_SERVICE_NAME=profile-edge\n')
  writeFileSync(join(root, 'apps/web/.env'), 'BACKEND_SERVICE_NAME=stale-app-edge\n')
  const calls = join(root, 'calls.jsonl')
  writeFileSync(join(root, 'bin/pnpm'), `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), edge: process.env.BACKEND_SERVICE_NAME }) + '\\n')
if (process.env.FIXTURE_WAIT === '1') {
  let signals = 0
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      signals += 1
      console.log('RECEIVED ' + signal + ' ' + signals)
      if (process.env.FIXTURE_REPEAT !== '1' || signals === 2) process.exit(0)
    })
  }
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
    const config = readFileSync(join(root, 'deploy/local/.generated/web/wrangler.toml'), 'utf8')
    assert.match(config, new RegExp('service = "' + (override || 'profile-edge') + '"'))
    assert.deepEqual(invocation.args.slice(0, 4), ['exec', 'wrangler', 'types', '-c'])
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`Wrangler forwards repeated ${signal} until its child exits`, { skip: process.platform === 'win32', timeout: 15000 }, async t => {
    const { calls, env, script } = fixture(t)
    // A separate group lets cleanup terminate the fixture even if a regressed
    // wrapper exits early and leaves its child running.
    const child = spawn(process.execPath, [script, 'ssr-dev'], {
      env: { ...env, FIXTURE_WAIT: '1', FIXTURE_REPEAT: '1' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    t.after(() => {
      try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    })
    const closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    const waitForOutput = marker => new Promise((resolve, reject) => {
      const cleanup = () => {
        child.stdout.removeListener('data', check)
        child.removeListener('exit', earlyExit)
        child.removeListener('error', onError)
        t.signal.removeEventListener('abort', aborted)
      }
      const check = () => { if (output.includes(marker)) { cleanup(); resolve() } }
      const earlyExit = () => { cleanup(); reject(new Error(`Wrapper exited before ${marker}`)) }
      const onError = error => { cleanup(); reject(error) }
      const aborted = () => onError(new Error('Test aborted'))
      child.stdout.on('data', check)
      child.on('exit', earlyExit)
      child.on('error', onError)
      t.signal.addEventListener('abort', aborted, { once: true })
      check()
    })
    await waitForOutput('READY')
    for (const count of [1, 2]) {
      const received = waitForOutput(`RECEIVED ${signal} ${count}`)
      child.kill(signal)
      await received
    }
    const [code, exitSignal] = await closed
    assert.equal(code, signal === 'SIGINT' ? 130 : 143)
    assert.equal(exitSignal, null)
    const invocations = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(invocations.map(call => call.args), [['build']])
  })
}

test('SSR warns when API is unconfigured and shares the unversioned CLI state directory', { skip: process.platform === 'win32' }, t => {
  const { root, calls, env, script } = fixture(t)
  const staleRedirect = join(root, 'deploy/local/.generated/web/.wrangler/deploy/config.json')
  mkdirSync(dirname(staleRedirect), { recursive: true })
  writeFileSync(staleRedirect, '{"stale":true}')
  const result = spawnSync(process.execPath, [script, 'ssr-dev'], { env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /pnpm api -- config:init/)
  const invocations = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(invocations[0].args, ['build'])
  const args = invocations[1].args
  assert.equal(args[args.indexOf('--persist-to') + 1], join(root, 'deploy/local/.wrangler/state'))
  // Pages dev rejects --config for custom paths; --cwd is how it discovers the generated wrangler.toml.
  assert.equal(args.includes('--config'), false)
  assert.equal(args[args.indexOf('--cwd') + 1], join(root, 'deploy/local/.generated/web'))
  // The stale-redirect cleanup follows wrangler's cwd to the generated dir, not apps/web.
  assert.equal(existsSync(staleRedirect), false)
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
