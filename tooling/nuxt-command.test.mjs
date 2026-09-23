import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('Nuxt wrapper always supplies a controlled dotenv file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'slax-reader-nuxt-wrapper-'))
  const output = join(directory, 'invocation')
  const fakePnpm = join(directory, 'pnpm')
  writeFileSync(fakePnpm, `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(output)}
exit 0
`)
  chmodSync(fakePnpm, 0o755)
  try {
    const result = spawnSync(process.execPath, ['apps/web/config/nuxt-command.mjs', 'build', '--dotenv', 'apps/web/.env', '--dotenv=other.env'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: { PATH: directory, HOME: process.env.HOME, SLAX_ENV: 'development' }
    })
    assert.equal(result.status, 0, result.stderr)
    const args = readFileSync(output, 'utf8').trim().split('\n')
    assert.deepEqual(args.slice(0, 2), ['exec', 'nuxt'])
    assert.equal(args[2], 'build')
    const dotenvIndex = args.indexOf('--dotenv')
    assert.ok(dotenvIndex >= 0)
    assert.match(args[dotenvIndex + 1], /slax-reader-nuxt-[^/]+\/.env$/)
    assert.ok(!args.includes('apps/web/.env'))
    assert.ok(!args.includes('other.env'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
