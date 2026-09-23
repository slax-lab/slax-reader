import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  deployDirectory,
  environmentFileNames,
  applyDeployEnvironment,
  loadDeployEnvironment,
  parseEnvironmentText,
  profileFileName,
  readEnvSources
} from './env-files.mjs'

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), 'slax-reader-env-files-'))
}

test('parser supports comments, empty values, export syntax and multiline quoted values', () => {
  assert.deepEqual(parseEnvironmentText('\uFEFF# fixture\nexport A="two\nlines" # note\nB=\nC=value # note\nD="literal # hash"\n'), {
    A: 'two\nlines', B: '', C: 'value', D: 'literal # hash'
  })
  for (const text of ['MISSING_EQUALS', 'A="unclosed', '1A=value', 'A="closed" extra', 'A=bad\0value']) {
    assert.throws(() => parseEnvironmentText(text), /环境文件语法无效/)
  }
})

test('development profile resolves to .env.dev and other profiles keep their names', () => {
  assert.equal(profileFileName('development'), '.env.dev')
  assert.equal(profileFileName('preview'), '.env.preview')
  assert.deepEqual(environmentFileNames('development'), ['.env', '.env.dev'])
})

test('deploy environment merges profile over base and process over both', () => {
  const root = temporaryDirectory()
  const directory = deployDirectory('web', root)
  const processEnvironment = { OVERRIDE: 'process', SHELL_ONLY: 'shell' }

  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, '.env'), 'BASE_ONLY=base\nOVERRIDE=base\n')
  writeFileSync(join(directory, '.env.dev'), 'PROFILE_ONLY=profile\nOVERRIDE=profile\n')

  const result = readEnvSources(directory, 'development', processEnvironment, { root, appName: 'Web' })
  assert.equal(result.values.BASE_ONLY, 'base')
  assert.equal(result.values.PROFILE_ONLY, 'profile')
  assert.equal(result.values.OVERRIDE, 'process')
  assert.equal(result.values.SHELL_ONLY, 'shell')
  assert.deepEqual(result.files, ['.env', '.env.dev'])
  assert.equal(result.sources.PROFILE_ONLY, 'deploy/local_web/.env.dev')
  rmSync(root, { recursive: true, force: true })
})

test('missing profile files do not block loading the shared file', () => {
  const root = temporaryDirectory()
  const directory = deployDirectory('extension', root)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, '.env'), 'BASE_ONLY=base\n')

  const result = loadDeployEnvironment({ appName: 'extension', root, processEnvironment: {} })
  assert.equal(result.environment.BASE_ONLY, 'base')
  assert.deepEqual(result.files, ['.env'])
  rmSync(root, { recursive: true, force: true })
})

test('malformed deploy files fail without exposing their contents', () => {
  const root = temporaryDirectory()
  const directory = deployDirectory('web', root)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, '.env'), 'BROKEN-NAME=secret-value\n')

  assert.throws(
    () => loadDeployEnvironment({ appName: 'web', root, processEnvironment: {} }),
    error => error instanceof Error && /Web 环境文件语法无效/.test(error.message) && !error.message.includes('secret-value')
  )
  rmSync(root, { recursive: true, force: true })
})

test('loading does not mutate the parent process environment', () => {
  const root = temporaryDirectory()
  const directory = deployDirectory('web', root)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, '.env'), 'CHILD_ONLY=child\n')

  assert.equal(process.env.CHILD_ONLY, undefined)
  const result = loadDeployEnvironment({ appName: 'web', root, processEnvironment: {} })
  assert.equal(result.environment.CHILD_ONLY, 'child')
  assert.equal(process.env.CHILD_ONLY, undefined)
  rmSync(root, { recursive: true, force: true })
})

test('applyDeployEnvironment exposes only the selected deploy files to a direct app', t => {
  const root = temporaryDirectory()
  t.after(() => {
    delete process.env.DEPLOY_ONLY
    delete process.env.SLAX_ENV
    rmSync(root, { recursive: true, force: true })
  })
  const directory = deployDirectory('web', root)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, '.env'), 'DEPLOY_ONLY=deploy\nSLAX_ENV=development\n')

  const result = applyDeployEnvironment({ appName: 'web', root, processEnvironment: {} })
  assert.equal(result.environment.DEPLOY_ONLY, 'deploy')
  assert.equal(process.env.DEPLOY_ONLY, 'deploy')
  assert.equal(process.env.SLAX_ENV, 'development')
})

test('base SLAX_ENV selects a profile and a process override selects a different one', t => {
  const root = temporaryDirectory()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const directory = deployDirectory('web', root)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, '.env'), 'SLAX_ENV=preview\n')
  writeFileSync(join(directory, '.env.preview'), 'PROFILE=preview\n')
  writeFileSync(join(directory, '.env.dev'), 'PROFILE=development\nSLAX_ENV=production\n')

  const preview = loadDeployEnvironment({ appName: 'web', root, processEnvironment: {} })
  assert.equal(preview.environment.PROFILE, 'preview')
  assert.equal(preview.envName, 'preview')
  const development = loadDeployEnvironment({ appName: 'web', root, processEnvironment: { SLAX_ENV: 'development' } })
  assert.equal(development.environment.PROFILE, 'development')
  assert.equal(development.environment.SLAX_ENV, 'development')
  const explicit = loadDeployEnvironment({ appName: 'web', root, envName: 'preview', processEnvironment: { SLAX_ENV: 'development' } })
  assert.equal(explicit.environment.PROFILE, 'preview')
  assert.equal(explicit.environment.SLAX_ENV, 'preview')
})

test('profile names are restricted before resolving file paths', () => {
  assert.throws(() => profileFileName('../../outside'), /SLAX_ENV/)
  assert.throws(() => profileFileName('dev'), /SLAX_ENV/)
  assert.throws(() => deployDirectory('constructor', '/tmp'), /未知的前端应用/)
})
