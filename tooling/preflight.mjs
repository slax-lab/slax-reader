#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_NAMES = new Set(['development', 'preview', 'beta', 'production'])
const ENV_FILE_NAMES = env => ['.env', `.env.${env}`, `.env.${env}.local`]

const APP_CHECKS = {
  web: {
    label: 'Web',
    directory: 'apps/web',
    command: 'nuxt',
    workspaceDependencies: [
      '@commons/contracts',
      '@commons/frontend-types',
      '@commons/frontend-utils',
      '@slax-reader/selection'
    ],
    variables: [
      { name: 'PUBLIC_BASE_URL', kind: 'url', required: true },
      { name: 'AUTH_BASE_URL', kind: 'url', required: true },
      { name: 'SHARE_BASE_URL', kind: 'url', required: true },
      { name: 'DWEB_API_BASE_URL', kind: 'url', required: true },
      { name: 'COOKIE_DOMAIN', kind: 'text', required: true },
      { name: 'COOKIE_TOKEN_NAME', kind: 'cookie-name', required: true },
      { name: 'GOOGLE_OAUTH_CLIENT_ID', kind: 'text', required: true, declarationOnly: true, emptyIsPlaceholder: true },
      { name: 'APPLE_OAUTH_CLIENT_ID', kind: 'text', required: true, declarationOnly: true, emptyIsPlaceholder: true },
      { name: 'TURNSTILE_SITE_KEY', kind: 'text', required: true, declarationOnly: true, emptyIsPlaceholder: true }
    ]
  },
  extension: {
    label: 'Extension',
    directory: 'apps/extension',
    command: 'wxt',
    workspaceDependencies: [
      '@commons/contracts',
      '@commons/frontend-types',
      '@commons/frontend-utils',
      '@slax-reader/selection'
    ],
    variables: [
      { name: 'PUBLIC_BASE_URL', kind: 'url', required: true },
      { name: 'AUTH_BASE_URL', kind: 'url', required: true },
      { name: 'SHARE_BASE_URL', kind: 'url', required: true },
      { name: 'EXTENSIONS_API_BASE_URL', kind: 'url', required: true },
      { name: 'COOKIE_DOMAIN', kind: 'text', required: true },
      { name: 'COOKIE_TOKEN_NAME', kind: 'cookie-name', required: true }
    ]
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
  const options = { app: 'all', env: process.env.SLAX_ENV || 'development', help: false, color: undefined }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--app') {
      options.app = argv[++index]
    } else if (argument === '--env') {
      options.env = argv[++index]
    } else if (argument === '--color') {
      options.color = true
    } else if (argument === '--no-color') {
      options.color = false
    } else {
      throw new Error(`未知参数：${argument}`)
    }
  }

  if (!['all', ...Object.keys(APP_CHECKS)].includes(options.app)) {
    throw new Error(`--app 只能是 all、web 或 extension，收到：${options.app}`)
  }
  if (!ENV_NAMES.has(options.env)) {
    throw new Error(`环境名只能是 development、preview、beta 或 production，收到：${options.env}`)
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

function parseEnvText(text) {
  const values = {}

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue

    const [, name, rawValue] = match
    let value = rawValue.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[name] = value
  }

  return values
}

function readEnvSources(appDirectory, envName, processEnvironment = process.env) {
  const values = {}
  const sources = {}
  const files = ENV_FILE_NAMES(envName)

  for (const file of files) {
    const path = resolve(appDirectory, file)
    if (!existsSync(path)) continue

    const parsed = parseEnvText(readFileSync(path, 'utf8'))
    for (const [name, value] of Object.entries(parsed)) {
      // dotenv is called without override in the app loaders: the first file wins.
      if (!(name in values)) {
        values[name] = value
        sources[name] = relative(REPO_ROOT, path)
      }
    }
  }

  // The process environment wins over every env file, matching dotenv's behavior.
  for (const [name, value] of Object.entries(processEnvironment)) {
    if (value !== undefined) {
      values[name] = value
      sources[name] = 'process environment'
    }
  }

  return { values, sources, files: files.filter(file => existsSync(resolve(appDirectory, file))) }
}

function validateVariable(variable, values) {
  const label = `${variable.name}${variable.declarationOnly ? '（需声明，可留空）' : variable.required === false ? '' : '（必填）'}`
  const value = values[variable.name]
  if (value === undefined) {
    if (variable.required === false) return { level: 'info', message: `${label} 未配置` }
    return { level: 'error', message: `${label} 未配置` }
  }

  if (value === '') {
    if (variable.emptyIsPlaceholder) {
      return { level: 'warn', message: `${label} 为空（允许用于无真实服务的本地构建）` }
    }
    return { level: 'error', message: `${label} 为空` }
  }

  if (variable.kind === 'url') {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
    } catch {
      return { level: 'error', message: `${label} 不是有效的 http/https 地址` }
    }
  }

  if (variable.kind === 'cookie-name' && value.length < 5) {
    return { level: 'error', message: `${label} 长度不能少于 5 个字符` }
  }

  return { level: 'ok', message: `${label} 已配置` }
}

function checkInstalledDependencies(app, root = REPO_ROOT) {
  const issues = []
  const modulesFile = resolve(root, 'node_modules/.modules.yaml')

  if (!existsSync(modulesFile)) {
    issues.push({ level: 'error', message: '未检测到 pnpm install 生成的 node_modules/.modules.yaml，请先运行 pnpm install' })
    return issues
  }

  issues.push({ level: 'ok', message: 'workspace 依赖目录已初始化' })
  for (const dependency of app.workspaceDependencies) {
    const dependencyPath = resolve(root, app.directory, 'node_modules', dependency)
    if (existsSync(dependencyPath)) {
      issues.push({ level: 'ok', message: `${dependency} workspace 链接正常` })
    } else {
      issues.push({ level: 'error', message: `${dependency} workspace 链接缺失` })
    }
  }

  const commandPath = resolve(root, app.directory, 'node_modules/.bin', app.command)
  if (existsSync(commandPath)) {
    issues.push({ level: 'ok', message: `${app.command} 已安装` })
  } else {
    issues.push({ level: 'error', message: `${app.command} 不存在，请重新运行 pnpm install` })
  }

  return issues
}

function compareVersions(actual, expected) {
  const actualParts = actual.split('.').map(Number)
  const expectedParts = expected.split('.').map(Number)
  for (let index = 0; index < expectedParts.length; index += 1) {
    if ((actualParts[index] || 0) !== expectedParts[index]) return (actualParts[index] || 0) > expectedParts[index]
  }
  return true
}

function checkRuntime(root = REPO_ROOT) {
  const issues = []
  const nodeVersion = process.versions.node
  if (compareVersions(nodeVersion, '22.22.2')) {
    issues.push({ level: 'ok', message: `Node.js ${nodeVersion}` })
  } else {
    issues.push({ level: 'error', message: `Node.js ${nodeVersion} 过低，前端要求至少 22.22.2` })
  }

  const packageManager = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).packageManager || ''
  const expectedPnpm = packageManager.startsWith('pnpm@') ? packageManager.slice('pnpm@'.length) : null
  const result = spawnSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    issues.push({ level: 'error', message: '找不到 pnpm，请安装项目要求的 pnpm 版本' })
  } else {
    const actualPnpm = result.stdout.trim()
    if (expectedPnpm && actualPnpm !== expectedPnpm) {
      issues.push({ level: 'error', message: `pnpm ${actualPnpm} 与项目要求的 ${expectedPnpm} 不一致` })
    } else {
      issues.push({ level: 'ok', message: `pnpm ${actualPnpm}` })
    }
  }

  return issues
}

function formatIssue(issue, colorEnabled = shouldUseColor()) {
  const icon = paint(ICONS[issue.level], issue.level, colorEnabled)
  const message = paint(issue.message, issue.level, colorEnabled)
  return `${icon} ${message}`
}

function printIssue(issue, indent = '', colorEnabled = shouldUseColor()) {
  console.log(`${indent}${formatIssue(issue, colorEnabled)}`)
}

function printSection(title, detail, colorEnabled) {
  const suffix = detail ? ` ${paint(`· ${detail}`, 'muted', colorEnabled)}` : ''
  console.log(`\n${paint(`▸ ${title}`, 'title', colorEnabled)}${suffix}`)
}

function printAppHeading(app, colorEnabled) {
  console.log(`\n  ${paint(app.label, 'heading', colorEnabled)} ${paint(`(${app.directory})`, 'muted', colorEnabled)}`)
}

function environmentSetupHint(app, envName) {
  return `未检测到可用的 ${app.label} 环境变量。请创建 ${app.directory}/.env 或 ${app.directory}/.env.${envName}.local，并参考 ${app.directory}/.env.example 中的变量名和占位值。`
}

function printHelp({ color = undefined } = {}) {
  const colorEnabled = shouldUseColor(color)
  console.log(`${paint('用法：pnpm preflight [选项]', 'title', colorEnabled)}

${paint('检查 Node.js、pnpm、workspace 依赖和 Web/Extension 的必要环境变量。', 'muted', colorEnabled)}
${paint('不会输出环境变量值，也不会检查或启动 backend。', 'muted', colorEnabled)}

选项：
  --app web|extension|all   只检查一个前端应用（默认 all）
  --env development|preview|beta|production
                            检查指定环境（默认读取 SLAX_ENV，未设置时为 development）
  --color / --no-color      强制开启 / 关闭终端颜色
  -h, --help                显示帮助`)
}

function run(options, root = REPO_ROOT) {
  const issues = []
  const colorEnabled = shouldUseColor(options.color)
  const add = issue => {
    issues.push(issue)
    printIssue(issue, '', colorEnabled)
  }

  console.log(`${paint('Slax Reader preflight', 'title', colorEnabled)}\n${paint('检查本机是否已经准备好运行前端应用。', 'muted', colorEnabled)}`)
  printSection('运行环境', undefined, colorEnabled)
  for (const issue of checkRuntime(root)) add(issue)

  if (existsSync(resolve(root, '.env'))) {
    const issue = { level: 'warn', message: '发现根目录 .env；当前 Web/Extension loader 不会自动读取它，请将配置放到对应 app 目录或通过进程环境传入' }
    issues.push(issue)
    printIssue(issue, '', colorEnabled)
  }

  printSection('依赖安装', undefined, colorEnabled)
  const selectedApps = options.app === 'all' ? Object.values(APP_CHECKS) : [APP_CHECKS[options.app]]
  for (const app of selectedApps) {
    printAppHeading(app, colorEnabled)
    for (const issue of checkInstalledDependencies(app, root)) {
      issues.push(issue)
      printIssue(issue, '  ', colorEnabled)
    }
  }

  printSection('环境变量', options.env, colorEnabled)
  for (const app of selectedApps) {
    const appDirectory = resolve(root, app.directory)
    const env = readEnvSources(appDirectory, options.env)
    printAppHeading(app, colorEnabled)
    console.log(`  ${paint(env.files.length ? `读取：${env.files.join('、')}` : '未找到 app 环境文件（也可能来自进程环境）', 'muted', colorEnabled)}`)
    const hasConfiguredVariable = app.variables.some(variable => {
      const value = env.values[variable.name]
      return value !== undefined && value !== ''
    })
    if (!hasConfiguredVariable) {
      printIssue({ level: 'info', message: environmentSetupHint(app, options.env) }, '  ', colorEnabled)
    }
    for (const variable of app.variables) {
      const issue = validateVariable(variable, env.values)
      issues.push(issue)
      printIssue(issue, '  ', colorEnabled)
    }
    if (app.label === 'Web') {
      const issue = { level: 'info', message: 'SLAX_BACKEND_DIR（Web 开发联调时必填）仅用于真实 backend 联调；当前 preflight 不将它视为前端配置失败' }
      issues.push(issue)
      printIssue(issue, '  ', colorEnabled)
    }
  }

  const errors = issues.filter(issue => issue.level === 'error').length
  const warnings = issues.filter(issue => issue.level === 'warn').length
  const summary = errors
    ? `结果：${errors} 个阻塞问题${warnings ? `，${warnings} 个提醒` : ''}`
    : warnings
      ? `结果：检查通过，${warnings} 个提醒`
      : '结果：所有前端检查通过'
  const summaryLevel = errors ? 'error' : warnings ? 'warn' : 'ok'
  console.log(`\n${paint(summary, summaryLevel, colorEnabled)}`)
  if (errors) {
    console.log(paint('建议：先处理标记为 ✗ 的项目，再运行 pnpm preflight。', 'muted', colorEnabled))
  } else if (warnings) {
    console.log(paint('提醒不会阻止本地前端命令，但请在真实联调前确认配置。', 'muted', colorEnabled))
  }
  return errors ? 1 : 0
}

export { APP_CHECKS, checkInstalledDependencies, checkRuntime, environmentSetupHint, formatIssue, parseArgs, parseEnvText, paint, readEnvSources, run, shouldUseColor, validateVariable }

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
