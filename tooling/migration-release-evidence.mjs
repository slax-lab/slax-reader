import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Migration release evidence. Two checkpoints only: the dev -> beta promotion
// and the API deploy preflight. The checker reads the leading declaration of an
// added migration, the release diff, and one deployments record per contract.
// It never parses SQL, reads reviews or CODEOWNERS, infers the pull request that
// introduced a file, walks branch history, lists deployments by environment, or
// claims that a commit is serving.

export const stages = ['declaration', 'immutability', 'hotfix', 'prerequisite', 'evidence']
export const apiDeployWorkflow = '.github/workflows/api-deploy.yml'
export const migrationStepName = 'Migrate databases and deploy Workers'
export const sharedEnvironments = ['beta', 'main']
export const migrationFamilies = [
  'apps/api/prisma/pg_migrations/**/migration.sql',
  'apps/api/prisma/logs_migrations/**/migration.sql',
  'apps/api/prisma/d1_migrations/*.sql',
  'apps/api/prisma/d1_migrations/fulltext/*.sql'
]

const migrationPatterns = [
  /^apps\/api\/prisma\/pg_migrations\/[^/]+\/migration\.sql$/,
  /^apps\/api\/prisma\/logs_migrations\/[^/]+\/migration\.sql$/,
  /^apps\/api\/prisma\/d1_migrations\/[^/]+\.sql$/,
  /^apps\/api\/prisma\/d1_migrations\/fulltext\/[^/]+\.sql$/
]
const migrationLockPattern = /^apps\/api\/prisma\/(?:pg_migrations|logs_migrations)\/migration_lock\.toml$/
const classFields = {
  expand: [],
  migrate: ['preserves', 'reason'],
  contract: ['removes', 'prerequisite-change', 'prerequisite-pr', 'prerequisite-merge', 'confirmed-by', 'reason']
}
const safetyFieldNames = new Set(['removes', 'preserves', 'reason', 'prerequisite-change', 'prerequisite-pr', 'prerequisite-merge', 'confirmed-by'])
const signedCommit = /^[a-f0-9]{40}$/u
const humanReviewPath = 'Human-review path: declare the commit recorded by the api-deploy deployment, or use the adjudicated runbook and record the named reviewer confirmation on the pull request.'

export class EvidenceError extends Error {
  constructor(stage, message) {
    super(message)
    this.name = 'EvidenceError'
    this.stage = stage
  }
}

const fail = (stage, message) => { throw new EvidenceError(stage, message) }

export const isMigrationPath = path => migrationPatterns.some(pattern => pattern.test(path))
export const isMigrationLockPath = path => migrationLockPattern.test(path)

function fieldShape(key, value) {
  if (key === 'prerequisite-pr') return /^[1-9][0-9]*$/u.test(value)
  if (key === 'prerequisite-merge') return signedCommit.test(value)
  if (key === 'prerequisite-change') return /^n\/a$/u.test(value) || /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  if (key === 'confirmed-by') return /^@[A-Za-z0-9][A-Za-z0-9-]*$/u.test(value)
  if (key === 'removes' || key === 'preserves') return value.split(',').map(item => item.trim()).filter(Boolean).length > 0
  return value.length > 0
}

// A declaration is the leading comment block. A `key: value` line is a safety
// field; an ordinary comment without that shape is ignored. A key in the safety
// namespace that is not known fails instead of being silently skipped.
export function parseDeclaration(source, path = 'migration.sql') {
  if (typeof source !== 'string') fail('declaration', `${path}: the migration could not be read`)
  const fields = new Map()
  let cls
  for (const raw of source.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '') continue
    if (!line.startsWith('--')) break
    const body = line.slice(2).trim()
    const match = body.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/u)
    if (!match) continue
    const [, key, value] = match
    if (key === 'migration-safety') {
      if (cls !== undefined) fail('declaration', `${path}: more than one migration-safety class line`)
      if (!Object.hasOwn(classFields, value)) fail('declaration', `${path}: unknown migration class "${value}"`)
      cls = value
      continue
    }
    const namespaced = key.startsWith('prerequisite-') || safetyFieldNames.has(key)
    if (!namespaced) continue
    if (!safetyFieldNames.has(key)) fail('declaration', `${path}: unknown safety field "${key}"`)
    if (fields.has(key)) fail('declaration', `${path}: duplicate safety field "${key}"`)
    fields.set(key, value.trim())
  }
  if (cls === undefined) fail('declaration', `${path}: no "migration-safety" class line`)
  const required = classFields[cls]
  for (const key of required) {
    const value = fields.get(key)
    if (value === undefined || value === '') fail('declaration', `${path}: missing safety field "${key}" for a ${cls} migration`)
  }
  for (const [key, value] of fields) {
    if (!required.includes(key)) fail('declaration', `${path}: safety field "${key}" does not belong to a ${cls} migration`)
    if (!fieldShape(key, value)) fail('declaration', `${path}: safety field "${key}" has an invalid shape`)
  }
  return { cls, fields: Object.fromEntries(fields) }
}

export function parseDiff(output) {
  const tokens = String(output).split('\0')
  if (tokens.at(-1) === '') tokens.pop()
  if (tokens.length % 2 !== 0) fail('immutability', 'The release diff could not be read')
  const entries = []
  for (let index = 0; index < tokens.length; index += 2) {
    const [status, path] = [tokens[index], tokens[index + 1]]
    if (!status || !path) fail('immutability', 'The release diff could not be read')
    entries.push({ status: status[0], path })
  }
  return entries
}

// Added migration files need a declaration; everything else is frozen. A rename
// arrives as a deletion plus an addition because the diff is read with
// --no-renames, so it fails as a deletion.
export function assessDiff({ entries, readHeadFile }) {
  const added = []
  for (const { status, path } of entries) {
    if (isMigrationLockPath(path)) fail('immutability', `${path}: migration_lock.toml must not change`)
    if (!isMigrationPath(path)) continue
    if (status === 'D' || status === 'R') fail('immutability', `${path}: release diffs must not delete or rename a migration`)
    if (status !== 'A' && status !== 'C') fail('immutability', `${path}: release diffs must not modify an existing migration`)
    added.push({ path, declaration: parseDeclaration(readHeadFile(path), path) })
  }
  return added
}

const evidenceGuidance = stage => stage === 'evidence' ? ` ${humanReviewPath}` : ''
const evidenceFailure = message => fail('evidence', `${message} ${humanReviewPath}`)

export async function github(fetchImpl, token, path, stage) {
  let response
  try {
    response = await fetchImpl(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'slax-migration-release-evidence'
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000)
    })
  } catch {
    fail(stage, `GitHub API request failed or timed out.${evidenceGuidance(stage)}`)
  }
  if (!response.ok) fail(stage, `GitHub API request failed (HTTP ${response.status}).${evidenceGuidance(stage)}`)
  try {
    return await response.json()
  } catch {
    fail(stage, `GitHub API returned an invalid response.${evidenceGuidance(stage)}`)
  }
}

export function openSpecTrailer(body) {
  if (typeof body !== 'string') return undefined
  return body.match(/^OpenSpec:\s*(\S+)\s*$/mu)?.[1]
}

export function isPromotionOrSyncBack(pull) {
  const base = pull?.base?.ref
  const head = pull?.head?.ref
  return (['beta', 'main'].includes(base) && ['dev', 'beta'].includes(head)) || (base === 'dev' && ['beta', 'main'].includes(head))
}

export async function readPrerequisite({ repository, number, token, fetchImpl }) {
  const pull = await github(fetchImpl, token, `/repos/${repository}/pulls/${number}`, 'prerequisite')
  if (!pull || typeof pull !== 'object' || typeof pull.merged_at !== 'string' || !signedCommit.test(pull.merge_commit_sha ?? '')) {
    fail('prerequisite', `Pull request #${number} is not a merged pull request in this repository`)
  }
  return { mergeCommit: pull.merge_commit_sha, body: pull.body, promotionOrSyncBack: isPromotionOrSyncBack(pull) }
}

export function assessTrailer({ declaration, prerequisite }) {
  if (prerequisite.promotionOrSyncBack) return
  const expected = declaration.fields['prerequisite-change']
  const actual = openSpecTrailer(prerequisite.body)
  const bothNa = expected === 'n/a' && actual === 'n/a'
  if (!bothNa && actual !== expected) {
    fail('prerequisite', `Pull request body must carry "OpenSpec: ${expected}" for the prerequisite change`)
  }
}

// One deployments read for the declared commit. Only beta/main records are
// candidates; the workflow classification happens before any newest selection.
export async function readDeployments({ repository, commit, token, fetchImpl }) {
  const body = await github(fetchImpl, token, `/repos/${repository}/deployments?sha=${commit}&per_page=100`, 'evidence')
  if (!Array.isArray(body)) evidenceFailure('GitHub API returned an unexpected deployments response.')
  if (body.length >= 100) evidenceFailure('GitHub API returned more deployment records than one commit should have.')
  return body.filter(record => record && sharedEnvironments.includes(record.environment) && record.sha === commit)
}

function latestStatus(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) return undefined
  return [...statuses].sort((a, b) => String(b?.created_at ?? '').localeCompare(String(a?.created_at ?? '')) || Number(b?.id ?? 0) - Number(a?.id ?? 0))[0]
}

const deploymentFailureStates = ['failure', 'error', 'inactive', 'cancelled']
const deploymentPendingStates = ['pending', 'queued', 'in_progress', 'waiting']

// Classify a beta/main deployment record by its linked workflow. A web-deploy
// record is not evidence and is ignored before grouping or newest selection, so
// a newer web deployment cannot reject an older valid api-deploy record.
export async function classifyDeploymentRecord({ repository, commit, record, token, fetchImpl }) {
  if (!record || !Number.isSafeInteger(Number(record.id)) || Number(record.id) <= 0) evidenceFailure('A deployment record has no usable identity.')
  const statuses = await github(fetchImpl, token, `/repos/${repository}/deployments/${record.id}/statuses?per_page=100`, 'evidence')
  if (!Array.isArray(statuses) || statuses.length >= 100) evidenceFailure(`Deployment ${record.id} returned an unexpected status response.`)
  const status = latestStatus(statuses)
  if (!status) evidenceFailure(`Deployment ${record.id} has no status.`)
  const runMatch = typeof status.log_url === 'string' ? status.log_url.match(/\/actions\/runs\/([1-9][0-9]*)\//u) : undefined
  if (!runMatch) evidenceFailure(`Deployment ${record.id} is not tied to a workflow run.`)
  const runId = Number(runMatch[1])
  const run = await github(fetchImpl, token, `/repos/${repository}/actions/runs/${runId}`, 'evidence')
  if (!run || run.path !== apiDeployWorkflow) return { api: false }
  const failure = message => ({ api: true, ok: false, error: new EvidenceError('evidence', `${message} ${humanReviewPath}`) })
  if (deploymentFailureStates.includes(status.state) || deploymentPendingStates.includes(status.state)) {
    return failure(`Deployment ${record.id} in ${record.environment} is ${status.state}.`)
  }
  if (status.state !== 'success') return failure(`Deployment ${record.id} has an unexpected state.`)
  if (run.head_sha !== commit) return failure(`Deployment ${record.id} belongs to another commit.`)
  if (run.status !== 'completed' || run.conclusion !== 'success') return failure(`The api-deploy run for ${commit} is ${run.conclusion ?? run.status}.`)
  const jobs = await github(fetchImpl, token, `/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`, 'evidence')
  if (!jobs || !Array.isArray(jobs.jobs) || jobs.jobs.length >= 100) evidenceFailure(`The api-deploy run for ${commit} returned an unexpected jobs response.`)
  const steps = jobs.jobs.flatMap(job => Array.isArray(job?.steps) ? job.steps : []).filter(item => item?.name === migrationStepName)
  if (steps.length !== 1) return failure(`The api-deploy run for ${commit} has ${steps.length} "${migrationStepName}" steps; exactly one is required.`)
  const [step] = steps
  if (step.status !== 'completed' || step.conclusion !== 'success') return failure(`The "${migrationStepName}" step for ${commit} concluded ${step.conclusion ?? step.status ?? 'unknown'}.`)
  return { api: true, ok: true }
}

function newerRecord(a, b) {
  if (!b) return true
  if (String(a.created_at) !== String(b.created_at)) return String(a.created_at) > String(b.created_at)
  return Number(a.id) > Number(b.id)
}

// Records are classified first and grouped by environment afterward. The newest
// api-deploy record per environment decides; a tie at the newest timestamp with
// different outcomes is ambiguous.
export async function assessDeployments({ repository, commit, records, token, fetchImpl }) {
  if (records.length === 0) evidenceFailure(`No api-deploy record for commit ${commit} in beta or main.`)
  const apiRecords = []
  for (const record of records) {
    const classification = await classifyDeploymentRecord({ repository, commit, record, token, fetchImpl })
    if (classification.api) apiRecords.push({ record, ...classification })
  }
  if (apiRecords.length === 0) evidenceFailure(`No api-deploy record for commit ${commit} in beta or main.`)
  const groups = new Map()
  for (const item of apiRecords) {
    const group = groups.get(item.record.environment) ?? []
    group.push(item)
    groups.set(item.record.environment, group)
  }
  const outcomes = []
  for (const [environment, group] of groups) {
    const newest = group.reduce((best, item) => newerRecord(item.record, best.record) ? item : best, group[0])
    const tied = group.filter(item => String(item.record.created_at) === String(newest.record.created_at) && Number(item.record.id) !== Number(newest.record.id))
    const candidates = [newest, ...tied]
    if (new Set(candidates.map(item => item.ok)).size > 1) {
      evidenceFailure(`Deployment evidence for ${environment} is ambiguous: newest records share a timestamp but disagree.`)
    }
    if (!newest.ok) throw newest.error
    outcomes.push(environment)
  }
  return outcomes
}

function gitAt(cwd) {
  return args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function isAncestor(git, ancestor, descendant, stage) {
  try {
    git(['merge-base', '--is-ancestor', ancestor, descendant])
    return true
  } catch (error) {
    if (error.status === 1) return false
    fail(stage, `Could not evaluate whether ${ancestor} is an ancestor of ${descendant}`)
  }
}

export function readReleaseDiff({ base, head, git }) {
  for (const revision of [base, head]) {
    try {
      git(['cat-file', '-e', `${revision}^{commit}`])
    } catch {
      fail('immutability', `Release revision ${revision} is not available in the checkout`)
    }
  }
  let output
  try {
    output = git(['diff', '--name-status', '-z', '--no-renames', `${base}...${head}`, '--'])
  } catch {
    fail('immutability', `Could not read the release diff between ${base} and ${head}`)
  }
  return parseDiff(output)
}

// target: 'dev' | 'beta' | 'main' (the environment the release enters).
// sourceBranch: the pull request head ref, used only for the hotfix rule.
// base and head are local git revisions: the promotion diff or HEAD^1..HEAD.
export async function evaluateRelease({
  target,
  sourceBranch,
  base,
  head,
  repository,
  token,
  fetchImpl = fetch,
  git = gitAt(process.cwd())
}) {
  const entries = readReleaseDiff({ base, head, git })
  const added = assessDiff({
    entries,
    readHeadFile: path => {
      try {
        return git(['show', `${head}:${path}`])
      } catch {
        fail('declaration', `${path}: the added migration could not be read`)
      }
    }
  })
  const hotfix = typeof sourceBranch === 'string' && /^hotfix\//u.test(sourceBranch)
  if (hotfix) {
    const nonAdditive = added.filter(item => item.declaration.cls !== 'expand')
    if (nonAdditive.length > 0) fail('hotfix', `${nonAdditive[0].path}: a hotfix may add only expand migrations`)
  }
  if (target === 'dev') return { migrations: added.length, contracts: 0, environments: [] }
  let contracts = 0
  const environments = new Set()
  for (const { path, declaration } of added) {
    if (declaration.cls !== 'contract') continue
    contracts++
    const number = Number(declaration.fields['prerequisite-pr'])
    const commit = declaration.fields['prerequisite-merge']
    const prerequisite = await readPrerequisite({ repository, number, token, fetchImpl })
    assessTrailer({ declaration, prerequisite })
    if (!isAncestor(git, prerequisite.mergeCommit, commit, 'prerequisite')) {
      fail('prerequisite', `${path}: the prerequisite pull request's merge commit is not an ancestor of ${commit}`)
    }
    if (!isAncestor(git, commit, head, 'prerequisite')) {
      fail('prerequisite', `${path}: ${commit} is not an ancestor of the release head`)
    }
    const records = await readDeployments({ repository, commit, token, fetchImpl })
    const proven = await assessDeployments({ repository, commit, records, token, fetchImpl })
    for (const environment of proven) environments.add(environment)
  }
  return { migrations: added.length, contracts, environments: [...environments] }
}

function formatFailure(error) {
  if (error instanceof EvidenceError) return `migration release evidence: ${error.stage} failed: ${error.message}`
  return 'migration release evidence: unexpected failure'
}

export async function runCli(env = process.env, { fetchImpl = fetch, git, log = message => console.log(message), errorLog = message => console.error(message) } = {}) {
  const mode = env.MRE_MODE ?? (env.PR_HEAD_REF ? 'deploy' : 'promotion')
  try {
    if (typeof env.GH_TOKEN !== 'string' || env.GH_TOKEN === '') throw new EvidenceError('evidence', 'Missing GitHub token')
    if (typeof env.GITHUB_REPOSITORY !== 'string' || env.GITHUB_REPOSITORY === '') throw new EvidenceError('evidence', 'Missing repository identity')
    const target = mode === 'deploy' ? env.TARGET_BRANCH : env.MIGRATION_TARGET
    if (!['dev', 'beta', 'main'].includes(target)) throw new EvidenceError('evidence', 'Missing or invalid target branch')
    const result = mode === 'deploy'
      ? await evaluateRelease({
          target: env.TARGET_BRANCH ?? '',
          sourceBranch: env.PR_HEAD_REF ?? '',
          base: 'HEAD^1',
          head: 'HEAD',
          repository: env.GITHUB_REPOSITORY,
          token: env.GH_TOKEN,
          fetchImpl,
          ...(git ? { git } : {})
        })
      : await evaluateRelease({
          target: env.MIGRATION_TARGET ?? '',
          sourceBranch: env.MIGRATION_SOURCE ?? '',
          base: env.MIGRATION_BASE ?? '',
          head: env.MIGRATION_HEAD ?? '',
          repository: env.GITHUB_REPOSITORY,
          token: env.GH_TOKEN,
          fetchImpl,
          ...(git ? { git } : {})
        })
    log(`migration release evidence: passed (${result.migrations} added migration file(s), ${result.contracts} contract(s))`)
    return result
  } catch (error) {
    errorLog(formatFailure(error))
    return { failed: true, stage: error instanceof EvidenceError ? error.stage : 'unknown' }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'deploy') process.env.MRE_MODE = 'deploy'
  const result = await runCli()
  if (result.failed) process.exitCode = 1
}
