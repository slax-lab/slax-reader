import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pnpmInvocation } from './pnpm-command.mjs'

test('Windows uses the pnpm Node entrypoint and preserves shell metacharacters as data', t => {
  const directory = mkdtempSync(join(tmpdir(), 'slax pnpm args '))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const cli = join(directory, 'pnpm.cjs')
  writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)))')
  const args = ['run', 'dev', 'path with spaces', 'a&b', '$(echo unsafe)', '%PATH%', '"quoted"']
  const invocation = pnpmInvocation(args, { platform: 'win32', env: { npm_execpath: cli } })
  const result = spawnSync(invocation.program, invocation.args, { encoding: 'utf8', shell: false })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), args)
})

test('Windows supports standalone pnpm and never falls back to a shell shim', () => {
  const cli = join(tmpdir(), 'pnpm.exe')
  assert.deepEqual(pnpmInvocation(['--version'], { platform: 'win32', env: { npm_execpath: cli } }), { program: cli, args: ['--version'] })
  for (const env of [{}, { npm_execpath: join(tmpdir(), 'pnpm.cmd') }]) {
    assert.throws(() => pnpmInvocation([], { platform: 'win32', env }), /through pnpm/)
  }
})
