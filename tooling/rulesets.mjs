import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Codified repository ruleset state.
 *
 * `export` rewrites .github/rulesets.expected.json from the live API, `check`
 * reports drift and exits non-zero, and `apply` pushes the codified state with
 * the operator's own gh authentication. Apply refuses to run under CI: ruleset
 * mutation stays a deliberate human operation.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const DEFAULT_EXPECTED_PATH = resolve(ROOT, '.github/rulesets.expected.json')
const MODES = new Set(['export', 'check', 'apply'])
const TARGETS = new Set(['branch', 'tag'])
const ENFORCEMENTS = new Set(['active', 'evaluate', 'disabled'])
const BYPASS_MODES = new Set(['always', 'pull_request', 'exempt'])
const RULESET_KEYS = new Set(['name', 'target', 'enforcement', 'conditions', 'rules', 'bypass_actors'])
const SERVER_FIELDS = new Set(['id', 'node_id', 'source', 'source_type', 'created_at', 'updated_at', '_links', 'current_user_can_bypass'])
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const MAX_RENDERED_VALUE = 400

const usage = `Usage: node tooling/rulesets.mjs <export|check|apply> [--repo <owner/name>] [--file <path>]

  export  Fetch the live rulesets, normalize them, and rewrite the codified JSON
  check   Compare the live rulesets with the codified JSON; exit 1 on drift
  apply   Create or update live rulesets from the codified JSON (local admin only)
`

const compareStrings = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export const stripServerFields = ruleset => {
  if (!isPlainObject(ruleset)) throw new Error('ruleset must be an object')
  return Object.fromEntries(Object.entries(ruleset).filter(([key]) => !SERVER_FIELDS.has(key)))
}

const canonicalArrayKey = item => {
  if (isPlainObject(item)) {
    if (typeof item.type === 'string' && Number.isInteger(item.id)) return `actor:${item.type}:${String(item.id).padStart(12, '0')}`
    if (typeof item.type === 'string') return `type:${item.type}`
    if (typeof item.context === 'string') return `context:${item.context}`
    if (typeof item.actor_type === 'string') return `actor:${item.actor_type}:${String(item.actor_id).padStart(12, '0')}:${item.bypass_mode ?? ''}`
  }
  return `value:${JSON.stringify(item)}`
}

// Ruleset payload arrays are sets: ordering carries no meaning. Sorting them
// (after canonicalizing their items) keeps export output stable and stops
// reordered API responses from reporting false drift.
export const canonicalize = value => {
  if (Array.isArray(value)) {
    const items = value.map(canonicalize)
    if (items.every(item => typeof item === 'string')) return items.sort(compareStrings)
    return items.sort((left, right) => compareStrings(canonicalArrayKey(left), canonicalArrayKey(right)))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort(compareStrings).map(key => [key, canonicalize(value[key])]))
  }
  return value
}

export const normalizeRuleset = ruleset => canonicalize(stripServerFields(ruleset))

export const normalizeRulesets = rulesets => {
  if (!Array.isArray(rulesets)) throw new Error('ruleset state must be an array')
  return rulesets.map(normalizeRuleset).sort((left, right) => compareStrings(left.name, right.name))
}

export const validateRulesets = rulesets => {
  if (!Array.isArray(rulesets)) throw new Error('ruleset state must be an array')
  const names = new Set()
  rulesets.forEach((ruleset, index) => {
    const label = `ruleset[${index}]`
    if (!isPlainObject(ruleset)) throw new Error(`${label} must be an object`)
    for (const key of Object.keys(ruleset)) if (!RULESET_KEYS.has(key)) throw new Error(`${label} has unsupported field ${key}`)
    if (typeof ruleset.name !== 'string' || ruleset.name.trim() === '') throw new Error(`${label} requires a name`)
    if (names.has(ruleset.name)) throw new Error(`duplicate ruleset name ${ruleset.name}`)
    names.add(ruleset.name)
    if (!TARGETS.has(ruleset.target)) throw new Error(`${label} target must be branch or tag`)
    if (!ENFORCEMENTS.has(ruleset.enforcement)) throw new Error(`${label} enforcement must be active, evaluate, or disabled`)
    if (!isPlainObject(ruleset.conditions)) throw new Error(`${label} requires conditions`)
    const refName = ruleset.conditions.ref_name
    if (!isPlainObject(refName) || !Array.isArray(refName.include) || !Array.isArray(refName.exclude)) throw new Error(`${label} requires conditions.ref_name.include and exclude arrays`)
    for (const ref of [...refName.include, ...refName.exclude]) if (typeof ref !== 'string' || ref === '') throw new Error(`${label} ref_name entries must be non-empty strings`)
    if (!Array.isArray(ruleset.rules)) throw new Error(`${label} requires a rules array`)
    ruleset.rules.forEach((rule, ruleIndex) => {
      if (!isPlainObject(rule) || typeof rule.type !== 'string' || rule.type === '') throw new Error(`${label}.rules[${ruleIndex}] requires a type`)
      if (rule.parameters !== undefined && !isPlainObject(rule.parameters)) throw new Error(`${label}.rules[${ruleIndex}].parameters must be an object`)
    })
    if (!Array.isArray(ruleset.bypass_actors)) throw new Error(`${label} requires a bypass_actors array`)
    ruleset.bypass_actors.forEach((actor, actorIndex) => {
      if (!isPlainObject(actor) || !Number.isInteger(actor.actor_id) || typeof actor.actor_type !== 'string' || !BYPASS_MODES.has(actor.bypass_mode)) throw new Error(`${label}.bypass_actors[${actorIndex}] is invalid`)
    })
  })
  return rulesets
}

const arrayIdentity = item => {
  if (typeof item === 'string') return item
  if (isPlainObject(item)) {
    if (typeof item.actor_type === 'string') return `${item.actor_type}:${item.actor_id}`
    if (typeof item.context === 'string') return item.context
    if (typeof item.type === 'string') return item.type
  }
  return JSON.stringify(item)
}

const keyedArray = array => {
  const occurrences = new Map()
  return array.map(item => {
    const identity = arrayIdentity(item)
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    return { key: occurrence === 0 ? identity : `${identity}#${occurrence + 1}`, item }
  })
}

const diffArrays = (expected, actual, path) => {
  const actualByKey = new Map(keyedArray(actual).map(entry => [entry.key, entry.item]))
  const expectedKeys = new Set()
  const changes = []
  for (const entry of keyedArray(expected)) {
    expectedKeys.add(entry.key)
    const childPath = `${path}[${entry.key}]`
    if (!actualByKey.has(entry.key)) changes.push({ path: childPath, kind: 'missing', expected: entry.item })
    else changes.push(...diffValues(entry.item, actualByKey.get(entry.key), childPath))
  }
  for (const entry of keyedArray(actual)) if (!expectedKeys.has(entry.key)) changes.push({ path: `${path}[${entry.key}]`, kind: 'unexpected', actual: entry.item })
  return changes
}

export const diffValues = (expected, actual, path = '') => {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return []
  if (Array.isArray(expected) && Array.isArray(actual)) return diffArrays(expected, actual, path)
  if (isPlainObject(expected) && isPlainObject(actual)) {
    const changes = []
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort(compareStrings)) {
      const childPath = path === '' ? key : `${path}.${key}`
      if (!(key in actual)) changes.push({ path: childPath, kind: 'missing', expected: expected[key] })
      else if (!(key in expected)) changes.push({ path: childPath, kind: 'unexpected', actual: actual[key] })
      else changes.push(...diffValues(expected[key], actual[key], childPath))
    }
    return changes
  }
  return [{ path: path === '' ? '(root)' : path, kind: 'changed', expected, actual }]
}

export const compareRulesets = (expected, actual) => {
  const actualByName = new Map(actual.map(ruleset => [ruleset.name, ruleset]))
  const expectedNames = new Set(expected.map(ruleset => ruleset.name))
  const drift = []
  for (const ruleset of expected) {
    const live = actualByName.get(ruleset.name)
    if (!live) drift.push({ name: ruleset.name, kind: 'missing', changes: [] })
    else {
      const changes = diffValues(ruleset, live)
      if (changes.length > 0) drift.push({ name: ruleset.name, kind: 'changed', changes })
    }
  }
  for (const ruleset of actual) if (!expectedNames.has(ruleset.name)) drift.push({ name: ruleset.name, kind: 'unexpected', changes: [] })
  return drift.sort((left, right) => compareStrings(left.name, right.name))
}

const renderValue = value => {
  const rendered = value === undefined ? 'undefined' : JSON.stringify(value)
  return rendered.length > MAX_RENDERED_VALUE ? `${rendered.slice(0, MAX_RENDERED_VALUE - 3)}...` : rendered
}

export const renderDrift = drift => {
  const lines = [
    '## Ruleset drift detected',
    '',
    'Live repository rulesets differ from `.github/rulesets.expected.json`. Protection state is no longer what the repository codifies.',
    '',
    'To apply an intentional change, run `node tooling/rulesets.mjs apply` locally with an administrator account, then `node tooling/rulesets.mjs check`.',
    ''
  ]
  for (const entry of drift) {
    lines.push(`### \`${entry.name}\``, '')
    if (entry.kind === 'missing') lines.push('- The codified ruleset is missing from the live repository.')
    else if (entry.kind === 'unexpected') lines.push('- The live ruleset is not codified. Add it to `.github/rulesets.expected.json` or remove it from the repository.')
    else {
      for (const change of entry.changes) {
        if (change.kind === 'changed') lines.push(`- \`${change.path}\`: expected ${renderValue(change.expected)}, live ${renderValue(change.actual)}`)
        else if (change.kind === 'missing') lines.push(`- \`${change.path}\`: missing live; expected ${renderValue(change.expected)}`)
        else lines.push(`- \`${change.path}\`: unexpected live value ${renderValue(change.actual)}`)
      }
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export const defaultRunGh = (args, options = {}) => {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', input: options.input, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr : error.stderr?.toString() ?? ''
    throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${stderr.trim() || error.message}`)
  }
}

export const resolveRepository = ({ option, env = process.env, runGh = defaultRunGh } = {}) => {
  const repository = option || env.GITHUB_REPOSITORY || runGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim()
  if (!REPOSITORY_PATTERN.test(repository)) throw new Error(`invalid repository ${JSON.stringify(repository)}; expected owner/name`)
  return repository
}

export const fetchRulesets = ({ repository, runGh = defaultRunGh }) => {
  const pages = JSON.parse(runGh(['api', '--paginate', '--slurp', `repos/${repository}/rulesets`]))
  if (!Array.isArray(pages)) throw new Error('ruleset list response must be an array of pages')
  const summaries = pages.flat()
  return summaries.map(summary => {
    if (!isPlainObject(summary) || !Number.isInteger(summary.id)) throw new Error('ruleset list entry is missing a numeric id')
    const ruleset = JSON.parse(runGh(['api', `repos/${repository}/rulesets/${summary.id}`]))
    if (!isPlainObject(ruleset)) throw new Error(`ruleset ${summary.id} response must be an object`)
    return ruleset
  })
}

export const applyRulesets = ({ expected, live, repository, runGh = defaultRunGh, log = () => {} }) => {
  const liveByName = new Map(live.map(ruleset => [ruleset.name, ruleset]))
  const normalizedLive = new Map(normalizeRulesets(live).map(ruleset => [ruleset.name, ruleset]))
  const actions = []
  for (const ruleset of expected) {
    const existing = liveByName.get(ruleset.name)
    if (existing && JSON.stringify(normalizedLive.get(ruleset.name)) === JSON.stringify(ruleset)) {
      actions.push({ action: 'unchanged', name: ruleset.name })
      log(`unchanged ruleset ${ruleset.name}`)
      continue
    }
    const body = JSON.stringify(ruleset)
    if (existing) {
      runGh(['api', '--method', 'PUT', `repos/${repository}/rulesets/${existing.id}`, '--input', '-'], { input: body })
      actions.push({ action: 'updated', name: ruleset.name })
      log(`updated ruleset ${ruleset.name}`)
    } else {
      runGh(['api', '--method', 'POST', `repos/${repository}/rulesets`, '--input', '-'], { input: body })
      actions.push({ action: 'created', name: ruleset.name })
      log(`created ruleset ${ruleset.name}`)
    }
  }
  for (const ruleset of live) if (!expected.some(codified => codified.name === ruleset.name)) log(`warning: live ruleset ${ruleset.name} is not codified; leaving it unchanged`)
  return actions
}

export const parseArguments = (args, cwd = process.cwd()) => {
  const options = { file: DEFAULT_EXPECTED_PATH, help: false, repository: undefined }
  const [mode, ...rest] = args
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === '--help' || argument === '-h') options.help = true
    else if (argument === '--repo' || argument === '--file') {
      const value = rest[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      index += 1
      if (argument === '--repo') options.repository = value
      else options.file = resolve(cwd, value)
    } else throw new Error(`unknown argument ${argument}`)
  }
  return { mode, ...options }
}

const readExpected = async file => {
  let parsed
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    throw new Error(`could not read ${file}: ${error instanceof Error ? error.message : error}`)
  }
  return validateRulesets(normalizeRulesets(parsed))
}

const main = async () => {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    console.error(usage)
    process.exitCode = 2
    return
  }
  if (options.help) {
    console.log(usage)
    return
  }
  if (!MODES.has(options.mode)) {
    console.error(usage)
    process.exitCode = 2
    return
  }
  try {
    if (options.mode === 'apply' && process.env.CI) throw new Error('apply must run locally with an administrator account; refusing to run under CI')
    const repository = resolveRepository({ option: options.repository })
    if (options.mode === 'export') {
      const live = validateRulesets(normalizeRulesets(fetchRulesets({ repository })))
      await writeFile(options.file, `${JSON.stringify(live, null, 2)}\n`)
      console.log(`wrote ${relative(process.cwd(), options.file)} (${live.length} rulesets)`)
      return
    }
    if (options.mode === 'check') {
      const expected = await readExpected(options.file)
      const live = normalizeRulesets(fetchRulesets({ repository }))
      const drift = compareRulesets(expected, live)
      if (drift.length === 0) {
        console.log(`No ruleset drift: ${expected.length} codified rulesets match ${repository}.`)
        return
      }
      console.log(renderDrift(drift))
      process.exitCode = 1
      return
    }
    const expected = await readExpected(options.file)
    const live = fetchRulesets({ repository })
    const actions = applyRulesets({ expected, live, repository, log: message => console.log(message) })
    const changed = actions.filter(action => action.action !== 'unchanged').length
    console.log(`Applied ruleset state to ${repository}: ${changed} changed, ${actions.length - changed} unchanged.`)
    console.log('Run `node tooling/rulesets.mjs check` to confirm there is no drift.')
  } catch (error) {
    console.error(`rulesets: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 2
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main()
