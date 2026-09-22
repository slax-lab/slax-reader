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
      { name: 'PUBLIC_BASE_URL', kind: 'url' },
      { name: 'AUTH_BASE_URL', kind: 'url' },
      { name: 'SHARE_BASE_URL', kind: 'url' },
      { name: 'DWEB_API_BASE_URL', kind: 'url' },
      { name: 'COOKIE_DOMAIN', kind: 'text' },
      { name: 'COOKIE_TOKEN_NAME', kind: 'cookie-name' },
      { name: 'GOOGLE_OAUTH_CLIENT_ID', kind: 'text', emptyIsPlaceholder: true },
      { name: 'APPLE_OAUTH_CLIENT_ID', kind: 'text', emptyIsPlaceholder: true },
      { name: 'TURNSTILE_SITE_KEY', kind: 'text', emptyIsPlaceholder: true }
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
      { name: 'PUBLIC_BASE_URL', kind: 'url' },
      { name: 'AUTH_BASE_URL', kind: 'url' },
      { name: 'SHARE_BASE_URL', kind: 'url' },
      { name: 'EXTENSIONS_API_BASE_URL', kind: 'url' },
      { name: 'COOKIE_DOMAIN', kind: 'text' },
      { name: 'COOKIE_TOKEN_NAME', kind: 'cookie-name' }
    ]
  }
}

const ICONS = { ok: '✓', warn: '⚠', error: '✗', info: '•' }

function parseArgs(argv) {
  const options = { app: 'all', env: process.env.SLAX_ENV || 'development', help: false }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--app') {
      options.app = argv[++index]
    } else if (argument === '--env') {
      options.env = argv[++index]
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
  const value = values[variable.name]
  if (value === undefined) return { level: 'error', message: `${variable.name} 未配置` }

  if (value === '') {
    if (variable.emptyIsPlaceholder) {
      return { level: 'warn', message: `${variable.name} 为空（允许用于无真实服务的本地构建）` }
    }
    return { level: 'error', message: `${variable.name} 为空` }
  }

  if (variable.kind === 'url') {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
    } catch {
      return { level: 'error', message: `${variable.name} 不是有效的 http/https 地址` }
    }
  }

  if (variable.kind === 'cookie-name' && value.length < 5) {
    return { level: 'error', message: `${variable.name} 长度不能少于 5 个字符` }
  }

  return { level: 'ok', message: `${variable.name} 已配置` }
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

function printIssue(issue) {
  console.log(`${ICONS[issue.level]} ${issue.message}`)
}

function printHelp() {
  console.log(`用法：pnpm run doctor [选项]

检查 Node.js、pnpm、workspace 依赖和 Web/Extension 的必要环境变量。
不会输出环境变量值，也不会检查或启动 backend。

选项：
  --app web|extension|all   只检查一个前端应用（默认 all）
  --env development|preview|beta|production
                            检查指定环境（默认读取 SLAX_ENV，未设置时为 development）
  -h, --help                显示帮助`)
}

function run(options, root = REPO_ROOT) {
  const issues = []
  const add = issue => {
    issues.push(issue)
    printIssue(issue)
  }

  console.log('Slax Reader doctor\n')
  console.log('运行环境')
  for (const issue of checkRuntime(root)) add(issue)

  if (existsSync(resolve(root, '.env'))) {
    add({ level: 'warn', message: '发现根目录 .env；当前 Web/Extension loader 不会自动读取它，请将配置放到对应 app 目录或通过进程环境传入' })
  }

  console.log('\n依赖安装')
  const selectedApps = options.app === 'all' ? Object.values(APP_CHECKS) : [APP_CHECKS[options.app]]
  for (const app of selectedApps) {
    console.log(`\n${app.label}`)
    for (const issue of checkInstalledDependencies(app, root)) add(issue)
  }

  console.log(`\n环境变量（${options.env}）`)
  for (const app of selectedApps) {
    const appDirectory = resolve(root, app.directory)
    const env = readEnvSources(appDirectory, options.env)
    console.log(`\n${app.label}：${env.files.length ? env.files.join('、') : '未找到 app 环境文件（也可能来自进程环境）'}`)
    for (const variable of app.variables) {
      const issue = validateVariable(variable, env.values)
      add(issue)
    }
    if (app.label === 'Web') {
      add({ level: 'info', message: 'SLAX_BACKEND_DIR 仅用于真实 backend 联调；当前 doctor 不将它视为前端配置失败' })
    }
  }

  const errors = issues.filter(issue => issue.level === 'error').length
  const warnings = issues.filter(issue => issue.level === 'warn').length
  console.log(`\n结果：${errors ? `${errors} 个阻塞问题` : '没有阻塞问题'}${warnings ? `，${warnings} 个提醒` : ''}`)
  if (errors) {
    console.log('请先处理标记为 ✗ 的项目，再运行 pnpm run doctor。')
  }
  return errors ? 1 : 0
}

export { APP_CHECKS, checkInstalledDependencies, checkRuntime, parseArgs, parseEnvText, readEnvSources, run, validateVariable }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      printHelp()
      process.exitCode = 0
    } else {
      process.exitCode = run(options)
    }
  } catch (error) {
    console.error(`doctor 无法运行：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  }
}
