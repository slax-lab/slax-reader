import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'slax-cli-dispatch-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'tooling'))
  mkdirSync(join(root, 'apps/cli'), { recursive: true })
  for (const name of ['cli.mjs', 'pnpm-command.mjs']) copyFileSync(new URL(name, import.meta.url), join(root, 'tooling', name))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, packageManager: 'pnpm@11.25.0' }))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\nverifyDepsBeforeRun: false\n')
  writeFileSync(join(root, 'apps/cli/package.json'), JSON.stringify({ name: '@slax-lab/reader-cli', scripts: { start: 'node ../../fixture.mjs', build: 'node ../../fixture.mjs', prepublishOnly: 'exit 99' } }))
  writeFileSync(join(root, 'fixture.mjs'), 'console.log("ARGS:"+JSON.stringify(process.argv.slice(2)));process.exit(Number(process.env.FIXTURE_EXIT||0))')
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot }
  const command = join(root, 'tooling/cli.mjs')
  return { root, command, env, run: (args, extra = {}) => spawnSync(process.execPath, [command, ...args], { cwd: tmpdir(), env: { ...env, ...extra }, encoding: 'utf8', timeout: 15000 }) }
}

test('CLI dispatcher requires no deploy configuration and forwards literal arguments/status', t => {
  const { run } = fixture(t)
  assert.equal(run([]).status, 2)
  const help = run(['--', '--help'])
  assert.equal(help.status, 0)
  assert.match(help.stdout, /start/)
  assert.doesNotMatch(help.stdout, /prepublishOnly/)
  assert.equal(run(['prepublishOnly']).status, 2)
  assert.equal(run(['unknown']).status, 2)
  const args = ['two words', '$(touch do-not-create)', '; exit 99', '--json']
  const result = run(['--', 'start', ...args])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout.split('\n').find(line => line.startsWith('ARGS:')).slice(5)), args)
  assert.equal(run(['build'], { FIXTURE_EXIT: '23' }).status, 23)
})

for (const [signal, status] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`CLI dispatcher propagates ${signal}`, { skip: process.platform === 'win32', timeout: 15000 }, async t => {
    const { root, command, env } = fixture(t)
    const received = join(root, 'signal')
    writeFileSync(join(root, 'fixture.mjs'), `import {writeFileSync} from 'node:fs'; for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{writeFileSync(${JSON.stringify(received)},signal);process.exit(0)}); console.log('READY');setInterval(()=>{},1000)`)
    const child = spawn(process.execPath, [command, 'start'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    t.after(() => { if (child.exitCode === null) child.kill('SIGTERM') })
    const closed = once(child, 'close')
    await new Promise((resolve, reject) => {
      let output = ''
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('READY')) resolve() })
      child.on('error', reject)
      child.on('close', () => reject(new Error('Exited before ready')))
    })
    child.kill(signal)
    const [code] = await closed
    assert.equal(code, status)
    assert.equal(readFileSync(received, 'utf8'), signal)
  })
}
