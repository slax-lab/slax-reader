import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isSupportedNode, APP_CHECKS, environmentSetupHint, formatIssue, parseArgs, parseEnvText, readEnvSources, run, validateVariable } from './preflight.mjs'

test('parseEnvText reads export syntax and quoted values without exposing values', () => {
  const values = parseEnvText(`\n# comment\nexport PUBLIC_BASE_URL="http://localhost:3000"\nCOOKIE_DOMAIN=localhost\n`)

  assert.deepEqual(values, {
    PUBLIC_BASE_URL: 'http://localhost:3000',
    COOKIE_DOMAIN: 'localhost'
  })
})

test('readEnvSources follows deploy precedence and process variables win', () => {
  const appDirectory = mkdtempSync(join(tmpdir(), 'slax-reader-preflight-'))
  writeFileSync(join(appDirectory, '.env.web'), 'COOKIE_DOMAIN=from-base\nFIRST_FILE=base\n')
  writeFileSync(join(appDirectory, '.env.web.dev'), 'COOKIE_DOMAIN=from-profile\nPROFILE_ONLY=profile\n')

  const result = readEnvSources(appDirectory, 'development', { PUBLIC_BASE_URL: 'https://process.example' }, { fileAppName: 'web' })

  assert.equal(result.values.PUBLIC_BASE_URL, 'https://process.example')
  assert.equal(result.sources.PUBLIC_BASE_URL, 'process environment')
  assert.equal(result.values.COOKIE_DOMAIN, 'from-profile')
  assert.equal(result.values.PROFILE_ONLY, 'profile')
  rmSync(appDirectory, { recursive: true, force: true })
})

test('validateVariable distinguishes required and optional configuration states', () => {
  assert.match(validateVariable({ name: 'PUBLIC_BASE_URL', kind: 'url', required: true }, {}).message, /PUBLIC_BASE_URL（必填）\s+未配置/)
  assert.match(validateVariable({ name: 'PUBLIC_BASE_URL', kind: 'url', required: true }, { PUBLIC_BASE_URL: 'localhost' }).message, /PUBLIC_BASE_URL（必填）\s+不是有效的 http\/https 地址/)
  assert.match(validateVariable({ name: 'GOOGLE_OAUTH_CLIENT_ID', kind: 'text', required: true }, { GOOGLE_OAUTH_CLIENT_ID: '' }).message, /GOOGLE_OAUTH_CLIENT_ID（必填）\s+为空/)
  assert.equal(validateVariable({ name: 'APPLE_OAUTH_CLIENT_ID', kind: 'text', required: false }, {}).level, 'info')
  assert.match(validateVariable({ name: 'TURNSTILE_SITE_KEY', kind: 'text', required: false }, { TURNSTILE_SITE_KEY: '' }).message, /TURNSTILE_SITE_KEY（可选）\s+未配置/)
  assert.match(validateVariable({ name: 'COOKIE_TOKEN_NAME', kind: 'cookie-name', required: true }, { COOKIE_TOKEN_NAME: 'slax_test' }).message, /COOKIE_TOKEN_NAME（必填）\s+已配置/)
})

test('Web preflight classifies Google as required and Apple/Turnstile as optional', () => {
  const variables = Object.fromEntries(APP_CHECKS.web.variables.map(variable => [variable.name, variable]))

  assert.equal(variables.GOOGLE_OAUTH_CLIENT_ID.required, true)
  assert.equal(variables.APPLE_OAUTH_CLIENT_ID.required, false)
  assert.equal(variables.TURNSTILE_SITE_KEY.required, false)
  assert.equal(validateVariable(variables.GOOGLE_OAUTH_CLIENT_ID, {}).level, 'error')
  assert.equal(validateVariable(variables.APPLE_OAUTH_CLIENT_ID, {}).level, 'info')
  assert.equal(validateVariable(variables.TURNSTILE_SITE_KEY, {}).level, 'info')
})

test('formatIssue colors statuses only when requested', () => {
  assert.equal(formatIssue({ level: 'ok', message: 'ready' }, false), '✓ ready')
  assert.match(formatIssue({ level: 'error', message: 'missing' }, true), /\u001b\[31m✗\u001b\[0m \u001b\[31mmissing\u001b\[0m/)
})

test('parseArgs supports explicit color controls', () => {
  assert.equal(parseArgs(['--color']).color, true)
  assert.equal(parseArgs(['--no-color']).color, false)
  assert.equal(parseArgs(['--', '--app', 'extension', '--env', 'preview']).env, 'preview')
  assert.equal(parseArgs([]).env, undefined)
  assert.throws(() => parseArgs(['--env']), /--env/)
})

test('app environment examples include each required frontend variable', () => {
  const web = parseEnvText(readFileSync(new URL('../deploy/local/.env.web.example', import.meta.url), 'utf8'))
  const extension = parseEnvText(readFileSync(new URL('../deploy/local/.env.extension.example', import.meta.url), 'utf8'))

  for (const name of ['SLAX_ENV', 'PUBLIC_BASE_URL', 'AUTH_BASE_URL', 'SHARE_BASE_URL', 'DWEB_API_BASE_URL', 'COOKIE_DOMAIN', 'COOKIE_TOKEN_NAME', 'GOOGLE_OAUTH_CLIENT_ID', 'APPLE_OAUTH_CLIENT_ID', 'TURNSTILE_SITE_KEY']) {
    assert.ok(name in web, `Web example is missing ${name}`)
  }
  for (const name of ['SLAX_ENV', 'PUBLIC_BASE_URL', 'AUTH_BASE_URL', 'SHARE_BASE_URL', 'EXTENSIONS_API_BASE_URL', 'COOKIE_DOMAIN', 'COOKIE_TOKEN_NAME', 'GOOGLE_ANALYTICS_MEASUREMENT_ID', 'GOOGLE_ANALYTICS_API_SECRET', 'UNINSTALL_FEEDBACK_URL']) {
    assert.ok(name in extension, `Extension example is missing ${name}`)
  }
})

test('environment setup hints point to deploy files and examples for both apps', () => {
  const hint = environmentSetupHint(APP_CHECKS.web, 'preview')
  assert.match(hint, /deploy\/local\/\.env\.web(?!\.)/)
  assert.match(hint, /deploy\/local\/\.env\.web\.preview/)
  assert.match(hint, /deploy\/local\/\.env\.web\.example/)
  const extensionHint = environmentSetupHint(APP_CHECKS.extension, 'development')
  assert.match(extensionHint, /deploy\/local\/\.env\.extension\.example/)
  assert.match(extensionHint, /deploy\/local\/\.env\.extension\.dev/)
})

test('preflight points to deploy files without printing environment values', () => {
  const root = mkdtempSync(join(tmpdir(), 'slax-reader-preflight-output-'))
  const deployDirectory = join(root, 'deploy', 'local')
  mkdirSync(deployDirectory, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.25.0' }))
  writeFileSync(
    join(deployDirectory, '.env.web'),
    [
      'PUBLIC_BASE_URL=http://localhost:3000',
      'AUTH_BASE_URL=http://localhost:3000',
      'SHARE_BASE_URL=http://localhost:3000',
      'DWEB_API_BASE_URL=http://localhost:8787',
      'COOKIE_DOMAIN=localhost',
      'COOKIE_TOKEN_NAME=slax_test',
      'GOOGLE_OAUTH_CLIENT_ID=placeholder-client-id',
      'OUTPUT_SECRET_MARKER=do-not-print'
    ].join('\n')
  )

  const lines = []
  const originalLog = console.log
  console.log = (...args) => lines.push(args.join(' '))
  try {
    run({ app: 'web', env: 'development', color: false }, root, {})
  } finally {
    console.log = originalLog
  }

  const output = lines.join('\n')
  assert.match(output, /deploy\/local\/\.env\.web/)
  assert.doesNotMatch(output, /do-not-print/)
  assert.doesNotMatch(output, /placeholder-client-id|http:\/\/localhost/)
  rmSync(root, { recursive: true, force: true })
})

test('preflight selects the same profile as dispatch and continues after one app has invalid config', t => {
  const root = mkdtempSync(join(tmpdir(), 'slax-reader-preflight-profile-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'deploy', 'local'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.25.0' }))
  writeFileSync(join(root, 'deploy/local/.env.web'), 'TOKEN="not-to-be-logged')
  writeFileSync(join(root, 'deploy/local/.env.extension'), 'SLAX_ENV=preview\n')
  writeFileSync(join(root, 'deploy/local/.env.extension.preview'), 'COOKIE_DOMAIN=example.test\n')
  const lines = []
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')))
  assert.equal(run({ app: 'all', color: false }, root, {}), 1)
  const output = lines.join('\n')
  assert.match(output, /Web 环境文件语法无效/)
  assert.match(output, /环境：preview.*local\/\.env\.extension\.preview/)
  assert.match(output, /COOKIE_DOMAIN（必填） 已配置/)
  assert.doesNotMatch(output, /not-to-be-logged|example\.test/)
})


test('Node check respects the supported LTS ranges rather than a minimum only', () => {
  for (const version of ['22.22.2', '22.23.0', '24.15.0', '26.0.0']) assert.equal(isSupportedNode(version), true, version)
  for (const version of ['22.13.0', '22.22.1', '23.0.0', '24.14.9', '25.0.0']) assert.equal(isSupportedNode(version), false, version)
})
