import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { formatIssue, parseArgs, parseEnvText, readEnvSources, validateVariable } from './preflight.mjs'

test('parseEnvText reads export syntax and quoted values without exposing values', () => {
  const values = parseEnvText(`\n# comment\nexport PUBLIC_BASE_URL="http://localhost:3000"\nCOOKIE_DOMAIN=localhost\n`)

  assert.deepEqual(values, {
    PUBLIC_BASE_URL: 'http://localhost:3000',
    COOKIE_DOMAIN: 'localhost'
  })
})

test('readEnvSources follows app loader precedence and process variables win', () => {
  const appDirectory = mkdtempSync(join(tmpdir(), 'slax-reader-preflight-'))
  writeFileSync(join(appDirectory, '.env'), 'COOKIE_DOMAIN=from-base\nFIRST_FILE=base\n')
  writeFileSync(join(appDirectory, '.env.development'), 'COOKIE_DOMAIN=from-profile\nPROFILE_ONLY=profile\n')
  writeFileSync(join(appDirectory, '.env.development.local'), 'COOKIE_DOMAIN=from-local\nLOCAL_ONLY=local\n')

  const result = readEnvSources(appDirectory, 'development', { PUBLIC_BASE_URL: 'https://process.example' })

  assert.equal(result.values.PUBLIC_BASE_URL, 'https://process.example')
  assert.equal(result.sources.PUBLIC_BASE_URL, 'process environment')
  assert.equal(result.values.COOKIE_DOMAIN, 'from-base')
  assert.equal(result.values.PROFILE_ONLY, 'profile')
  assert.equal(result.values.LOCAL_ONLY, 'local')
  rmSync(appDirectory, { recursive: true, force: true })
})

test('validateVariable distinguishes missing, invalid, placeholder, and valid values', () => {
  assert.equal(validateVariable({ name: 'PUBLIC_BASE_URL', kind: 'url' }, {}).level, 'error')
  assert.equal(validateVariable({ name: 'PUBLIC_BASE_URL', kind: 'url' }, { PUBLIC_BASE_URL: 'localhost' }).level, 'error')
  assert.equal(validateVariable({ name: 'GOOGLE_OAUTH_CLIENT_ID', kind: 'text', emptyIsPlaceholder: true }, { GOOGLE_OAUTH_CLIENT_ID: '' }).level, 'warn')
  assert.equal(validateVariable({ name: 'COOKIE_TOKEN_NAME', kind: 'cookie-name' }, { COOKIE_TOKEN_NAME: 'slax_test' }).level, 'ok')
})

test('formatIssue colors statuses only when requested', () => {
  assert.equal(formatIssue({ level: 'ok', message: 'ready' }, false), '✓ ready')
  assert.match(formatIssue({ level: 'error', message: 'missing' }, true), /\u001b\[31m✗\u001b\[0m \u001b\[31mmissing\u001b\[0m/)
})

test('parseArgs supports explicit color controls', () => {
  assert.equal(parseArgs(['--color']).color, true)
  assert.equal(parseArgs(['--no-color']).color, false)
})

test('app environment examples include each required frontend variable', () => {
  const web = parseEnvText(readFileSync(new URL('../apps/web/.env.example', import.meta.url), 'utf8'))
  const extension = parseEnvText(readFileSync(new URL('../apps/extension/.env.example', import.meta.url), 'utf8'))

  for (const name of ['SLAX_ENV', 'PUBLIC_BASE_URL', 'AUTH_BASE_URL', 'SHARE_BASE_URL', 'DWEB_API_BASE_URL', 'COOKIE_DOMAIN', 'COOKIE_TOKEN_NAME', 'GOOGLE_OAUTH_CLIENT_ID', 'APPLE_OAUTH_CLIENT_ID', 'TURNSTILE_SITE_KEY', 'SLAX_BACKEND_DIR']) {
    assert.ok(name in web, `Web example is missing ${name}`)
  }
  for (const name of ['SLAX_ENV', 'PUBLIC_BASE_URL', 'AUTH_BASE_URL', 'SHARE_BASE_URL', 'EXTENSIONS_API_BASE_URL', 'COOKIE_DOMAIN', 'COOKIE_TOKEN_NAME', 'GOOGLE_ANALYTICS_MEASUREMENT_ID', 'GOOGLE_ANALYTICS_API_SECRET', 'UNINSTALL_FEEDBACK_URL']) {
    assert.ok(name in extension, `Extension example is missing ${name}`)
  }
})
