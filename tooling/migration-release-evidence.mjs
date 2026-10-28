import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Migration release evidence (design: enforce-expand-contract-release-safety).
//
// This module verifies *evidence*, not SQL semantics. It reads a migration
// file's leading comment block, the release diff, and public GitHub records:
// the pull request that introduced a migration and its named-owner review, a
// contract's prerequisite pull request and merge commit, branch and deployment
// ancestry, and the newest successful api-deploy deployment per environment.
// It contains no SQL parser, no statement whitelist, no object-name
// cross-check, no replacement analysis, and executes no DDL. Whether a declared
// class is honest and whether serving code still uses an object remain human
// review duties (REVIEW.md).

const api = 'https://api.github.com'
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const shaPattern = /^[a-f0-9]{40}$/
const runIdPattern = /^[1-9][0-9]*$/
const logUrlPattern = /\/actions\/runs\/([1-9][0-9]*)\/job\/[1-9][0-9]*$/
const pageLimit = 20

export const stageNames = ['declaration', 'ownership', 'prerequisite', 'immutability', 'evidence']
export const apiDeployWorkflow = '.github/workflows/api-deploy.yml'
export const migrateStepName = 'Migrate databases and deploy Workers'

// The dev tip at which enforcement starts. A migration present here is already
// applied on dev, so it is frozen and must not gain or change a declaration;
// anything merged to dev afterwards goes through the check before the dev
// deploy applies it.
export const adoptionCommit = 'f217f465c736a6b80621f78111e80ef6e833f27a'

export class EvidenceError extends Error {
  constructor(stage, reference, message) {
    super(message)
    this.name = 'EvidenceError'
    this.stage = stage
    this.reference = reference
  }
}

const fail = (stage, reference, message) => { throw new EvidenceError(stage, reference, message) }
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0
const nameList = value => value.split(',').map(item => item.trim()).every(item => item.length > 0)
const handleList = value => value.split(',').map(item => item.trim()).every(item => /^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(item))

const fieldShapes = {
  'migration-safety': value => ['expand', 'migrate', 'contract', 'adjudicated'].includes(value),
  preserves: nameList,
  removes: nameList,
  'prerequisite-change': value => value === 'n/a' || /^[a-z0-9][a-z0-9._-]*$/.test(value),
  'prerequisite-pr': value => /^[1-9][0-9]*$/.test(value),
  'prerequisite-merge': value => shaPattern.test(value),
  reason: nonEmpty,
  'adjudicated-class': value => ['contract', 'migrate'].includes(value),
  incident: nonEmpty,
  'adjudicated-at': value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value),
  'approved-by': handleList,
  backup: nonEmpty,
  'ledger-reconciliation': nonEmpty
}
const fieldNames = Object.keys(fieldShapes)
// Safety fields own a reserved namespace. A comment outside it is ordinary SQL
// prose and is ignored; a comment inside it that is not a documented field is a
// declaration error instead of being silently dropped.
const safetyPrefixes = ['migration-safety', 'preserves', 'removes', 'prerequisite-', 'reason', 'adjudicated-', 'incident', 'approved-by', 'backup', 'ledger-']
const isSafetyField = key => fieldNames.includes(key) || safetyPrefixes.some(prefix => prefix.endsWith('-') ? key.startsWith(prefix) : key === prefix)

const classFields = {
  expand: [],
  migrate: ['preserves', 'reason'],
  contract: ['removes', 'prerequisite-change', 'prerequisite-pr', 'prerequisite-merge', 'reason'],
  adjudicated: ['adjudicated-class', 'incident', 'reason', 'adjudicated-at', 'approved-by', 'backup', 'ledger-reconciliation']
}

// Reads only the leading `--` comment block, stopping at the first line of SQL.
export function parseDeclaration(text, path = 'migration') {
  const fields = new Map()
  for (const line of String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const comment = trimmed.match(/^--\s?(.*)$/)
    if (!comment) break
    const field = comment[1].match(/^([a-z][a-z0-9-]*)\s*:\s*(.*)$/)
    if (!field) continue
    const [, key, value] = field
    if (!isSafetyField(key)) continue
    if (!fieldNames.includes(key)) fail('declaration', path, `unknown migration safety field "${key}"`)
    if (fields.has(key)) fail('declaration', path, `duplicate migration safety field "${key}"`)
    fields.set(key, value.trim())
  }

  const declared = fields.get('migration-safety')
  if (!declared) fail('declaration', path, 'missing a leading -- migration-safety declaration')
  if (!fieldShapes['migration-safety'](declared)) fail('declaration', path, `unrecognized migration-safety class "${declared}"`)

  const article = /^[aeiou]/.test(declared) ? 'an' : 'a'
  const allowed = [...classFields[declared]]
  if (declared === 'adjudicated') {
    const base = fields.get('adjudicated-class')
    if (!base) fail('declaration', path, 'an adjudicated declaration requires -- adjudicated-class: contract|migrate')
    if (!fieldShapes['adjudicated-class'](base)) fail('declaration', path, `unrecognized adjudicated-class "${base}"`)
    allowed.push(base === 'contract' ? 'removes' : 'preserves')
    const other = base === 'contract' ? 'preserves' : 'removes'
    if (fields.has(other)) fail('declaration', path, `"-- ${other}" does not apply to an adjudicated ${base}`)
  }

  for (const [key, value] of fields) {
    if (key === 'migration-safety') continue
    if (!allowed.includes(key)) fail('declaration', path, `"-- ${key}" does not apply to ${article} ${declared} declaration`)
    if (!fieldShapes[key](value)) fail('declaration', path, `"-- ${key}" has an invalid value`)
  }
  for (const key of allowed) {
    if (!nonEmpty(fields.get(key) ?? '')) fail('declaration', path, `missing required field "-- ${key}"`)
  }

  const approvedBy = declared === 'adjudicated'
    ? fields.get('approved-by').split(',').map(item => item.trim().replace(/^@/, '').toLowerCase())
    : []
  if (declared === 'adjudicated' && new Set(approvedBy).size !== 2) fail('declaration', path, 'an adjudicated declaration requires exactly two distinct -- approved-by handles')

  return { class: declared, baseClass: declared === 'adjudicated' ? fields.get('adjudicated-class') : declared, fields, approvedBy }
}

const migrationPatterns = [
  /^apps\/api\/prisma\/pg_migrations\/[^/]+\/migration\.sql$/,
  /^apps\/api\/prisma\/logs_migrations\/[^/]+\/migration\.sql$/,
  /^apps\/api\/prisma\/d1_migrations\/[^/]+\.sql$/,
  /^apps\/api\/prisma\/d1_migrations\/fulltext\/[^/]+\.sql$/
]
const lockPattern = /^apps\/api\/prisma\/[^/]+\/migration_lock\.toml$/

export function classifyPath(path) {
  if (typeof path !== 'string') return null
  if (migrationPatterns.some(pattern => pattern.test(path))) return 'migration'
  if (lockPattern.test(path)) return 'lock'
  return null
}

export function parseGitDiff({ cwd = process.cwd(), base, head }) {
  for (const sha of [base, head]) if (!shaPattern.test(String(sha ?? ''))) throw new Error('Expected immutable base and head commit SHAs')
  const output = execFileSync('git', ['diff', '--find-renames', '--name-status', '-z', `${base}..${head}`, '--', 'apps/api/prisma'], {
    cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
  })
  const tokens = output.split('\0').filter(token => token.length > 0)
  const entries = []
  for (let index = 0; index < tokens.length; index++) {
    const code = tokens[index][0]
    if (code === 'R' || code === 'C') {
      const previousPath = tokens[++index]
      entries.push({ path: tokens[++index], status: code === 'R' ? 'renamed' : 'added', previousPath })
    } else {
      const status = { A: 'added', M: 'modified', D: 'removed', T: 'modified' }[code]
      if (!status) throw new Error('Unexpected Git diff status in the release diff')
      entries.push({ path: tokens[++index], status })
    }
  }
  return entries
}

// CODEOWNERS matching follows GitHub's precedence: the last matching line wins.
// Only named users qualify; a team handle cannot be resolved with a workflow
// token, so it is ignored rather than accepted or rejected as a whole.
export function codeownersPattern(pattern) {
  const anchored = pattern.startsWith('/')
  const directory = pattern.endsWith('/')
  const value = pattern.replace(/^\/+/, '').replace(/\/+$/, '')
  let source = ''
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char === '*' && value[index + 1] === '*') {
      index++
      if (value[index + 1] === '/') { index++; source += '(?:.*/)?' } else source += '.*'
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  const prefix = anchored || value.includes('/') ? '^' : '(?:^|.*/)'
  return new RegExp(`${prefix}${source}${directory ? '(?:/.*)?' : ''}$`)
}

export function ownersForPath(text, path) {
  let owners = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [pattern, ...tokens] = line.split(/\s+/)
    if (!pattern || pattern.startsWith('!')) continue
    if (codeownersPattern(pattern).test(path)) owners = tokens
  }
  return owners
    .filter(token => token.startsWith('@') && !token.includes('/'))
    .map(token => token.slice(1).toLowerCase())
}

export function latestReviewStates(reviews) {
  const latest = new Map()
  for (const review of reviews ?? []) {
    const login = String(review?.user?.login ?? '')
    if (!login) continue
    const submitted = String(review?.submitted_at ?? '')
    const id = Number(review?.id ?? 0)
    const key = login.toLowerCase()
    const current = latest.get(key)
    if (!current || submitted > current.submitted || (submitted === current.submitted && id > current.id)) latest.set(key, { login, state: review.state, submitted, id })
  }
  return latest
}

function trailerValue(body) {
  const values = [...String(body ?? '').matchAll(/^OpenSpec:\s*(\S.*?)\s*$/gm)].map(match => match[1])
  return values.length === 1 ? values[0] : undefined
}

// A promotion or sync-back pull request has no single change-id; REVIEW.md
// exempts it from the OpenSpec trailer. A hotfix pull request is not exempt.
export function trailerExempt(pull) {
  const head = String(pull?.headRef ?? '')
  const base = String(pull?.baseRef ?? '')
  if (base === 'beta' && head === 'dev') return true
  if (base === 'main' && head === 'beta') return true
  return base === 'dev' && (head === 'beta' || head === 'main' || head.startsWith('hotfix/'))
}

async function githubRequest({ fetchImpl = fetch, token, path }) {
  let response
  try {
    response = await fetchImpl(`${api}${path}`, {
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
    fail('evidence', 'GitHub API', 'a GitHub API request failed or timed out')
  }
  if (response.status === 404) return { notFound: true }
  if (!response.ok) fail('evidence', 'GitHub API', `a GitHub API request failed (HTTP ${response.status})`)
  try {
    return { body: await response.json() }
  } catch {
    fail('evidence', 'GitHub API', 'a GitHub API request returned an invalid response')
  }
}

function githubList(context, path) {
  return (async () => {
    const items = []
    for (let page = 1; page <= pageLimit; page++) {
      const separator = path.includes('?') ? '&' : '?'
      const { body } = await githubRequest({ ...context, path: `${path}${separator}per_page=100&page=${page}` })
      const batch = Array.isArray(body) ? body : body?.jobs ?? body?.check_runs
      if (!Array.isArray(batch)) fail('evidence', 'GitHub API', 'a GitHub API request returned an unexpected list response')
      items.push(...batch)
      if (batch.length < 100) return items
    }
    fail('evidence', 'GitHub API', 'a GitHub API list exceeds the pagination limit')
  })()
}

export function createGithubEvidence({ repository, token, fetchImpl = fetch }) {
  if (!repositoryPattern.test(String(repository ?? ''))) throw new Error('Missing or invalid GITHUB_REPOSITORY')
  if (typeof token !== 'string' || !token) throw new Error('Missing GitHub token')
  const context = { fetchImpl, token }
  const contentsPath = path => path.split('/').map(encodeURIComponent).join('/')
  const get = path => githubRequest({ ...context, path })
  const list = path => githubList(context, path)

  return {
    async pathExists(ref, path) {
      const { notFound } = await get(`/repos/${repository}/contents/${contentsPath(path)}?ref=${encodeURIComponent(ref)}`)
      return !notFound
    },

    async readMigration(path, ref) {
      const { body, notFound } = await get(`/repos/${repository}/contents/${contentsPath(path)}?ref=${encodeURIComponent(ref)}`)
      if (notFound || body?.type !== 'file' || body.encoding !== 'base64') fail('declaration', path, 'the migration file is not readable')
      return Buffer.from(body.content, 'base64').toString('utf8')
    },

    async ancestry(ancestor, descendant) {
      if (!shaPattern.test(String(ancestor ?? '')) || !shaPattern.test(String(descendant ?? ''))) fail('evidence', 'compare', 'ancestry requires immutable commit SHAs')
      const { body } = await get(`/repos/${repository}/compare/${ancestor}...${descendant}`)
      if (!['ahead', 'behind', 'diverged', 'identical'].includes(body?.status)) fail('evidence', 'compare', 'the compare response has an unexpected status')
      return body.status === 'ahead' || body.status === 'identical'
    },

    async branchTip(name) {
      const { body } = await get(`/repos/${repository}/git/ref/heads/${name}`)
      if (!shaPattern.test(String(body?.object?.sha ?? ''))) fail('evidence', name, `the ${name} branch tip is unreadable`)
      return body.object.sha
    },

    async introducingPullRequest(path, headSha) {
      const commits = await list(`/repos/${repository}/commits?path=${encodeURIComponent(path)}&sha=${headSha}`)
      const oldest = commits[commits.length - 1]?.sha
      if (!shaPattern.test(String(oldest ?? ''))) fail('ownership', path, 'no commit adds the migration on the release head')
      const pulls = await list(`/repos/${repository}/commits/${oldest}/pulls`)
      const merged = pulls.filter(pull => pull && typeof pull.merged_at === 'string')
      if (merged.length !== 1) fail('ownership', path, 'the migration must be introduced by exactly one merged pull request')
      const pull = merged[0]
      if (!Number.isSafeInteger(pull.number) || !shaPattern.test(String(pull.base?.sha ?? ''))) fail('ownership', path, 'the introducing pull request has no usable base commit')
      return { number: pull.number, baseSha: pull.base.sha }
    },

    async codeowners(commitSha) {
      for (const candidate of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
        const { body, notFound } = await get(`/repos/${repository}/contents/${contentsPath(candidate)}?ref=${commitSha}`)
        if (notFound) continue
        if (body?.encoding !== 'base64') fail('ownership', candidate, 'CODEOWNERS is not a readable file')
        return Buffer.from(body.content, 'base64').toString('utf8')
      }
      fail('ownership', '.github/CODEOWNERS', 'CODEOWNERS is missing at the introducing pull request base')
    },

    async reviews(number) {
      const reviews = await list(`/repos/${repository}/pulls/${number}/reviews`)
      return reviews.map(review => ({ user: review?.user, state: review?.state, submitted_at: review?.submitted_at, id: review?.id }))
    },

    async pullRequest(number) {
      if (!Number.isSafeInteger(number) || number <= 0) fail('prerequisite', String(number), 'the prerequisite pull request number is invalid')
      const { body, notFound } = await get(`/repos/${repository}/pulls/${number}`)
      if (notFound) fail('prerequisite', `#${number}`, 'the prerequisite pull request does not exist')
      return {
        number,
        merged: typeof body?.merged_at === 'string',
        mergeCommitSha: body?.merge_commit_sha,
        body: body?.body,
        baseRef: body?.base?.ref,
        headRef: body?.head?.ref
      }
    },

    servingCommit: environment => resolveServingCommit(environment, { repository, get, list })
  }
}

// One serving commit per environment, from pipeline evidence only. A failed,
// cancelled, or in-progress newest api-deploy run freezes instead of falling
// back to an older success, because a partial publish may have left Workers on
// the new code. A superseded run skips the migration step but still creates a
// successful deployment, so the step conclusion is part of the evidence.
export async function resolveServingCommit(environment, { repository, get, list }) {
  if (!['main', 'beta'].includes(environment)) fail('evidence', environment, 'serving evidence exists only for the main and beta environments')
  const deployments = await list(`/repos/${repository}/deployments?environment=${encodeURIComponent(environment)}`)
  const seen = new Set()
  for (const deployment of deployments) {
    const id = Number(deployment?.id)
    const sha = deployment?.sha
    if (!Number.isSafeInteger(id) || id <= 0) fail('evidence', environment, `a ${environment} deployment has no usable identity`)
    if (!shaPattern.test(String(sha ?? ''))) fail('evidence', environment, `a ${environment} deployment has no usable commit`)
    if (seen.has(sha)) continue
    seen.add(sha)

    const statuses = await list(`/repos/${repository}/deployments/${id}/statuses`)
    const latest = [...statuses].sort((a, b) => String(b?.created_at ?? '').localeCompare(String(a?.created_at ?? '')))[0]
    if (!latest) fail('evidence', environment, `the ${environment} deployment ${id} has no status`)
    const runId = String(latest.log_url ?? '').match(logUrlPattern)?.[1]
    if (!runIdPattern.test(String(runId ?? ''))) fail('evidence', environment, `the ${environment} deployment ${id} is not tied to a workflow run`)

    const { body: run } = await get(`/repos/${repository}/actions/runs/${runId}`)
    if (run?.path !== apiDeployWorkflow) continue
    if (run.head_sha !== sha) fail('evidence', environment, `the ${environment} deployment workflow run ${runId} belongs to another commit`)
    if (run.status !== 'completed') fail('evidence', environment, `the newest ${environment} API deployment is still ${run.status}`)
    if (run.conclusion !== 'success') fail('evidence', environment, `the newest ${environment} API deployment is ${run.conclusion}`)

    const jobs = await list(`/repos/${repository}/actions/runs/${runId}/jobs`)
    const step = jobs.flatMap(job => Array.isArray(job?.steps) ? job.steps : []).find(item => item?.name === migrateStepName)
    if (!step) fail('evidence', environment, `the newest ${environment} API deployment has no migration and publication step`)
    if (step.conclusion !== 'success') fail('evidence', environment, `the newest ${environment} API deployment did not run the migration and publication step successfully (${step.conclusion ?? 'no conclusion'})`)
    return { environment, sha }
  }
  fail('evidence', environment, `no successful ${apiDeployWorkflow} deployment exists for ${environment}`)
}

export function createGitEvidence({ cwd = process.cwd(), repository, token, fetchImpl = fetch, adoption = adoptionCommit }) {
  const github = createGithubEvidence({ repository, token, fetchImpl })
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  const hasCommit = ref => {
    try { git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); return true } catch { return false }
  }

  return {
    ...github,

    // The workflow fetches `main`, `beta`, and the target branch before the
    // preflight runs; this module never mutates the repository itself. A commit
    // SHA is accepted so the pre-release target can be read from its own tree.
    async pathExists(ref, path) {
      if (ref === adoption) return github.pathExists(ref, path)
      if (shaPattern.test(String(ref))) {
        if (!hasCommit(ref)) fail('evidence', String(ref).slice(0, 12), 'the pre-release target commit is not available to this checkout')
        try {
          git(['cat-file', '-e', `${ref}:${path}`])
          return true
        } catch {
          return false
        }
      }
      if (!hasCommit(`refs/remotes/origin/${ref}`)) fail('evidence', ref, `the ${ref} branch tree is not fetched for this checkout`)
      try {
        git(['cat-file', '-e', `refs/remotes/origin/${ref}:${path}`])
        return true
      } catch {
        return false
      }
    },

    // The checkout is the release head (or its merge commit), so the committed
    // tree, not the working tree, is the file the release will apply.
    async readMigration(path) {
      try {
        return git(['show', `HEAD:${path}`])
      } catch {
        fail('declaration', path, 'the migration file is not readable at the release head')
      }
    },

    async ancestry(ancestor, descendant) {
      return github.ancestry(ancestor, descendant)
    }
  }
}

async function verifyContract({ evidence, declaration, headSha, path }) {
  const fields = declaration.fields
  const number = Number(fields.get('prerequisite-pr'))
  const merge = fields.get('prerequisite-merge')
  const change = fields.get('prerequisite-change')
  const pull = await evidence.pullRequest(number)
  if (!pull.merged) fail('prerequisite', path, `prerequisite pull request #${number} is not merged`)
  if (pull.mergeCommitSha !== merge) fail('prerequisite', path, `the declared prerequisite-merge is not the merge commit of #${number}`)
  if (!trailerExempt(pull)) {
    const trailer = trailerValue(pull.body)
    if (trailer !== change) fail('prerequisite', path, `prerequisite pull request #${number} does not carry "OpenSpec: ${change}"`)
  }

  const mainTip = await evidence.branchTip('main')
  if (!await evidence.ancestry(merge, mainTip)) fail('prerequisite', path, 'the prerequisite merge commit is not contained in the main tip')
  if (!await evidence.ancestry(merge, headSha)) fail('prerequisite', path, 'the prerequisite merge commit is not contained in the release head')

  for (const environment of ['main', 'beta']) {
    const serving = await evidence.servingCommit(environment)
    if (!await evidence.ancestry(merge, serving.sha)) fail('evidence', path, `the prerequisite merge commit is not contained in the latest successful ${environment} API deployment`)
  }
}

const labelFor = ref => ref === 'main' || ref === 'beta' ? `the ${ref} branch` : 'the pinned dev adoption commit'

// `targetCommit` is the target branch exactly as it stood before this release:
// the merge's first parent for a deploy, the pull request's base commit for
// API CI, and the base branch tip for a promotion. Comparing an added path
// against a live target branch is wrong on both ends: after a merge the target
// already contains the release, and on a promotion the source branch already
// contains every migration it carries. Tests default it to the adoption commit
// so a fixture that does not model a target still exercises the rule.
export async function verifyReleaseEvidence({ evidence, diff, headSha, headRef = '', targetRef = '', targetCommit, environment = targetRef, surface = 'pull-request' }) {
  if (!shaPattern.test(String(headSha ?? ''))) throw new Error('Missing or invalid release head SHA')
  if (!Array.isArray(diff)) throw new Error('Expected a complete release-diff array')
  const findings = []
  const attempt = async (stage, reference, run) => {
    try {
      await run()
      return true
    } catch (error) {
      if (!(error instanceof EvidenceError)) throw error
      findings.push({
        stage: error.stage ?? stage,
        reference: error.reference === 'GitHub API' ? reference : error.reference ?? reference,
        message: error.message
      })
      return false
    }
  }

  const migrations = []
  for (const entry of diff) {
    const current = classifyPath(entry.path)
    const previous = entry.previousPath ? classifyPath(entry.previousPath) : null
    if (!current && !previous) continue
    if (current === 'lock' || previous === 'lock') {
      findings.push({ stage: 'immutability', reference: entry.path, message: `the release diff ${entry.status} migration_lock.toml; the lock file must stay identical on every branch` })
      continue
    }
    migrations.push(entry)
  }

  const released = []
  const frozen = []
  // Re-adding is a real failure only on a shared target: the target already
  // applied that path before this release. Every other shared branch is a
  // source of history — a migration carried from beta to main, or a hotfix
  // migration propagated to dev — so its presence makes the file frozen rather
  // than current, and it needs no fresh declaration.
  const sharedTarget = targetRef === 'beta' || targetRef === 'main'
  const otherShared = ['main', 'beta'].filter(branch => branch !== targetRef)
  for (const entry of migrations) {
    let historical = false
    const ok = await attempt('immutability', entry.path, async () => {
      if (entry.status === 'removed' || entry.status === 'renamed') fail('immutability', entry.path, `the release diff ${entry.status} a migration file`)
      if (entry.status === 'added') {
        if (sharedTarget) {
          const target = targetCommit ?? await evidence.branchTip(targetRef)
          if (await evidence.pathExists(target, entry.path)) fail('immutability', entry.path, `${labelFor(targetRef)} already carried this migration before the release and must not re-add it`)
        }
        historical = await evidence.pathExists(adoptionCommit, entry.path)
        for (const branch of historical ? [] : otherShared) {
          if (await evidence.pathExists(branch, entry.path)) historical = true
        }
      }
      if (entry.status === 'modified') {
        for (const ref of ['main', 'beta', adoptionCommit]) {
          if (await evidence.pathExists(ref, entry.path)) fail('immutability', entry.path, `the migration exists on ${labelFor(ref)} and must not be modified`)
        }
      }
    })
    if (!ok || entry.status !== 'added') continue
    if (historical) frozen.push(entry.path)
    else released.push(entry)
  }

  const hotfix = /^hotfix\//.test(headRef) && ['beta', 'main'].includes(targetRef)
  const declarations = new Map()
  for (const entry of released) {
    await attempt('declaration', entry.path, async () => {
      const declaration = parseDeclaration(await evidence.readMigration(entry.path, headSha), entry.path)
      if (hotfix && declaration.class !== 'expand') fail('declaration', entry.path, `a hotfix may add only expand migrations; ship the ${declaration.class} migration in a normal release`)
      declarations.set(entry.path, declaration)
    })
  }

  const skipEvidence = surface === 'deploy' && environment === 'dev'
  const codeowners = new Map()
  const reviewStates = new Map()
  for (const [path, declaration] of declarations) {
    if (skipEvidence) continue
    await attempt('ownership', path, async () => {
      const introducing = await evidence.introducingPullRequest(path, headSha)
      if (!codeowners.has(introducing.baseSha)) codeowners.set(introducing.baseSha, await evidence.codeowners(introducing.baseSha))
      const owners = ownersForPath(codeowners.get(introducing.baseSha), path)
      if (owners.length === 0) fail('ownership', path, 'no named user owner covers the migration path; team handles cannot satisfy the check')
      if (!reviewStates.has(introducing.number)) reviewStates.set(introducing.number, latestReviewStates(await evidence.reviews(introducing.number)))
      const approved = new Set([...reviewStates.get(introducing.number)].filter(([, review]) => review.state === 'APPROVED').map(([login]) => login))
      if (declaration.class === 'adjudicated') {
        for (const handle of declaration.approvedBy) {
          if (!owners.includes(handle) || !approved.has(handle)) fail('ownership', path, `adjudicated approver @${handle} is not a named owner with an APPROVED review on #${introducing.number}`)
        }
      } else if (!owners.some(owner => approved.has(owner))) {
        fail('ownership', path, `pull request #${introducing.number} has no APPROVED review from a named API owner of the migration path`)
      }
    })
    if (declaration.class === 'contract') {
      await attempt('prerequisite', path, () => verifyContract({ evidence, declaration, headSha, path }))
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    checked: migrations.map(entry => entry.path),
    current: released.map(entry => entry.path),
    frozen,
    skipped: skipEvidence ? ['ownership', 'prerequisite', 'evidence'] : []
  }
}

export function formatFindings(findings) {
  return findings.map(finding => `${finding.stage}: ${finding.reference}: ${finding.message}`).join('\n')
}

// The promotion surface has no checkout of the head, and the compare API caps
// its `files` array at 300 entries with no pagination, so a normal dev -> beta
// batch already exceeds it. Enumerate only the migration families from the two
// versioned trees instead: the compare call supplies the merge base, and the
// recursive tree listing supplies path and blob identity. A truncated tree or an
// unresolvable merge base fails closed.
export async function releaseDiffFromTrees({ repository, token, fetchImpl = fetch, base, head }) {
  if (!repositoryPattern.test(String(repository ?? ''))) throw new Error('Missing or invalid GITHUB_REPOSITORY')
  if (!shaPattern.test(String(head ?? ''))) throw new Error('Missing or invalid release head SHA')
  const compare = await githubRequest({ fetchImpl, token, path: `/repos/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}` })
  const mergeBase = compare.body?.merge_base_commit?.sha
  if (compare.notFound || !shaPattern.test(String(mergeBase ?? ''))) fail('evidence', 'compare', 'the release merge base is unavailable')

  const readTree = async ref => {
    const { body, notFound } = await githubRequest({ fetchImpl, token, path: `/repos/${repository}/git/trees/${ref}?recursive=1` })
    if (notFound || !Array.isArray(body?.tree)) fail('evidence', 'tree', 'a release tree is unreadable')
    if (body.truncated) fail('evidence', 'tree', 'the tree listing is truncated; the release diff cannot be enumerated')
    const files = new Map()
    for (const entry of body.tree) {
      if (entry?.type === 'blob' && classifyPath(entry.path)) files.set(entry.path, entry.sha)
    }
    return files
  }

  const [released, headTree] = await Promise.all([readTree(mergeBase), readTree(head)])
  const entries = []
  const added = []
  const removedByBlob = new Map()
  for (const [path, sha] of released) {
    if (headTree.has(path)) {
      if (headTree.get(path) !== sha) entries.push({ path, status: 'modified' })
    } else {
      if (!removedByBlob.has(sha)) removedByBlob.set(sha, [])
      removedByBlob.get(sha).push(path)
    }
  }
  for (const [path, sha] of headTree) {
    if (released.has(path)) continue
    const matches = removedByBlob.get(sha)
    if (matches?.length) entries.push({ path, status: 'renamed', previousPath: matches.shift() })
    else added.push({ path, status: 'added' })
  }
  for (const paths of removedByBlob.values()) for (const path of paths) entries.push({ path, status: 'removed' })
  return [...entries, ...added]
}

export function parseCliArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    const match = token.match(/^--([a-z-]+)$/)
    if (!match) throw new Error(`Unexpected argument: ${token}`)
    const value = argv[++index]
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${match[1]}`)
    values[match[1]] = value
  }
  const surface = values.surface ?? 'pull-request'
  if (!['pull-request', 'promotion', 'deploy'].includes(surface)) throw new Error('The surface must be pull-request, promotion, or deploy')
  if (!values.head) throw new Error('Missing --head')
  if (!values['base-ref']) throw new Error('Missing --base-ref')
  if (!values.base) throw new Error('Missing --base')
  if (surface === 'promotion' && shaPattern.test(values.head) === false) throw new Error('Missing or invalid --head commit SHA')
  const environment = values.environment ?? values['base-ref']
  if (surface === 'deploy' && !['dev', 'beta', 'main'].includes(environment)) throw new Error('The deploy environment must be dev, beta, or main')
  return {
    surface,
    base: values.base ?? values['base-ref'],
    head: values.head,
    baseRef: values['base-ref'],
    headRef: values['head-ref'] ?? '',
    environment
  }
}

function resolveRev(cwd, rev) {
  const sha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (!shaPattern.test(sha)) throw new Error(`Could not resolve the revision ${rev}`)
  return sha
}

function mergeBase(cwd, base, head) {
  const sha = execFileSync('git', ['merge-base', base, head], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (!shaPattern.test(sha)) throw new Error('Could not establish the release merge base')
  return sha
}

export async function runCli({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), fetchImpl = fetch, log = console.log, errorLog = console.error } = {}) {
  const options = parseCliArgs(argv)
  const repository = env.GITHUB_REPOSITORY ?? ''
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || ''
  if (!repositoryPattern.test(repository)) throw new Error('Missing or invalid GITHUB_REPOSITORY')
  if (!token) throw new Error('Missing GH_TOKEN')

  let diff
  let evidence
  let headSha
  let targetCommit
  if (options.surface === 'promotion') {
    headSha = options.head
    diff = await releaseDiffFromTrees({ repository, token, fetchImpl, base: options.baseRef, head: headSha })
    evidence = createGithubEvidence({ repository, token, fetchImpl })
    // The promotion pull request is unmerged, so the base branch tip is still
    // the pre-release target; the verifier reads it only when a migration needs it.
  } else {
    headSha = resolveRev(cwd, options.head)
    const base = options.surface === 'pull-request' ? mergeBase(cwd, resolveRev(cwd, options.base), headSha) : resolveRev(cwd, options.base)
    targetCommit = resolveRev(cwd, options.base)
    diff = parseGitDiff({ cwd, base, head: headSha })
    evidence = createGitEvidence({ cwd, repository, token, fetchImpl })
  }

  const result = await verifyReleaseEvidence({
    evidence,
    diff,
    headSha,
    headRef: options.headRef,
    targetRef: options.baseRef,
    targetCommit,
    environment: options.environment,
    surface: options.surface
  })
  const summary = `${result.checked.length} migration path(s), ${result.current.length} current`
  if (result.ok) {
    log(`migration release evidence: pass (${summary})`)
    return result
  }
  for (const finding of result.findings) errorLog(`${finding.stage}: ${finding.reference}: ${finding.message}`)
  errorLog(`migration release evidence: fail (${summary}); the release must not proceed`)
  return result
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runCli()
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    const detail = error instanceof EvidenceError ? `${error.stage}: ${error.message}` : error instanceof Error ? error.message : 'the check failed'
    console.error(`migration release evidence: error (${detail})`)
    process.exitCode = 1
  }
}
