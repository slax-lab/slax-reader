import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function semver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value))
  return match ? match.slice(1).map(Number) : null
}

function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

export function compareMobileVersion(previous, current) {
  const changed = previous.version !== current.version || previous.buildNumber !== current.buildNumber
  if (!changed) return {changed: false, errors: []}
  const errors = []
  const previousVersion = semver(previous.version)
  const currentVersion = semver(current.version)
  if (!previousVersion || !currentVersion) errors.push('mobile package version must be semver')
  else if (compare(currentVersion, previousVersion) < 0) errors.push('mobile package version must not decrease')
  if (!Number.isInteger(previous.buildNumber) || !Number.isInteger(current.buildNumber) || current.buildNumber <= previous.buildNumber)
    errors.push('mobile buildNumber must increase')
  if (!Number.isInteger(current.previousBuildNumber) || current.previousBuildNumber >= current.buildNumber)
    errors.push('previousBuildNumber must be lower than buildNumber')
  return {changed: true, errors}
}

function validateEasConfiguration(errors) {
  try {
    const eas = JSON.parse(readFileSync(join(root, 'apps/mobile/eas.json'), 'utf8'))
    if (eas.cli?.appVersionSource !== 'local')
      errors.push('apps/mobile/eas.json cli.appVersionSource must be "local"')
    if (eas.build?.production?.environment !== 'production')
      errors.push('apps/mobile/eas.json build.production.environment must be "production"')
  } catch {
    errors.push('apps/mobile/eas.json is missing or invalid')
  }

  try {
    const appConfig = readFileSync(join(root, 'apps/mobile/app.config.ts'), 'utf8')
    if (!appConfig.includes('appExtensions') || !appConfig.includes('SlaxShare'))
      errors.push('apps/mobile/app.config.ts must declare the SlaxShare appExtensions target')
    if (!appConfig.includes('android'))
      errors.push('apps/mobile/app.config.ts must include the Android platform')
  } catch {
    errors.push('apps/mobile/app.config.ts is missing')
  }

  const ignorePath = join(root, '.easignore')
  if (!existsSync(ignorePath)) {
    errors.push('.easignore is required to scope the EAS archive')
    return
  }
  const ignored = spawnSync(
    'git',
    ['-c', `core.excludesFile=${ignorePath}`, 'check-ignore', '--no-index', 'apps/mobile/tests', 'apps/mobile/fixtures'],
    {cwd: root, encoding: 'utf8'},
  )
  if (ignored.status === 0 && ignored.stdout.trim())
    errors.push(`.easignore excludes required mobile inputs:\n${ignored.stdout.trim()}`)
}

function output(name, value) {
  const line = `${name}=${value}`
  console.log(line)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`)
}

function main() {
  const before = process.env.BEFORE
  if (!before || /^0+$/.test(before)) {
    console.error('BEFORE must identify the previous dev commit')
    process.exit(1)
  }

  let previous
  try {
    previous = JSON.parse(
      execFileSync('git', ['show', `${before}:apps/mobile/package.json`], {cwd: root, encoding: 'utf8'}),
    )
  } catch {
    console.error(`Cannot read apps/mobile/package.json at ${before}`)
    process.exit(1)
  }

  const current = JSON.parse(readFileSync(join(root, 'apps/mobile/package.json'), 'utf8'))
  const result = compareMobileVersion(previous, current)
  if (!result.changed) {
    output('changed', 'false')
    return
  }

  const errors = [...result.errors]
  validateEasConfiguration(errors)
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exit(1)
  }
  output('changed', 'true')
  output('version', current.version)
  output('build', current.buildNumber)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
