#!/usr/bin/env node

import { pnpmInvocation } from './pnpm-command.mjs'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { devNull } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { DEPLOY_DIRECTORIES, ENV_NAMES, loadDeployEnvironment, parseEnvironmentText as parseEnvText, profileFileName, readEnvSources } from './env-files.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const APP_CHECKS = {
  web: {
    label: 'Web',
    environmentApp: 'web',
    directory: 'apps/web',
    deployDirectory: DEPLOY_DIRECTORIES.web,
    command: 'nuxt',
    workspaceDependencies: ['@slax-reader/contracts', '@commons/frontend-types', '@commons/frontend-utils', '@slax-reader/selection'],
    variables: [
      { name: 'PUBLIC_BASE_URL', kind: 'url', required: true },
      { name: 'AUTH_BASE_URL', kind: 'url', required: true },
      { name: 'SHARE_BASE_URL', kind: 'url', required: true },
      { name: 'DWEB_API_BASE_URL', kind: 'url', required: true },
      { name: 'COOKIE_DOMAIN', kind: 'text', required: true },
      { name: 'COOKIE_TOKEN_NAME', kind: 'cookie-name', required: true },
      { name: 'GOOGLE_OAUTH_CLIENT_ID', kind: 'text', required: true },
      { name: 'APPLE_OAUTH_CLIENT_ID', kind: 'text', required: false },
      { name: 'TURNSTILE_SITE_KEY', kind: 'text', required: false }
    ],
    generatedState: ['apps/web/.nuxt/tsconfig.server.json', 'deploy/local/.generated/web/wrangler.toml'],
    setupCommand: 'pnpm web -- setup'
  },
  extension: {
    label: 'Extension',
    environmentApp: 'extension',
    directory: 'apps/extension',
    deployDirectory: DEPLOY_DIRECTORIES.extension,
    command: 'wxt',
    workspaceDependencies: ['@slax-reader/contracts', '@commons/frontend-types', '@commons/frontend-utils', '@slax-reader/selection'],
    variables: [
      {
        name: 'PUBLIC_BASE_URL',
        kind: 'url',
        required: true,
        impact: 'startup'
      },
      { name: 'AUTH_BASE_URL', kind: 'url', required: true },
      { name: 'SHARE_BASE_URL', kind: 'url', required: true },
      { name: 'EXTENSIONS_API_BASE_URL', kind: 'url', required: true },
      { name: 'COOKIE_DOMAIN', kind: 'text', required: true },
      { name: 'COOKIE_TOKEN_NAME', kind: 'cookie-name', required: true }
    ],
    generatedState: ['apps/extension/.wxt/tsconfig.json'],
    setupCommand: 'pnpm extension -- setup'
  },
  api: {
    label: 'API',
    environmentApp: 'api',
    directory: 'apps/api',
    deployDirectory: 'deploy/local',
    command: 'tsx',
    workspaceDependencies: ['@slax-reader/contracts'],
    variables: [],
    generatedState: [
      'deploy/local/.wrangler/state/v3/d1',
      'apps/api/src/di/generated/dependency.ts',
      'apps/api/node_modules/.prisma/client/default.js',
      'apps/api/node_modules/@prisma/hyperdrive-client/index.js',
      'apps/api/node_modules/@prisma/logs-client/index.js'
    ],
    setupCommand: 'pnpm api -- setup'
  }
}

const ICONS = { ok: '✓', warn: '⚠', error: '✗', info: '•' }
const ANSI = {
  title: '\u001b[1;36m',
  heading: '\u001b[1m',
  muted: '\u001b[2m',
  ok: '\u001b[32m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
  info: '\u001b[36m',
  reset: '\u001b[0m'
}

function parseArgs(argv) {
  const options = { app: 'all', env: undefined, help: false, color: undefined }
  if (argv[0] === '--') argv = argv.slice(1)

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--app') {
      options.app = argv[++index]
    } else if (argument === '--env') {
      options.env = argv[++index]
      if (!ENV_NAMES.has(options.env)) {
        throw new Error('--env 只能是 development、preview、beta 或 production')
      }
    } else if (argument === '--color') {
      options.color = true
    } else if (argument === '--no-color') {
      options.color = false
    } else {
      throw new Error(`未知参数：${argument}`)
    }
  }

  if (!['all', ...Object.keys(APP_CHECKS)].includes(options.app)) {
    throw new Error(`--app 只能是 all、web、extension 或 api，收到：${options.app}`)
  }

  return options
}

function shouldUseColor(explicit) {
  if (explicit !== undefined) return explicit
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true
  if (process.env.NO_COLOR !== undefined || process.env.FORCE_COLOR === '0') return false
  return Boolean(process.stdout.isTTY)
}

function paint(value, style, colorEnabled = shouldUseColor()) {
  return colorEnabled ? `${ANSI[style]}${value}${ANSI.reset}` : value
}

function issueImpact(issue) {
  return issue.impact || (issue.level === 'error' ? 'startup' : undefined)
}

function validateVariable(variable, values) {
  const label = `${variable.name}${variable.required === false ? '（可选）' : '（必填）'}`
  const value = values[variable.name]
  const impact = variable.impact || 'functionality'
  const feature =
    variable.name.includes('OAUTH') || variable.name.includes('AUTH_') || variable.name.includes('COOKIE')
      ? '登录与会话'
      : variable.name.includes('SHARE')
        ? '分享链接'
        : variable.name.includes('API')
          ? 'API 请求与同步'
          : '页面与扩展访问'
  const failure = message => ({
    level: impact === 'startup' ? 'error' : 'warn',
    impact,
    message: `${message}；影响${feature}`
  })
  if (value === undefined) {
    if (variable.required === false) return { level: 'info', message: `${label} 未配置` }
    return failure(`${label} 未配置`)
  }

  if (value === '') {
    if (variable.required === false) return { level: 'info', message: `${label} 未配置（空值视为未启用）` }
    return failure(`${label} 为空`)
  }

  if (variable.kind === 'url') {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
    } catch {
      return failure(`${label} 不是有效的 http/https 地址`)
    }
  }

  if (variable.kind === 'cookie-name' && value.length < 5) {
    return failure(`${label} 长度不能少于 5 个字符`)
  }

  return { level: 'ok', message: `${label} 已配置` }
}

function checkInstalledDependencies(app, root = REPO_ROOT) {
  const issues = []
  const modulesFile = resolve(root, 'node_modules/.modules.yaml')

  if (!existsSync(modulesFile)) {
    issues.push({
      level: 'error',
      message: '缺少 node_modules/.modules.yaml，请运行 pnpm install --frozen-lockfile'
    })
    return issues
  }

  issues.push({ level: 'ok', message: 'workspace 依赖目录已初始化' })
  for (const dependency of app.workspaceDependencies) {
    const dependencyPath = resolve(root, app.directory, 'node_modules', dependency)
    if (existsSync(dependencyPath)) {
      issues.push({ level: 'ok', message: `${dependency} workspace 链接正常` })
    } else {
      issues.push({
        level: 'error',
        message: `${dependency} workspace 链接缺失，请运行 pnpm install --frozen-lockfile`
      })
    }
  }

  const commandPath = resolve(root, app.directory, 'node_modules/.bin', app.command)
  if (existsSync(commandPath)) {
    issues.push({ level: 'ok', message: `${app.command} 已安装` })
  } else {
    issues.push({
      level: 'error',
      message: `${app.command} 不存在，请运行 pnpm install --frozen-lockfile`
    })
  }

  return issues
}

function runProbe(program, args, root = REPO_ROOT, environment = process.env) {
  try {
    return spawnSync(program, args, {
      cwd: root,
      env: environment,
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    return { error, status: null, stdout: '', stderr: '' }
  }
}

function apiConfigPath(root, environment = process.env) {
  return resolve(root, environment.SLAX_API_CONFIG || 'deploy/local/api.toml')
}

function inspectPowerSyncKey(value) {
  if (!value || !value.trim()) return false
  try {
    const key = JSON.parse(value.replace(/\\/g, ''))
    const required = ['kid', 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi']
    return Boolean(key && typeof key === 'object' && key.kty === 'RSA' && required.every(name => typeof key[name] === 'string' && key[name].trim()))
  } catch {
    return false
  }
}

function parseApiVars(content, root = REPO_ROOT) {
  // Use the API's parser so quoted JSON, comments and multiline values follow setup.
  try {
    const require = createRequire(resolve(root, 'apps/api/package.json'))
    return require('dotenv').parse(content)
  } catch {
    // Keep preflight useful when a partial install left dotenv unavailable.
    const values = {}
    for (const line of String(content).split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) continue
      values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1\s*(?:#.*)?$/, '$2')
    }
    return values
  }
}

function dockerComposeRecords(output) {
  const text = String(output || '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return text.split('\n').flatMap(line => {
      try {
        const parsed = JSON.parse(line)
        return Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        return []
      }
    })
  }
}

function checkDocker(root = REPO_ROOT, environment = process.env, probe = runProbe) {
  const issues = []
  const version = probe('docker', ['--version'], root, environment)
  if (version.error || version.status !== 0) {
    issues.push({
      level: 'warn',
      impact: 'functionality',
      message: '数据库与同步功能不可用：未检测到 Docker。请按照 https://docs.docker.com/get-docker/ 安装 Docker Desktop/Engine，完成后运行 docker --version'
    })
    return issues
  }
  issues.push({ level: 'ok', message: 'Docker 已安装' })

  const compose = probe('docker', ['compose', 'version'], root, environment)
  if (compose.error || compose.status !== 0) {
    issues.push({
      level: 'warn',
      impact: 'functionality',
      message: '本地数据库与同步依赖无法准备：Docker Compose 插件不可用，请按 https://docs.docker.com/compose/install/ 安装 Compose plugin，再运行 docker compose version'
    })
    return issues
  }
  issues.push({ level: 'ok', message: 'Docker Compose 可用' })

  const composeWait = probe('docker', ['compose', 'up', '--help'], root, environment)
  const composeHelp = `${composeWait.stdout || ''}\n${composeWait.stderr || ''}`
  if (composeWait.error || composeWait.status !== 0 || !/\B--wait\b/.test(composeHelp)) {
    issues.push({
      level: 'warn',
      impact: 'functionality',
      message:
        '本地数据库与同步依赖无法准备：Docker Compose 版本不支持 setup 所需的 up --wait，请按 https://docs.docker.com/compose/install/ 更新 Compose plugin，再运行 docker compose up --help 验证'
    })
    return issues
  }
  issues.push({ level: 'ok', message: 'Docker Compose 支持 up --wait' })

  const daemon = probe('docker', ['info'], root, environment)
  if (daemon.error || daemon.status !== 0) {
    issues.push({
      level: 'warn',
      impact: 'functionality',
      message: '数据库与同步功能不可用：Docker daemon 不可用，请启动 Docker Desktop/daemon 并检查权限，再运行 docker info；参考 https://docs.docker.com/config/daemon/start/'
    })
    return issues
  }
  issues.push({ level: 'ok', message: 'Docker daemon 正在运行' })
  return issues
}

function checkLocalApiServices(root = REPO_ROOT, environment = process.env, probe = runProbe) {
  const composeFile = resolve(root, 'deploy/local/dockerfile-local-pgsql.yaml')
  if (!existsSync(composeFile))
    return [
      {
        level: 'warn',
        impact: 'functionality',
        message: '无法检查数据库与同步服务：缺少 deploy/local/dockerfile-local-pgsql.yaml，请恢复仓库中的 Compose 文件后重试'
      }
    ]
  const result = probe('docker', ['compose', '--env-file', devNull, '-f', composeFile, 'ps', '--all', '--format', 'json'], root, environment)
  if (result.error || result.status !== 0)
    return [
      {
        level: 'warn',
        impact: 'functionality',
        message: '数据库与同步服务状态未确认：无法读取 PostgreSQL/PowerSync 容器状态；请运行 pnpm api -- setup 完成本地初始化'
      }
    ]

  const records = dockerComposeRecords(result.stdout)
  const required = ['postgres', 'powersync', 'powersync-api']
  const issues = []
  for (const service of required) {
    const matches = records.filter(item => item?.Service === service || item?.service === service || item?.Name === `dev-${service}`)
    if (!matches.length) {
      issues.push({
        level: 'warn',
        impact: 'functionality',
        message: `数据库与同步功能受影响：${service} 容器尚未创建，请运行 pnpm api -- setup`
      })
      continue
    }
    const record = matches.find(item => String(item.State || item.state).toLowerCase() !== 'running' || String(item.Health || item.health).toLowerCase() !== 'healthy')
    if (record) {
      const state = String(record.State || record.state || '').toLowerCase()
      const health = String(record.Health || record.health || '').toLowerCase()
      const detail = ['unhealthy', 'starting'].includes(health) ? health : ['exited', 'paused', 'restarting', 'created', 'dead'].includes(state) ? state : '尚未确认健康'
      issues.push({
        level: 'warn',
        impact: 'functionality',
        message: `数据库与同步功能受影响：${service} 容器状态为 ${detail}，请运行 pnpm api -- setup`
      })
    } else {
      issues.push({ level: 'ok', message: `${service} 容器健康` })
    }
  }
  return issues
}

function generatedStateExists(root, file) {
  const directPath = resolve(root, file)
  if (existsSync(directPath)) return true

  // pnpm keeps Prisma's default client in the virtual store. The package's
  // generated entry is therefore not necessarily reachable at
  // apps/api/node_modules/.prisma, even though that is the path Prisma's
  // generated wrapper uses from the API workspace.
  if (file === 'apps/api/node_modules/.prisma/client/default.js') {
    try {
      const require = createRequire(resolve(root, 'apps/api/package.json'))
      const packageEntry = require.resolve('@prisma/client')
      return existsSync(resolve(dirname(packageEntry), '../../.prisma/client/default.js'))
    } catch {
      return false
    }
  }

  return false
}

function checkGeneratedState(app, root = REPO_ROOT) {
  return app.generatedState.map(file => {
    if (generatedStateExists(root, file)) return { level: 'ok', message: `${file} 已准备` }
    if (file === 'deploy/local/.generated/web/wrangler.toml')
      return {
        level: 'info',
        message: `${file} 尚未生成，pnpm web -- dev 会自动生成`
      }
    const impact = file === 'deploy/local/.wrangler/state/v3/d1' ? 'functionality' : 'startup'
    return {
      level: impact === 'startup' ? 'error' : 'warn',
      impact,
      message: `缺少 ${file}${impact === 'functionality' ? '，本地 D1 数据访问未就绪' : '，启动所需的生成文件未就绪'}；请运行 ${app.setupCommand}`
    }
  })
}

function checkApi(app, root = REPO_ROOT, processEnvironment = process.env, probe = runProbe) {
  const issues = [...checkInstalledDependencies(app, root)]
  const dependenciesReady = !issues.some(issue => issueImpact(issue))
  const configFile = apiConfigPath(root, processEnvironment)
  const varsFile = resolve(root, 'deploy/local/.dev.vars')

  if (!existsSync(configFile)) {
    issues.push({
      level: 'error',
      message: processEnvironment.SLAX_API_CONFIG
        ? '所选 API 配置缺失，请检查 SLAX_API_CONFIG 指向的文件；config:init 仅创建默认 deploy/local/api.toml'
        : 'API 配置缺失。请运行 pnpm api -- config:init 创建 deploy/local/api.toml，再按模板补充本地配置；配置完成后运行 pnpm api -- setup'
    })
  }
  if (!existsSync(varsFile)) {
    issues.push({
      level: 'warn',
      impact: 'functionality',
      message: '缺少 deploy/local/.dev.vars，认证与同步功能不可用；请参考 deploy/local/.dev.vars.example 填写 Worker 密钥；配置流程见 docs/LOCAL-SETUP.md'
    })
  } else if (dependenciesReady) {
    try {
      const content = readFileSync(varsFile, 'utf8')
      const values = parseApiVars(content, root)
      for (const name of ['JWT_SECRET_TEXT', 'HASH_IDS_SALT', 'EDGE_SHARED_SECRET', 'POWERSYNC_JWK_PRIVATE_KEY']) {
        if (!values[name]?.trim()) {
          issues.push({
            level: 'warn',
            impact: 'functionality',
            message: `deploy/local/.dev.vars 缺少 ${name}，认证或同步功能不可用；请补齐后重试`
          })
        }
      }
      if (values.POWERSYNC_JWK_PRIVATE_KEY && !inspectPowerSyncKey(values.POWERSYNC_JWK_PRIVATE_KEY)) {
        issues.push({
          level: 'warn',
          impact: 'functionality',
          message: 'POWERSYNC_JWK_PRIVATE_KEY 不是可用于 RS256 的有效 RSA 私钥 JWK，同步认证不可用；请修正 .dev.vars'
        })
      }
    } catch {
      issues.push({
        level: 'error',
        message: '无法读取 deploy/local/.dev.vars，请检查文件类型与读取权限；不要提交密钥'
      })
    }
  }

  // Validate startup even when Docker or runtime secrets are unavailable.
  if (dependenciesReady && existsSync(configFile)) {
    const invocation = pnpmInvocation(['--filter', 'slax-reader-backend', 'exec', 'tsx', '--tsconfig', 'tsconfig.json', 'script/deploy/check-readiness.ts'], {
      env: processEnvironment
    })
    const result = probe(invocation.program, invocation.args, root, {
      ...processEnvironment,
      TSX_DISABLE_CACHE: '1'
    })
    let readiness
    try {
      if (!result.error && result.status === 0) readiness = JSON.parse(result.stdout)
    } catch {}
    if (typeof readiness?.startup !== 'boolean' || typeof readiness?.local !== 'boolean') {
      issues.push({
        level: 'error',
        message: '无法完成 API 配置检查，请运行 pnpm install --frozen-lockfile，再运行 pnpm api -- setup --check 排查配置'
      })
    } else if (!readiness.startup) {
      issues.push({
        level: 'error',
        message: 'API 启动配置无效，请检查 SLAX_API_CONFIG / SLAX_API_ENV 所选配置；可运行 pnpm api -- setup --check 排查，配置说明见 docs/LOCAL-SETUP.md'
      })
    } else {
      issues.push({ level: 'ok', message: 'API 启动配置有效' })
      if (!readiness.local)
        issues.push({
          level: 'warn',
          impact: 'functionality',
          message: 'API 本地功能配置未就绪，数据库、认证或同步功能受影响；请运行 pnpm api -- setup --check 检查本地连接、Worker 开发参数与密钥'
        })
      else issues.push({ level: 'ok', message: 'API 本地开发配置与密钥检查通过' })
    }
  }

  const dockerIssues = checkDocker(root, processEnvironment, probe)
  issues.push(...dockerIssues)
  if (!dockerIssues.some(issue => issueImpact(issue))) issues.push(...checkLocalApiServices(root, processEnvironment, probe))
  issues.push(...checkGeneratedState(app, root))
  return issues
}

function checkFrontendPreparation(app, root = REPO_ROOT, environment = process.env, probe = runProbe) {
  const issues = []
  issues.push(...checkGeneratedState(app, root))
  if (app.environmentApp === 'web') {
    const result = probe(process.execPath, [resolve(root, 'apps/web/config/check-bindings.mjs')], root, environment)
    if (result.error || result.status !== 0) {
      issues.push({
        level: 'error',
        message: 'Web 的 API 绑定检查失败，请检查 SLAX_API_CONFIG / SLAX_API_ENV 所选配置的语法、EDGE 服务名和 OSS R2 绑定；未安装依赖时先运行 pnpm install --frozen-lockfile'
      })
    } else {
      issues.push({ level: 'ok', message: 'Web 所选 API 绑定配置有效' })
      if (result.stdout.trim() === 'template')
        issues.push({
          level: 'warn',
          impact: 'functionality',
          message: 'Web API 联调未就绪：当前使用公开模板进行离线准备；真实联调前请运行 pnpm api -- config:init 并配置 API，然后运行 pnpm api -- setup'
        })
    }
    if (!existsSync(resolve(root, 'deploy/local/.wrangler/state/v3')))
      issues.push({
        level: 'warn',
        impact: 'functionality',
        message: 'Web 联调的 API 本地状态尚未准备，请运行 pnpm api -- setup，并单独运行 pnpm api -- dev'
      })
    issues.push({
      level: 'info',
      message: 'Web 登录与同步需要运行中的 API；预检不验证云端资源、OAuth 或业务联调'
    })
  }
  if (app.environmentApp === 'extension') {
    issues.push({
      level: 'info',
      message: 'Extension 的登录、同步和评论联调需要 Web 与 API 服务同时运行'
    })
  }
  return issues
}

function moduleStatus(app, issues) {
  if (issues.some(issue => issueImpact(issue) === 'startup')) return { level: 'error', message: `${app.label} 当前无法启动` }
  if (issues.some(issue => issueImpact(issue) === 'functionality')) return { level: 'warn', message: `${app.label} 可启动，但无法正常运行` }
  return { level: 'ok', message: `${app.label} 启动检查通过` }
}

function compareVersions(actual, expected) {
  const actualParts = actual.split('.').map(Number)
  const expectedParts = expected.split('.').map(Number)
  for (let index = 0; index < expectedParts.length; index += 1) {
    if ((actualParts[index] || 0) !== expectedParts[index]) return (actualParts[index] || 0) > expectedParts[index]
  }
  return true
}

function isSupportedNode(version) {
  const major = Number(version.split('.')[0])
  return (major === 22 && compareVersions(version, '22.22.2')) || (major === 24 && compareVersions(version, '24.15.0')) || major >= 26
}

function checkRuntime(root = REPO_ROOT) {
  const issues = []
  const nodeVersion = process.versions.node
  if (isSupportedNode(nodeVersion)) {
    issues.push({ level: 'ok', message: `Node.js ${nodeVersion}` })
  } else {
    issues.push({
      level: 'error',
      message: `Node.js ${nodeVersion} 不受支持，仓库要求 ^22.22.2 || ^24.15.0 || >=26.0.0；请按 https://nodejs.org/en/download 安装受支持的 LTS 版本`
    })
  }

  const packageManager = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).packageManager || ''
  const expectedPnpm = packageManager.startsWith('pnpm@') ? packageManager.slice('pnpm@'.length) : null
  let result
  try {
    const invocation = pnpmInvocation(['--version'])
    result = runProbe(invocation.program, invocation.args, root)
  } catch (error) {
    result = { error }
  }
  if (result.error || result.status !== 0) {
    issues.push({
      level: 'error',
      message: `找不到 pnpm，请按 https://pnpm.io/installation 安装项目要求的 ${expectedPnpm || 'packageManager 指定'} 版本`
    })
  } else {
    const actualPnpm = result.stdout.trim()
    if (expectedPnpm && actualPnpm !== expectedPnpm) {
      issues.push({
        level: 'error',
        message: `pnpm ${actualPnpm} 与项目要求的 ${expectedPnpm} 不一致，请按 https://pnpm.io/installation 切换版本`
      })
    } else {
      issues.push({ level: 'ok', message: `pnpm ${actualPnpm}` })
    }
  }

  return issues
}

function formatIssue(issue, colorEnabled = shouldUseColor()) {
  const icon = paint(ICONS[issue.level], issue.level, colorEnabled)
  const impact = issueImpact(issue)
  const tag = impact === 'startup' ? '【阻止启动】' : impact === 'functionality' ? '【功能受限】' : ''
  const message = paint(`${tag}${issue.message}`, issue.level, colorEnabled)
  return `${icon} ${message}`
}

function printIssue(issue, indent = '', colorEnabled = shouldUseColor()) {
  console.log(`${indent}${formatIssue(issue, colorEnabled)}`)
}

function printSection(title, detail, colorEnabled) {
  const suffix = detail ? ` ${paint(`· ${detail}`, 'muted', colorEnabled)}` : ''
  console.log(`\n${paint(`▸ ${title}`, 'title', colorEnabled)}${suffix}`)
}

function environmentSetupHint(app, envName) {
  const profileFile = profileFileName(app.environmentApp, envName)
  return `未检测到可用的 ${app.label} 环境变量。请参考 ${app.deployDirectory}/.env.${app.environmentApp}.example，创建并填写 ${app.deployDirectory}/.env.${app.environmentApp}；需要覆盖当前环境的配置时，可使用 ${app.deployDirectory}/${profileFile}。`
}

function printHelp({ color = undefined } = {}) {
  const colorEnabled = shouldUseColor(color)
  console.log(`${paint('用法：pnpm preflight [选项]', 'title', colorEnabled)}

${paint('检查 Node.js、pnpm、workspace 依赖，以及 API/Web/Extension 的配置和本地初始化状态。', 'muted', colorEnabled)}
${paint('只读检查：不会登录、启动容器、迁移数据库、生成密钥或启动 dev server。', 'muted', colorEnabled)}

状态：无法启动 / 可启动但无法正常运行 / 启动检查通过；前两类均返回退出码 1。

选项：
  --app api|web|extension|all
                            只检查一个模块（默认 all）
  --env development|preview|beta|production
                            选择 Web/Extension 的环境（默认按 SLAX_ENV，未设置时为 development）
                            API 使用 SLAX_API_CONFIG / SLAX_API_ENV，与 setup 的选择一致
  --color / --no-color      强制开启 / 关闭终端颜色
  -h, --help                显示帮助`)
}

function run(options, root = REPO_ROOT, processEnvironment = process.env, checks = {}) {
  const issues = []
  const colorEnabled = shouldUseColor(options.color)
  const add = issue => {
    issues.push(issue)
    printIssue(issue, '', colorEnabled)
  }

  console.log(`${paint('Slax Reader preflight', 'title', colorEnabled)}\n${paint('检查本机是否已经准备好运行 API、Web 和 Extension。', 'muted', colorEnabled)}`)
  printSection('运行环境', undefined, colorEnabled)
  const runtimeIssues = checks.runtimeIssues || checkRuntime(root)
  const probe = checks.probe || runProbe
  for (const issue of runtimeIssues) add(issue)

  if (existsSync(resolve(root, '.env'))) {
    const issue = {
      level: 'warn',
      message: '发现根目录 .env；当前 Web/Extension loader 不会自动读取它，请将配置放到 deploy/local/.env.web 或 deploy/local/.env.extension，也可以通过进程环境传入'
    }
    issues.push(issue)
    printIssue(issue, '', colorEnabled)
  }

  const selectedApps = options.app === 'all' ? ['api', 'web', 'extension'].map(name => APP_CHECKS[name]) : [APP_CHECKS[options.app]]
  printSection('模块状态', undefined, colorEnabled)
  const reports = new Map()
  for (const app of selectedApps) {
    const moduleIssues = []
    if (app.environmentApp === 'api') {
      moduleIssues.push(...checkApi(app, root, processEnvironment, probe))
    } else {
      moduleIssues.push(...checkInstalledDependencies(app, root))
      let env
      try {
        env = loadDeployEnvironment({
          appName: app.environmentApp,
          root,
          envName: options.env,
          processEnvironment
        })
      } catch (error) {
        moduleIssues.push({
          level: 'error',
          message: error.message
        })
        env = undefined
      }
      if (env) {
        const loadedFiles = env.files.map(file => app.deployDirectory + '/' + file).join('、')
        moduleIssues.push({
          level: 'info',
          message: `环境：${env.envName} · ${loadedFiles ? '读取：' + loadedFiles : '未找到 deploy 环境文件（也可能来自进程环境）'}`
        })
        const hasConfiguredVariable = app.variables.some(variable => {
          const value = env.values[variable.name]
          return value !== undefined && value !== ''
        })
        if (!hasConfiguredVariable)
          moduleIssues.push({
            level: 'info',
            message: environmentSetupHint(app, env.envName)
          })
        for (const variable of app.variables) {
          const issue = validateVariable(variable, env.values)
          if (issueImpact(issue))
            issue.message += `；请参考 ${app.deployDirectory}/.env.${app.environmentApp}.example 修正 .env.${app.environmentApp} / ${profileFileName(
              app.environmentApp,
              env.envName
            )} 或进程环境`
          moduleIssues.push(issue)
        }
      }
      moduleIssues.push(...checkFrontendPreparation(app, root, env?.environment || processEnvironment, probe))
    }

    for (const peer of app.environmentApp === 'api' ? [] : app.environmentApp === 'web' ? ['api'] : ['api', 'web']) {
      if (reports.get(peer)?.some(issue => issueImpact(issue)))
        moduleIssues.push({
          level: 'warn',
          impact: 'functionality',
          message: `${APP_CHECKS[peer].label} 预检未通过，登录、同步等联调功能受影响；请先修复上方 ${APP_CHECKS[peer].label} 报告中的问题，再启动对应 dev 服务`
        })
    }
    reports.set(app.environmentApp, moduleIssues)
    const status = moduleStatus(app, [...runtimeIssues, ...moduleIssues])
    console.log(`\n  ${paint(status.message, status.level, colorEnabled)} ${paint(`(${app.directory})`, 'muted', colorEnabled)}`)
    for (const issue of moduleIssues) {
      issues.push(issue)
      printIssue(issue, '  ', colorEnabled)
    }
  }

  const blockers = issues.filter(issue => issueImpact(issue) === 'startup').length
  const limited = issues.filter(issue => issueImpact(issue) === 'functionality').length
  const warnings = issues.filter(issue => issue.level === 'warn' && !issueImpact(issue)).length
  const failed = blockers + limited > 0
  const summary = failed
    ? `结果：${blockers} 个启动阻塞问题，${limited} 个功能受限问题${warnings ? `，${warnings} 个提醒` : ''}`
    : warnings
      ? `结果：启动检查通过，${warnings} 个提醒`
      : '结果：所有模块启动检查通过'
  console.log(`\n${paint(summary, blockers ? 'error' : limited || warnings ? 'warn' : 'ok', colorEnabled)}`)
  if (failed) {
    console.log(paint('建议：先修复【阻止启动】，再处理【功能受限】，然后重新运行 pnpm preflight；两类问题均返回退出码 1。', 'muted', colorEnabled))
  }
  console.log(paint('检查通过不代表服务已启动；云端资源、OAuth 凭据和业务联调仍需单独验证。', 'muted', colorEnabled))
  return failed ? 1 : 0
}

export {
  APP_CHECKS,
  checkApi,
  checkDocker,
  checkFrontendPreparation,
  checkGeneratedState,
  checkInstalledDependencies,
  checkLocalApiServices,
  checkRuntime,
  dockerComposeRecords,
  environmentSetupHint,
  formatIssue,
  isSupportedNode,
  moduleStatus,
  parseApiVars,
  parseArgs,
  parseEnvText,
  paint,
  readEnvSources,
  run,
  shouldUseColor,
  validateVariable
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      printHelp(options)
      process.exitCode = 0
    } else {
      process.exitCode = run(options)
    }
  } catch (error) {
    console.error(`preflight 无法运行：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  }
}
