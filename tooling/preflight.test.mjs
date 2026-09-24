import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

import {
  APP_CHECKS,
  checkApi,
  checkDocker,
  checkFrontendPreparation,
  checkLocalApiServices,
  dockerComposeRecords,
  environmentSetupHint,
  formatIssue,
  isSupportedNode,
  moduleStatus,
  parseApiVars,
  parseArgs,
  parseEnvText,
  readEnvSources,
  run,
  validateVariable
} from './preflight.mjs'

test('parseEnvText reads export syntax and quoted values without exposing values', () => {
  const values = parseEnvText(`\n# comment\nexport PUBLIC_BASE_URL="http://localhost:3000"\nCOOKIE_DOMAIN=localhost\n`)

  assert.deepEqual(values, {
    PUBLIC_BASE_URL: 'http://localhost:3000',
    COOKIE_DOMAIN: 'localhost'
  })
})

test('parseApiVars remains compatible with dotenv-style quoted JWK values', () => {
  const values = parseApiVars(`export JWT_SECRET_TEXT='fixture-secret'\nPOWERSYNC_JWK_PRIVATE_KEY='{"kty":"RSA","kid":"fixture"}'\n`)
  assert.equal(values.JWT_SECRET_TEXT, 'fixture-secret')
  assert.equal(values.POWERSYNC_JWK_PRIVATE_KEY, '{"kty":"RSA","kid":"fixture"}')
  assert.equal(parseApiVars('JWT_SECRET_TEXT="a\nb" # comment').JWT_SECRET_TEXT, 'a\nb')
  assert.equal(parseApiVars('JWT_SECRET_TEXT="a" # comment').JWT_SECRET_TEXT, 'a')
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
  assert.match(
    validateVariable({ name: 'PUBLIC_BASE_URL', kind: 'url', required: true }, { PUBLIC_BASE_URL: 'localhost' }).message,
    /PUBLIC_BASE_URL（必填）\s+不是有效的 http\/https 地址/
  )
  assert.match(validateVariable({ name: 'GOOGLE_OAUTH_CLIENT_ID', kind: 'text', required: true }, { GOOGLE_OAUTH_CLIENT_ID: '' }).message, /GOOGLE_OAUTH_CLIENT_ID（必填）\s+为空/)
  assert.equal(validateVariable({ name: 'APPLE_OAUTH_CLIENT_ID', kind: 'text', required: false }, {}).level, 'info')
  assert.match(validateVariable({ name: 'TURNSTILE_SITE_KEY', kind: 'text', required: false }, { TURNSTILE_SITE_KEY: '' }).message, /TURNSTILE_SITE_KEY（可选）\s+未配置/)
  assert.match(
    validateVariable({ name: 'COOKIE_TOKEN_NAME', kind: 'cookie-name', required: true }, { COOKIE_TOKEN_NAME: 'slax_test' }).message,
    /COOKIE_TOKEN_NAME（必填）\s+已配置/
  )
})

test('Web preflight classifies Google as required and Apple/Turnstile as optional', () => {
  const variables = Object.fromEntries(APP_CHECKS.web.variables.map(variable => [variable.name, variable]))

  assert.equal(variables.GOOGLE_OAUTH_CLIENT_ID.required, true)
  assert.equal(variables.APPLE_OAUTH_CLIENT_ID.required, false)
  assert.equal(variables.TURNSTILE_SITE_KEY.required, false)
  assert.equal(validateVariable(variables.GOOGLE_OAUTH_CLIENT_ID, {}).level, 'warn')
  assert.equal(validateVariable(variables.APPLE_OAUTH_CLIENT_ID, {}).level, 'info')
  assert.equal(validateVariable(variables.TURNSTILE_SITE_KEY, {}).level, 'info')
})

test('formatIssue colors statuses only when requested', () => {
  assert.equal(formatIssue({ level: 'ok', message: 'ready' }, false), '✓ ready')
  assert.match(formatIssue({ level: 'error', message: 'missing' }, true), /\u001b\[31m✗\u001b\[0m \u001b\[31m【阻止启动】missing\u001b\[0m/)
})

test('parseArgs supports explicit color controls', () => {
  assert.equal(parseArgs(['--color']).color, true)
  assert.equal(parseArgs(['--no-color']).color, false)
  assert.equal(parseArgs(['--', '--app', 'extension', '--env', 'preview']).env, 'preview')
  assert.equal(parseArgs([]).env, undefined)
  assert.equal(parseArgs(['--app', 'api']).app, 'api')
  assert.throws(() => parseArgs(['--env']), /--env/)
})

test('module status prioritizes startup blockers over functionality failures and ignores reminders', () => {
  const limited = { level: 'warn', impact: 'functionality' }
  assert.deepEqual(moduleStatus(APP_CHECKS.web, [limited]), {
    level: 'warn',
    message: 'Web 可启动，但无法正常运行'
  })
  assert.deepEqual(moduleStatus(APP_CHECKS.web, [limited, { level: 'error', impact: 'startup' }]), { level: 'error', message: 'Web 当前无法启动' })
  assert.deepEqual(moduleStatus(APP_CHECKS.extension, [{ level: 'warn' }, { level: 'info' }]), {
    level: 'ok',
    message: 'Extension 启动检查通过'
  })
})

test('Web preflight distinguishes missing generated state from a prepared checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'slax-reader-preflight-web-state-'))
  try {
    const missing = checkFrontendPreparation(APP_CHECKS.web, root, {}, () => ({
      status: 0,
      stdout: 'template'
    }))
    assert.deepEqual(
      missing.filter(issue => issue.level === 'error').map(issue => issue.impact),
      ['startup']
    )
    assert.match(missing.map(issue => issue.message).join('\n'), /pnpm web -- setup/)

    for (const file of APP_CHECKS.web.generatedState) {
      const path = join(root, file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, '')
    }
    const prepared = checkFrontendPreparation(APP_CHECKS.web, root, {}, () => ({
      status: 0,
      stdout: 'template'
    }))
    assert.equal(
      prepared.some(issue => issue.level === 'error'),
      false
    )
    assert.match(prepared.find(issue => issue.message.includes('Web API 联调未就绪')).message, /pnpm api -- config:init/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Extension preflight distinguishes missing generated state from a prepared checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'slax-reader-preflight-extension-state-'))
  try {
    const missing = checkFrontendPreparation(APP_CHECKS.extension, root)
    assert.equal(missing.filter(issue => issue.level === 'error').length, 1)
    assert.match(missing[0].message, /pnpm extension -- setup/)

    const generated = join(root, APP_CHECKS.extension.generatedState[0])
    mkdirSync(dirname(generated), { recursive: true })
    writeFileSync(generated, '')
    const prepared = checkFrontendPreparation(APP_CHECKS.extension, root)
    assert.equal(
      prepared.some(issue => issue.level === 'error'),
      false
    )
    assert.match(prepared.map(issue => issue.message).join('\n'), /Web 与 API 服务同时运行/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('docker compose output parser accepts array and line-delimited records', () => {
  assert.equal(dockerComposeRecords(JSON.stringify([{ Service: 'postgres', State: 'running' }])).length, 1)
  assert.equal(dockerComposeRecords('{"Service":"postgres"}\n{"Service":"powersync"}').length, 2)
  assert.deepEqual(dockerComposeRecords(''), [])
})

test('Docker preflight separates missing executable, Compose plugin, and daemon states', () => {
  const missing = checkDocker('/tmp', {}, () => ({
    error: new Error('ENOENT'),
    status: null,
    stdout: '',
    stderr: ''
  }))
  assert.equal(missing[0].level, 'warn')
  assert.equal(missing[0].impact, 'functionality')
  assert.match(missing[0].message, /docs\.docker\.com\/get-docker/)

  const compose = checkDocker('/tmp', {}, (_program, args) => (args[1] === 'version' ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout: '', stderr: '' }))
  assert.equal(compose.at(-1).level, 'warn')
  assert.equal(compose.at(-1).impact, 'functionality')
  assert.match(compose.at(-1).message, /Compose plugin/)

  const unsupportedWait = checkDocker('/tmp', {}, (_program, args) => {
    if (args[1] === 'up') return { status: 0, stdout: 'Usage: docker compose up', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  })
  assert.equal(unsupportedWait.at(-1).level, 'warn')
  assert.equal(unsupportedWait.at(-1).impact, 'functionality')
  assert.match(unsupportedWait.at(-1).message, /up --wait/)

  const daemon = checkDocker('/tmp', {}, (_program, args) => {
    if (args[0] === 'info') return { status: 1, stdout: '', stderr: '' }
    if (args[1] === 'up') return { status: 0, stdout: '--wait', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  })
  assert.equal(daemon.at(-1).level, 'warn')
  assert.equal(daemon.at(-1).impact, 'functionality')
  assert.match(daemon.at(-1).message, /daemon 不可用/)
})

test('API service preflight classifies absent, unhealthy, and healthy Compose services', () => {
  const root = mkdtempSync(join(tmpdir(), 'slax-reader-preflight-compose-'))
  try {
    mkdirSync(join(root, 'deploy', 'local'), { recursive: true })
    writeFileSync(join(root, 'deploy/local/dockerfile-local-pgsql.yaml'), 'services: {}\n')
    const probe = () => ({
      status: 0,
      stdout: JSON.stringify([
        { Service: 'postgres', State: 'running', Health: 'healthy' },
        { Service: 'powersync', State: 'running', Health: 'starting' },
        { Service: 'powersync-api', State: 'exited', Health: '' }
      ]),
      stderr: ''
    })
    const issues = checkLocalApiServices(root, {}, probe)
    assert.match(issues.find(issue => issue.message.includes('postgres')).message, /健康/)
    assert.match(issues.find(issue => issue.message.includes('powersync 容器')).message, /starting/)
    assert.match(issues.find(issue => issue.message.includes('powersync-api')).message, /exited/)

    const missing = checkLocalApiServices(root, {}, () => ({
      status: 0,
      stdout: '',
      stderr: ''
    }))
    assert.equal(missing.filter(issue => issue.impact === 'functionality').length, 3)
    assert.ok(missing.every(issue => issue.level === 'warn'))
    const unknown = checkLocalApiServices(root, {}, () => ({
      status: 0,
      stdout: JSON.stringify([
        {
          Name: 'dev-powersync-api',
          State: 'running',
          Health: 'healthy'
        },
        { Service: 'postgres', State: 'running', Health: '' }
      ])
    }))
    assert.match(unknown[0].message, /尚未确认健康/)
    assert.match(unknown[1].message, /尚未创建/)
    assert.match(unknown.find(issue => issue.message.includes('powersync-api')).message, /尚未创建/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function readinessFixture(t, app) {
  const root = mkdtempSync(join(tmpdir(), 'slax-reader-readiness-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, value = '') => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), value)
  }
  put('node_modules/.modules.yaml')
  for (const name of app.workspaceDependencies)
    mkdirSync(join(root, app.directory, 'node_modules', name), {
      recursive: true
    })
  put(`${app.directory}/node_modules/.bin/${app.command}`)
  return { root, put }
}

for (const name of ['web', 'extension']) {
  test(`${name} reports all three readiness states and remediation with module filtering`, t => {
    const app = APP_CHECKS[name]
    const { root, put } = readinessFixture(t, app)
    const lines = []
    t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')))
    const checks = {
      runtimeIssues: [],
      probe: () => ({ status: 0, stdout: 'configured' })
    }
    const execute = env => {
      lines.length = 0
      const status = run({ app: name, color: false }, root, env, checks)
      return { status, output: lines.join('\n') }
    }
    const env = Object.fromEntries(app.variables.filter(v => v.required).map(v => [v.name, v.kind === 'url' ? 'http://example.test' : 'fixture-value']))
    const invalid = execute({ ...env, COOKIE_TOKEN_NAME: '' })
    assert.equal(invalid.status, 1)
    assert.match(invalid.output, new RegExp(`${app.label} 当前无法启动`))
    assert.match(invalid.output, new RegExp(`\\.env\\.${name}\\.example`))
    const incomplete = execute(env)
    assert.equal(incomplete.status, 1)
    assert.match(incomplete.output, new RegExp(`${app.label} 当前无法启动`))
    for (const file of app.generatedState) put(file)
    mkdirSync(join(root, 'deploy/local/.wrangler/state/v3'), {
      recursive: true
    })
    const limited = execute({ ...env, COOKIE_TOKEN_NAME: '' })
    assert.equal(limited.status, 1)
    assert.match(limited.output, new RegExp(`${app.label} 可启动，但无法正常运行`))
    assert.match(limited.output, /0 个启动阻塞问题，1 个功能受限问题/)
    assert.match(limited.output, /【功能受限】.*COOKIE_TOKEN_NAME/)
    assert.ok(limited.output.indexOf(`${app.label} 可启动`) < limited.output.indexOf('workspace 依赖'))
    if (name === 'extension') assert.match(execute({ ...env, PUBLIC_BASE_URL: '' }).output, /Extension 当前无法启动/)
    const ready = execute(env)
    assert.equal(ready.status, 0)
    assert.match(ready.output, new RegExp(`${app.label} 启动检查通过`))
    assert.doesNotMatch(ready.output, /\u001b\[|fixture-value|example\.test|API 启动检查通过|Docker/)
    checks.runtimeIssues = [{ level: 'error', message: 'Unsupported Node fixture' }]
    assert.match(execute(env).output, new RegExp(`${app.label} 当前无法启动`))
  })
}

test('API validates configuration independently of Docker and secrets and never replays child output', t => {
  const app = APP_CHECKS.api
  const { root, put } = readinessFixture(t, app)
  const require = createRequire(new URL('../apps/api/package.json', import.meta.url))
  symlinkSync(dirname(require.resolve('dotenv/package.json')), join(root, app.directory, 'node_modules/dotenv'), 'dir')
  put('custom/api.toml', 'fixture')
  put('deploy/local/dockerfile-local-pgsql.yaml')
  const key = {
    kty: 'RSA',
    ...Object.fromEntries(['kid', 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'].map(name => [name, 'fixture']))
  }
  put(
    'deploy/local/.dev.vars',
    ['JWT_SECRET_TEXT=fixture', 'HASH_IDS_SALT=fixture', 'EDGE_SHARED_SECRET=fixture', `POWERSYNC_JWK_PRIVATE_KEY='${JSON.stringify(key)}' # comment`].join('\n')
  )
  const calls = []
  let readiness = { startup: true, local: true }
  let dockerStatus = 0
  let probeStatus = 0
  let services = []
  const environment = {
    SLAX_API_CONFIG: 'custom/api.toml',
    SLAX_API_ENV: 'local-test',
    npm_execpath: process.env.npm_execpath
  }
  const probe = (program, args, cwd, env) => {
    calls.push({ program, args, cwd, env })
    return {
      status: program === 'docker' ? dockerStatus : probeStatus,
      stdout: args.includes('script/deploy/check-readiness.ts')
        ? JSON.stringify(readiness)
        : args.includes('ps')
          ? JSON.stringify(services)
          : args[1] === 'up'
            ? '--wait'
            : 'PRIVATE_OUTPUT_MARKER',
      stderr: 'PRIVATE_OUTPUT_MARKER'
    }
  }
  let issues = checkApi(app, root, environment, probe)
  assert.equal(moduleStatus(app, issues).message, 'API 当前无法启动')
  const call = calls.find(call => call.args.includes('script/deploy/check-readiness.ts'))
  assert.deepEqual(call.args.slice(-7), ['--filter', 'slax-reader-backend', 'exec', 'tsx', '--tsconfig', 'tsconfig.json', 'script/deploy/check-readiness.ts'])
  assert.equal(call.env.SLAX_API_ENV, 'local-test')
  assert.equal(call.env.SLAX_API_CONFIG, 'custom/api.toml')
  for (const file of app.generatedState) put(file)
  issues = checkApi(app, root, environment, probe)
  assert.equal(moduleStatus(app, issues).message, 'API 可启动，但无法正常运行')
  services = ['postgres', 'powersync', 'powersync-api'].map(Service => ({
    Service,
    State: 'running',
    Health: 'healthy'
  }))
  issues = checkApi(app, root, environment, probe)
  assert.equal(moduleStatus(app, issues).message, 'API 启动检查通过')
  rmSync(join(root, app.generatedState[0]))
  assert.equal(moduleStatus(app, checkApi(app, root, environment, probe)).message, 'API 可启动，但无法正常运行')
  put(app.generatedState[0])
  dockerStatus = 1
  assert.equal(moduleStatus(app, checkApi(app, root, environment, probe)).message, 'API 可启动，但无法正常运行')
  rmSync(join(root, 'deploy/local/.dev.vars'))
  readiness = { startup: false, local: false }
  issues = checkApi(app, root, environment, probe)
  assert.equal(moduleStatus(app, issues).message, 'API 当前无法启动')
  assert.match(issues.map(issue => issue.message).join('\n'), /API 启动配置无效/)
  assert.match(issues.map(issue => issue.message).join('\n'), /未检测到 Docker/)
  readiness = { startup: true, local: false }
  assert.equal(moduleStatus(app, checkApi(app, root, environment, probe)).message, 'API 可启动，但无法正常运行')
  put('deploy/local/.dev.vars', 'JWT_SECRET_TEXT=fixture\nPOWERSYNC_JWK_PRIVATE_KEY=invalid-private-marker')
  issues = checkApi(app, root, environment, probe)
  assert.match(issues.map(issue => issue.message).join('\n'), /HASH_IDS_SALT/)
  assert.match(issues.map(issue => issue.message).join('\n'), /有效 RSA/)
  assert.doesNotMatch(issues.map(issue => issue.message).join('\n'), /invalid-private-marker|PRIVATE_OUTPUT_MARKER/)
  for (const malformed of ['PRIVATE_OUTPUT_MARKER', null, { startup: true }, { startup: 'yes', local: true }]) {
    readiness = malformed
    assert.equal(moduleStatus(app, checkApi(app, root, environment, probe)).message, 'API 当前无法启动')
  }
  readiness = { startup: true, local: true }
  probeStatus = 1
  assert.equal(moduleStatus(app, checkApi(app, root, environment, probe)).message, 'API 当前无法启动')
  rmSync(join(root, app.directory, 'node_modules/.bin/tsx'))
  calls.length = 0
  checkApi(app, root, environment, probe)
  assert.equal(
    calls.some(call => call.args.includes('script/deploy/check-readiness.ts')),
    false
  )
})

test('all-module reports propagate known peer failures without inspecting peers for narrow checks', t => {
  const { root, put } = readinessFixture(t, APP_CHECKS.api)
  const environment = {}
  for (const app of Object.values(APP_CHECKS)) {
    for (const name of app.workspaceDependencies)
      mkdirSync(join(root, app.directory, 'node_modules', name), {
        recursive: true
      })
    put(`${app.directory}/node_modules/.bin/${app.command}`)
    for (const file of app.generatedState) put(file)
    for (const variable of app.variables.filter(v => v.required)) environment[variable.name] = variable.kind === 'url' ? 'http://example.test' : 'fixture-value'
  }
  put('deploy/local/api.toml', 'fixture')
  put('deploy/local/dockerfile-local-pgsql.yaml')
  const key = {
    kty: 'RSA',
    ...Object.fromEntries(['kid', 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'].map(name => [name, 'fixture']))
  }
  put('deploy/local/.dev.vars', `JWT_SECRET_TEXT=fixture\nHASH_IDS_SALT=fixture\nEDGE_SHARED_SECRET=fixture\nPOWERSYNC_JWK_PRIVATE_KEY='${JSON.stringify(key)}'`)
  const services = ['postgres', 'powersync', 'powersync-api'].map(Service => ({ Service, State: 'running', Health: 'healthy' }))
  let dockerStatus = 1
  const calls = []
  const lines = []
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')))
  const probe = (program, args) => {
    calls.push({ program, args })
    return {
      status: program === 'docker' ? dockerStatus : 0,
      stdout: args.includes('script/deploy/check-readiness.ts')
        ? '{"startup":true,"local":true}'
        : args.includes('ps')
          ? JSON.stringify(services)
          : args[1] === 'up'
            ? '--wait'
            : 'configured'
    }
  }
  const execute = app => {
    calls.length = 0
    lines.length = 0
    return {
      status: run({ app, color: false }, root, environment, {
        runtimeIssues: [],
        probe
      }),
      output: lines.join('\n')
    }
  }
  const limited = execute('all')
  assert.equal(limited.status, 1)
  for (const app of Object.values(APP_CHECKS)) assert.match(limited.output, new RegExp(`${app.label} 可启动，但无法正常运行`))
  assert.match(limited.output, /0 个启动阻塞问题，4 个功能受限问题/)
  for (const app of ['web', 'extension']) {
    assert.equal(execute(app).status, 0)
    assert.equal(
      calls.some(call => call.program === 'docker' || call.args.includes('script/deploy/check-readiness.ts')),
      false
    )
  }
  dockerStatus = 0
  // Web dev regenerates the projection; it is not an imported startup artifact.
  rmSync(join(root, 'deploy/local/.generated/web/wrangler.toml'))
  assert.equal(execute('all').status, 0)
  delete environment.GOOGLE_OAUTH_CLIENT_ID
  const loginFailure = execute('all')
  assert.equal(loginFailure.status, 1)
  assert.match(loginFailure.output, /API 启动检查通过/)
  assert.match(loginFailure.output, /Web 可启动，但无法正常运行/)
  assert.match(loginFailure.output, /Extension 可启动，但无法正常运行/)
  assert.match(loginFailure.output, /GOOGLE_OAUTH_CLIENT_ID.*登录与会话/)
  rmSync(join(root, 'apps/web/.nuxt/tsconfig.server.json'))
  assert.match(execute('all').output, /Web 当前无法启动/)
})

test('API preflight reports safe configuration remediation without reading secrets into output', () => {
  const root = mkdtempSync(join(tmpdir(), 'slax-reader-preflight-api-'))
  mkdirSync(join(root, 'deploy', 'local'), { recursive: true })
  const issues = checkApi(APP_CHECKS.api, root, {})
  const output = issues.map(issue => issue.message).join('\n')
  assert.match(output, /API 配置缺失/)
  assert.match(output, /\.dev\.vars/)
  assert.match(output, /pnpm api -- setup/)
  assert.doesNotMatch(output, /PRIVATE|SECRET_VALUE|BEGIN RSA/)
  rmSync(root, { recursive: true, force: true })
})

test('app environment examples include each required frontend variable', () => {
  const web = parseEnvText(readFileSync(new URL('../deploy/local/.env.web.example', import.meta.url), 'utf8'))
  const extension = parseEnvText(readFileSync(new URL('../deploy/local/.env.extension.example', import.meta.url), 'utf8'))

  for (const name of [
    'SLAX_ENV',
    'PUBLIC_BASE_URL',
    'AUTH_BASE_URL',
    'SHARE_BASE_URL',
    'DWEB_API_BASE_URL',
    'COOKIE_DOMAIN',
    'COOKIE_TOKEN_NAME',
    'GOOGLE_OAUTH_CLIENT_ID',
    'APPLE_OAUTH_CLIENT_ID',
    'TURNSTILE_SITE_KEY'
  ]) {
    assert.ok(name in web, `Web example is missing ${name}`)
  }
  for (const name of [
    'SLAX_ENV',
    'PUBLIC_BASE_URL',
    'AUTH_BASE_URL',
    'SHARE_BASE_URL',
    'EXTENSIONS_API_BASE_URL',
    'COOKIE_DOMAIN',
    'COOKIE_TOKEN_NAME',
    'GOOGLE_ANALYTICS_MEASUREMENT_ID',
    'GOOGLE_ANALYTICS_API_SECRET',
    'UNINSTALL_FEEDBACK_URL'
  ]) {
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
