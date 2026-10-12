import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixture, execute, apiKey, version } from '../test/helpers.mjs'

const app = fileURLToPath(new URL('../', import.meta.url))
const root = resolve(app, '../..')
const temporary = await mkdtemp(join(tmpdir(), 'slax-cli-consumer-'))
const cleanups = []
try {
  const artifacts = join(temporary, 'artifacts')
  await mkdir(artifacts)
  let archive = process.argv[2] ? resolve(process.argv[2]) : null
  if (!archive) {
    execFileSync('pnpm', ['pack', '--pack-destination', artifacts], { cwd: app, stdio: 'inherit' })
    const files = (await readdir(artifacts)).filter(file => file.endsWith('.tgz'))
    assert.equal(files.length, 1)
    archive = join(artifacts, files[0])
  }
  const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
  assert.ok(files.includes('package/LICENSE'))
  assert.ok(files.includes('package/dist/index.js'))
  assert.ok(files.every(file => !/(?:node_modules|\/src\/|\.env|\.dev.vars)/.test(file)))
  const packed = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
  assert.equal(packed.name, '@slax-lab/reader-cli')
  assert.equal(packed.version, version)
  assert.equal(packed.license, 'MIT')
  assert.equal(packed.bin['reader-cli'], './dist/index.js')
  for (const [name, range] of Object.entries({ ...packed.dependencies, ...packed.optionalDependencies })) {
    assert.ok(!name.startsWith('@slax-reader/'))
    assert.ok(!/^(workspace:|link:|file:)/.test(range))
  }
  const consumer = join(temporary, 'consumer')
  await mkdir(consumer)
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'cli-consumer-fixture', private: true, type: 'module' }))
  const npmHome = join(temporary, 'npm-home')
  await mkdir(npmHome)
  const env = { PATH: process.env.PATH, HOME: npmHome, USERPROFILE: npmHome, APPDATA: npmHome, LOCALAPPDATA: npmHome, XDG_CONFIG_HOME: npmHome, npm_config_cache: join(temporary, 'npm-cache'), npm_config_userconfig: join(temporary, 'empty-npmrc'), CI: '1' }
  await writeFile(env.npm_config_userconfig, '')
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', archive], { cwd: consumer, env, stdio: 'inherit', timeout: 120000 })
  const installed = join(consumer, 'node_modules/.bin/reader-cli')
  assert.ok(!(await realpath(join(consumer, 'node_modules/@slax-lab/reader-cli'))).startsWith(root))
  const f = await fixture({ after: callback => cleanups.push(callback) }, await realpath(installed))
  const result = await f.login()
  assert.equal(JSON.parse(result.stdout).data.apiBase, f.base)
  assert.ok(f.requests.some(request => request.headers['x-api-key'] === apiKey))
  const who = await f.run(['whoami', '--json'])
  assert.equal(who.code, 0, who.stderr)
  assert.equal(JSON.parse(who.stdout).data.user.username, 'fixture')
  const directly = await execute(installed, ['--version'], { cwd: consumer, env: f.env })
  assert.equal(directly.code, 0, directly.stderr)
  assert.equal(directly.stdout.trim(), version)
  const help = await execute(installed, ['--help'], { cwd: consumer, env: f.env })
  assert.equal(help.code, 0, help.stderr)
  assert.match(help.stdout, /restore/)
  const output = await readFile(await realpath(installed), 'utf8')
  assert.ok(output.startsWith('#!/usr/bin/env node'))
  assert.ok(!output.includes('@slax-reader/contracts'))
  console.log(`Verified standalone @slax-lab/reader-cli@${version}: ${archive}`)
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup()
  await rm(temporary, { recursive: true, force: true })
}
