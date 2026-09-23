import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { relative, resolve } from 'node:path'

const DEPLOY_DIRECTORIES = Object.freeze({
  web: 'deploy/local',
  extension: 'deploy/local'
})

const ENV_NAMES = new Set(['development', 'preview', 'beta', 'production'])

function profileFileName(appName, envName = 'development') {
  if (!ENV_NAMES.has(envName)) {
    throw new Error('SLAX_ENV / --env 只能是 development、preview、beta 或 production')
  }
  const profile = envName === 'development' ? 'dev' : envName
  return `.env.${appName}.${profile}`
}

function environmentFileNames(appName, envName = 'development') {
  return [`.env.${appName}`, profileFileName(appName, envName)]
}

function deployDirectory(appName, root) {
  const relativeDirectory = DEPLOY_DIRECTORIES[appName]
  if (!Object.hasOwn(DEPLOY_DIRECTORIES, appName)) {
    throw new Error(`未知的前端应用：${appName}`)
  }
  return resolve(root, relativeDirectory)
}

function relativeSource(root, filePath) {
  const value = relative(root, filePath)
  return value.startsWith('..') ? filePath : value
}

function parseEnvironmentText(content, appName = '前端应用', sourcePath = '环境文本') {
  // Node's parser tolerates malformed input; validate assignments first so a
  // typo or an unclosed quote cannot silently become configuration.
  const invalid = () => { throw new Error(`${appName} 环境文件语法无效：${sourcePath}`) }
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (content.includes('\0')) invalid()
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line || line.startsWith('#')) continue
    const assignment = line.match(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/)
    if (!assignment) invalid()
    let value = assignment[1]
    const quote = value[0]
    if (!['"', "'", '`'].includes(quote)) continue
    value = value.slice(1)
    while (!value.includes(quote)) {
      if (++index >= lines.length) invalid()
      value += '\n' + lines[index]
    }
    const suffix = value.slice(value.indexOf(quote) + 1).trim()
    if (suffix && !suffix.startsWith('#')) invalid()
  }

  try {
    return parseEnv(content)
  } catch {
    throw new Error(appName + ' 环境文件语法无效：' + sourcePath)
  }
}

function parseEnvironmentFile(filePath, appName) {
  let content
  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    throw new Error(appName + ' 环境文件无法读取：' + filePath)
  }

  return parseEnvironmentText(content, appName, filePath)
}

function readEnvSources(directory, envName, processEnvironment = process.env, { root = directory, appName = '前端应用', fileAppName = 'web' } = {}) {
  let values = {}
  const sources = Object.create(null)
  const files = []

  function loadFile(file) {
    const filePath = resolve(directory, file)
    if (!existsSync(filePath)) return
    const parsed = parseEnvironmentFile(filePath, appName)
    files.push(file)
    values = { ...values, ...parsed }
    for (const name of Object.keys(parsed)) {
      sources[name] = relativeSource(root, filePath)
    }
  }

  loadFile(`.env.${fileAppName}`)
  // Select the profile before reading its file, then keep SLAX_ENV consistent
  // with that selection even if the profile file contains a different value.
  const selectedEnv = envName || processEnvironment.SLAX_ENV || values.SLAX_ENV || 'development'
  loadFile(profileFileName(fileAppName, selectedEnv))
  values = { ...values, ...Object.fromEntries(Object.entries(processEnvironment).filter(([, value]) => value !== undefined)) }
  for (const [name, value] of Object.entries(processEnvironment)) {
    if (value !== undefined) {
      sources[name] = 'process environment'
    }
  }
  values.SLAX_ENV = selectedEnv

  return { values, sources, files, envName: selectedEnv }
}

function loadDeployEnvironment({ appName, root, envName, processEnvironment = process.env }) {
  const directory = deployDirectory(appName, root)
  const result = readEnvSources(directory, envName, processEnvironment, {
    root,
    appName: appName === 'web' ? 'Web' : 'Extension',
    fileAppName: appName
  })

  return {
    ...result,
    directory,
    environment: result.values
  }
}

/**
 * Load the canonical environment for an app invocation into process.env.
 * This is used by direct app commands (for example `pnpm --filter ... dev`)
 * as well as by the root dispatchers. It deliberately reads only the
 * per-app deploy/local/.env.<app>* files, so a stale apps/<name>/.env can
 * never override them.
 */
function applyDeployEnvironment({ appName, root, envName, processEnvironment = process.env } = {}) {
  const result = loadDeployEnvironment({ appName, root, envName, processEnvironment })
  for (const [name, value] of Object.entries(result.environment)) {
    if (value !== undefined) process.env[name] = value
  }
  return result
}

export {
  DEPLOY_DIRECTORIES,
  ENV_NAMES,
  applyDeployEnvironment,
  deployDirectory,
  environmentFileNames,
  loadDeployEnvironment,
  parseEnvironmentFile,
  parseEnvironmentText,
  profileFileName,
  readEnvSources
}
