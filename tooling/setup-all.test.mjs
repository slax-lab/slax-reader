import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { runSetupAll } from './setup-all.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fakeSpawn(log, exitCodes = []) {
  let index = 0
  return (_program, args) => {
    const child = new EventEmitter()
    child.pid = 1000 + index
    log.push(args)
    const code = exitCodes[index] ?? 0
    index += 1
    queueMicrotask(() => child.emit('close', code, null))
    return child
  }
}

function signalSpawn(signal) {
  return (_program, _args, options) => {
    const child = new EventEmitter()
    child.pid = 2000
    child.options = options
    queueMicrotask(() => child.emit('close', 0, signal))
    return child
  }
}

test('setup:all runs API, Web, and Extension setup in order', async () => {
  const calls = []
  const status = await runSetupAll({
    root: ROOT,
    spawnProcess: fakeSpawn(calls)
  })
  assert.equal(status, 0)
  assert.deepEqual(calls, [
    ['api', '--', 'setup'],
    ['web', '--', 'setup'],
    ['extension', '--', 'setup']
  ])
})

test('setup:all stops at the first failed module and preserves its status', async () => {
  const calls = []
  const status = await runSetupAll({
    root: ROOT,
    spawnProcess: fakeSpawn(calls, [17])
  })
  assert.equal(status, 17)
  assert.deepEqual(calls, [['api', '--', 'setup']])
})

test('setup:all exposes help without starting setup', () => {
  const result = spawnSync(process.execPath, ['tooling/setup-all.mjs', '--help'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /pnpm setup:all/)
  assert.doesNotMatch(result.stdout, /API setup/)
})

test('setup:all preserves signal-derived exit codes from a child', async () => {
  const status = await runSetupAll({
    root: ROOT,
    steps: [['API', ['api', '--', 'setup']]],
    spawnProcess: signalSpawn('SIGTERM')
  })
  assert.equal(status, 143)
})

test('setup:all reports a missing workspace command and stops', async () => {
  let calls = 0
  const status = await runSetupAll({
    root: ROOT,
    spawnProcess: (_program, _args, _options) => {
      calls += 1
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })))
      return child
    }
  })
  assert.equal(status, 1)
  assert.equal(calls, 1)
})
