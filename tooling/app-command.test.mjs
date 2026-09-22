import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { forwardedArguments, packageCommands, resolveCommand } from './run-app.mjs'

test('forwardedArguments accepts the documented separator and direct arguments', () => {
  assert.deepEqual(forwardedArguments(['--', 'dev']), ['dev'])
  assert.deepEqual(forwardedArguments(['build']), ['build'])
})

test('resolveCommand maps friendly aliases to app package scripts', () => {
  assert.equal(resolveCommand('typecheck', { typecheck: 'compile' }), 'compile')
  assert.equal(resolveCommand('build', { typecheck: 'compile' }), 'build')
})

test('packageCommands follows app package scripts and omits lifecycle hooks', () => {
  const webCommands = packageCommands(new URL('../apps/web/package.json', import.meta.url))
  const commands = packageCommands(new URL('../apps/extension/package.json', import.meta.url))
  assert.ok(webCommands.includes('preview'))
  assert.ok(commands.includes('dev'))
  assert.ok(commands.includes('build:vendor'))
  assert.ok(!commands.includes('predev'))
})

function dispatcherFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'slax-reader-run-app-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'tooling'))
  for (const file of ['web.mjs', 'extension.mjs', 'run-app.mjs', 'env-files.mjs']) {
    copyFileSync(new URL(file, import.meta.url), join(root, 'tooling', file))
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, packageManager: 'pnpm@11.25.0' }))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\nverifyDepsBeforeRun: false\n')
  writeFileSync(join(root, 'fixture.mjs'), `
    console.log('FIXTURE:' + JSON.stringify({
      base: process.env.FIXTURE_BASE, profile: process.env.FIXTURE_PROFILE,
      override: process.env.FIXTURE_OVERRIDE, app: process.env.FIXTURE_APP,
      onlyWeb: process.env.FIXTURE_WEB_ONLY, args: process.argv.slice(2)
    }))
    process.exit(Number(process.env.FIXTURE_EXIT || 0))
  `)
  for (const [app, name] of [['web', '@apps/slax-reader-dweb'], ['extension', '@apps/slax-reader-extensions']]) {
    const appDir = join(root, 'apps', app)
    const deployDir = join(root, 'deploy', 'local_' + app)
    mkdirSync(appDir, { recursive: true })
    mkdirSync(deployDir, { recursive: true })
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name, scripts: { dev: 'node ../../fixture.mjs', build: 'node ../../fixture.mjs' } }))
    writeFileSync(join(deployDir, '.env'), 'FIXTURE_BASE=base\nFIXTURE_OVERRIDE=base\nFIXTURE_APP=' + app + '\n')
    writeFileSync(join(deployDir, '.env.dev'), 'FIXTURE_PROFILE=profile\nFIXTURE_OVERRIDE=profile\n' + (app === 'web' ? 'FIXTURE_WEB_ONLY=web\n' : ''))
  }
  return { root, run: (app, args, extraEnv = {}) => spawnSync(process.execPath, [join(root, 'tooling', app + '.mjs'), ...args], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 15000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot, SLAX_ENV: 'development', ...extraEnv }
  }) }
}

test('real dispatchers forward deploy configuration, app isolation, arguments and exit status', t => {
  const { run } = dispatcherFixture(t)
  for (const app of ['web', 'extension']) {
    const result = run(app, ['--', 'dev', '--port', '4567'], { FIXTURE_OVERRIDE: 'shell' })
    assert.equal(result.status, 0, result.stderr)
    const received = JSON.parse(result.stdout.split('\n').find(line => line.startsWith('FIXTURE:')).slice(8))
    assert.equal(received.base, 'base')
    assert.equal(received.profile, 'profile')
    assert.equal(received.override, 'shell')
    assert.equal(received.app, app)
    assert.equal(received.onlyWeb, app === 'web' ? 'web' : undefined)
    assert.deepEqual(received.args, ['--port', '4567'])
    assert.equal(run(app, ['build'], { FIXTURE_EXIT: '27' }).status, 27)
  }
})

test('malformed config stops the dispatcher before spawn but never blocks help', t => {
  const { root, run } = dispatcherFixture(t)
  writeFileSync(join(root, 'deploy/local_web/.env'), 'TOKEN="private-fixture-value')
  const result = run('web', ['dev'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Web.*local_web\/\.env/)
  assert.doesNotMatch(result.stderr, /private-fixture-value/)
  assert.doesNotMatch(result.stdout, /FIXTURE:/)
  assert.equal(run('web', ['--help']).status, 0)
  assert.equal(run('web', ['unknown-command']).status, 2)
})

for (const [signal, expectedStatus] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`dispatcher forwards ${signal} to the app process and reports ${expectedStatus}`, { skip: process.platform === 'win32', timeout: 15000 }, async t => {
    const { root } = dispatcherFixture(t)
    const signalFile = join(root, 'received-signal')
    writeFileSync(join(root, 'fixture.mjs'), `
      import { writeFileSync } from 'node:fs'
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
        writeFileSync(${JSON.stringify(signalFile)}, signal)
        process.exit(0)
      })
      console.log('READY')
      setInterval(() => {}, 1000)
    `)
    const wrapper = spawn(process.execPath, [join(root, 'tooling/web.mjs'), 'dev'], {
      cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, SLAX_ENV: 'development' }
    })
    t.after(() => { if (wrapper.exitCode === null) wrapper.kill('SIGTERM') })
    const closed = once(wrapper, 'close')
    await new Promise((resolve, reject) => {
      let output = ''
      wrapper.stdout.on('data', chunk => {
        output += chunk
        if (output.includes('READY')) resolve()
      })
      wrapper.on('error', reject)
      wrapper.on('close', () => reject(new Error('Dispatcher exited before app was ready')))
    })
    wrapper.kill(signal)
    const [code] = await closed
    assert.equal(code, expectedStatus)
    assert.equal(readFileSync(signalFile, 'utf8'), signal)
  })
}
