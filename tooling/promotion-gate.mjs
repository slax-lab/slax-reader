import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The `promotion integrity` check (design D2). One composite required context
// for pull requests entering beta and main: it asserts where the head came from
// and that the validation owned by the source stage already succeeded.
//
// Trust model: the workflow runs on `pull_request_target`, from the default
// branch's workflow file and with the base commit checked out, so PR code is
// never executed. The verdict is an explicitly created check run named
// `promotion integrity` on the pull request's head SHA; the workflow job's own
// conclusion is not the gate. Every failure path still reports a failing check
// run, so a broken gate blocks the merge instead of leaving the context missing.
//
// The suite gates and the beta deploy workflows are triggered around the same
// time as this job, so evidence is polled to a bounded deadline instead of read
// once. Polling only defers the verdict: any completed failure fails
// immediately, and every unreadable or unexpected answer fails the gate. A wrong
// failure blocks one promotion until a human looks; it never merges something
// unvalidated.

const api = 'https://api.github.com'
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const shaPattern = /^[a-f0-9]{40}$/
const hotfixPattern = /^hotfix\/\S+$/
const runIdPattern = /^[1-9][0-9]*$/
const logUrlPattern = /\/actions\/runs\/([1-9][0-9]*)\/job\/[1-9][0-9]*$/
const deployFailureStates = ['error', 'failure', 'inactive']
const deployPendingStates = ['queued', 'in_progress', 'pending', 'waiting']
const runFailureConclusions = ['failure', 'cancelled', 'timed_out', 'action_required', 'stale']
const defaultTimeoutMs = 45 * 60_000
const pollIntervalMs = 30_000
const defaultDeployRunGraceMs = 5 * 60_000
const maxSummaryLength = 60_000

export const checkRunName = 'promotion integrity'
export const suiteGates = ['Web CI gate', 'Extension CI gate', 'API CI gate', 'Mobile CI gate', 'CLI CI gate', 'Tooling CI gate']
export const deployWorkflows = ['.github/workflows/api-deploy.yml', '.github/workflows/web-deploy.yml']
export { defaultTimeoutMs, pollIntervalMs, defaultDeployRunGraceMs }

// The workflow-runs endpoint takes a workflow id or the workflow file name;
// the repo-relative path's slashes 404. deployWorkflows stays repo-relative
// because run.path comes back in that form and is matched against it.
const workflowFileName = path => path.split('/').pop()

export class GateError extends Error {}

const fail = message => { throw new GateError(message) }
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const timestamp = value => String(value ?? '')

export function readInputs(env = process.env) {
  const inputs = {
    repository: env.GITHUB_REPOSITORY ?? '',
    number: Number(env.PR_NUMBER),
    base: env.BASE_REF ?? '',
    head: env.HEAD_REF ?? '',
    headSha: env.HEAD_SHA ?? '',
    headRepository: env.HEAD_REPOSITORY ?? '',
    baseRepository: env.BASE_REPOSITORY ?? ''
  }
  if (!repositoryPattern.test(inputs.repository)) fail('Missing or invalid GITHUB_REPOSITORY')
  if (!Number.isSafeInteger(inputs.number) || inputs.number <= 0) fail('Missing or invalid PR_NUMBER')
  if (!['beta', 'main'].includes(inputs.base)) fail('Promotion gate only supports pull requests to beta and main')
  if (typeof inputs.head !== 'string' || !inputs.head) fail('Missing HEAD_REF')
  if (!shaPattern.test(inputs.headSha)) fail('Missing or invalid HEAD_SHA')
  if (!repositoryPattern.test(inputs.headRepository) || !repositoryPattern.test(inputs.baseRepository)) fail('Missing pull request repository identity')
  return inputs
}

export function readTimeout(env = process.env) {
  const value = env.PROMOTION_GATE_TIMEOUT_MS
  if (value === undefined || value === '') return defaultTimeoutMs
  const timeout = Number(value)
  if (!Number.isSafeInteger(timeout) || timeout <= 0) fail('Missing or invalid PROMOTION_GATE_TIMEOUT_MS')
  return timeout
}

// The head must be a branch of this repository: a fork branch that happens to
// be named `dev` did not pass the review and batch gates this allowlist assumes.
export function allowedHead(inputs) {
  if (inputs.headRepository !== inputs.baseRepository) fail(`Head repository ${inputs.headRepository} is not ${inputs.baseRepository}`)
  const hotfix = hotfixPattern.test(inputs.head)
  if (inputs.base === 'beta' && (inputs.head === 'dev' || hotfix)) return hotfix
  if (inputs.base === 'main' && (inputs.head === 'beta' || hotfix)) return hotfix
  fail(`Head branch ${inputs.head} is not an allowed source for ${inputs.base}`)
}

async function github(fetchImpl, token, path) {
  let response
  try {
    response = await fetchImpl(`${api}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'slax-promotion-gate'
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000)
    })
  } catch {
    fail('GitHub API request failed or timed out')
  }
  if (!response.ok) fail(`GitHub API request failed (HTTP ${response.status})`)
  try {
    return await response.json()
  } catch {
    fail('GitHub API returned an invalid response')
  }
}

// Read every page of a list endpoint. A list longer than the page budget is an
// unexpected shape; the gate fails rather than validating an incomplete view.
async function list(fetchImpl, token, path) {
  const items = []
  for (let page = 1; page <= 10; page++) {
    const separator = path.includes('?') ? '&' : '?'
    const body = await github(fetchImpl, token, `${path}${separator}per_page=100&page=${page}`)
    const batch = Array.isArray(body) ? body : body?.check_runs
    if (!Array.isArray(batch)) fail('GitHub API returned an unexpected list response')
    items.push(...batch)
    if (batch.length < 100) return items
  }
  fail('GitHub API list exceeds the pagination limit')
}

// Only the GitHub Actions app may satisfy a suite gate. A same-named check from
// another app is not the workflow contract this gate is written against.
function latestGateRuns(checkRuns) {
  if (!Array.isArray(checkRuns)) fail('GitHub API returned an unexpected check-runs response')
  const latest = new Map()
  for (const run of checkRuns) {
    if (!run || run.app?.slug !== 'github-actions' || typeof run.name !== 'string') continue
    const id = Number(run.id)
    if (!Number.isSafeInteger(id)) fail('Check run has no usable identity')
    const current = latest.get(run.name)
    if (!current || id > current.id) latest.set(run.name, { id, status: run.status, conclusion: run.conclusion })
  }
  return latest
}

// A gate job is designed to report success when its suite did not apply, but a
// skipped conclusion still counts as a pass here: it is the same "suite did not
// run for this diff" semantics. Every other incomplete conclusion is a failure.
export function assessSuiteGates(checkRuns) {
  const latest = latestGateRuns(checkRuns)
  const missing = []
  const pending = []
  const failed = []
  for (const name of suiteGates) {
    const run = latest.get(name)
    if (!run) missing.push(name)
    else if (run.status !== 'completed') pending.push(`${name} (${run.status ?? 'no status'})`)
    else if (!['success', 'skipped'].includes(run.conclusion)) failed.push(`${name} (${run.conclusion ?? 'no conclusion'})`)
  }
  return { missing, pending, failed, ok: missing.length === 0 && pending.length === 0 && failed.length === 0 }
}

function deploymentRunId(logUrl) {
  if (typeof logUrl !== 'string') return undefined
  const match = logUrl.match(logUrlPattern)
  return match ? Number(match[1]) : undefined
}

function newerDeployment(candidate, current) {
  if (!current) return true
  if (candidate.createdAt !== current.createdAt) return candidate.createdAt > current.createdAt
  return candidate.id > current.id
}

// Beta deployment evidence for a promotion to main.
//
// A deploy workflow triggered by `pull_request_target` attaches its conclusion
// to the merged pull request's head SHA, not to the merge commit the merge
// created: merging dev into beta records the deployment against the dev tip
// (verified against the live repository). The promotion head is the beta tip,
// so the evidence is reached through the merged pull request that produced it:
// beta tip -> merged PR -> its head SHA -> beta deployment records on that SHA
// -> the api-deploy and web-deploy runs that created them.
//
// Both deploy workflows are paths-filtered, so a batch that touched none of
// their paths produces no run and no deployment — and must not be blocked by
// evidence that can never exist. Evidence is required only from a workflow that
// registered a run for the source commit; within the grace window a missing run
// might simply not have registered yet, so it stays pending instead of being
// excused.
//
// Returns { ready: false, pending } while a deployment is still running or has
// not been recorded yet, and throws as soon as a deployment or workflow
// concluded unsuccessfully.
export async function inspectDeploymentEvidence(inputs, { token, fetchImpl, graceExpired = true }) {
  const pulls = await list(fetchImpl, token, `/repos/${inputs.repository}/commits/${inputs.headSha}/pulls`)
  const sources = [...new Set(pulls
    .filter(pull => pull && typeof pull.merged_at === 'string' && pull.merge_commit_sha === inputs.headSha && pull.base?.ref === 'beta')
    .map(pull => pull.head?.sha))]
  if (sources.length === 0) fail('No merged pull request into beta produced the promotion head commit')
  if (sources.length > 1 || !shaPattern.test(sources[0] ?? '')) fail('Ambiguous beta provenance for the promotion head commit')

  const sourceSha = sources[0]

  const triggered = new Map()
  for (const path of deployWorkflows) {
    const body = await github(fetchImpl, token, `/repos/${inputs.repository}/actions/workflows/${workflowFileName(path)}/runs?head_sha=${sourceSha}&per_page=100`)
    const workflowRuns = body?.workflow_runs
    if (!Array.isArray(workflowRuns)) fail('GitHub API returned an unexpected workflow-runs response')
    if (workflowRuns.length >= 100) fail('GitHub API workflow-runs list exceeds the page budget')
    triggered.set(path, workflowRuns.length > 0)
  }

  const deployments = await list(fetchImpl, token, `/repos/${inputs.repository}/deployments?sha=${sourceSha}&environment=beta`)
  if (deployments.length === 0) {
    const pending = []
    for (const path of deployWorkflows) {
      if (!triggered.get(path)) {
        if (!graceExpired) pending.push(`${path}: deploy workflow run not registered yet`)
      } else {
        pending.push(`${path}: no beta deployment yet`)
      }
    }
    return { ready: pending.length === 0, pending }
  }

  const evidence = new Map()
  for (const deployment of deployments) {
    const id = Number(deployment?.id)
    if (!Number.isSafeInteger(id) || id <= 0) fail('Beta deployment has no usable identity')
    const statuses = await list(fetchImpl, token, `/repos/${inputs.repository}/deployments/${id}/statuses`)
    const latestStatus = [...statuses].sort((a, b) => timestamp(b?.created_at).localeCompare(timestamp(a?.created_at)))[0]
    if (!latestStatus) fail(`Beta deployment ${id} has no status`)
    const state = latestStatus.state
    if (!['success', ...deployFailureStates, ...deployPendingStates].includes(state)) fail(`Beta deployment ${id} has an unexpected state`)
    const runId = deploymentRunId(latestStatus.log_url)
    if (!runId) fail(`Beta deployment ${id} is not tied to a workflow run`)
    const run = await github(fetchImpl, token, `/repos/${inputs.repository}/actions/runs/${runId}`)
    if (!deployWorkflows.includes(run?.path)) continue
    if (run.head_sha !== sourceSha) fail(`Beta deployment workflow run ${runId} belongs to another commit`)

    let stateClass
    let detail
    if (deployFailureStates.includes(state) || runFailureConclusions.includes(run.conclusion)) {
      stateClass = 'failure'
      detail = `deployment ${state ?? 'unknown'}, workflow ${run.conclusion ?? 'unknown'}`
    } else if (run.status !== 'completed' || deployPendingStates.includes(state)) {
      stateClass = 'pending'
      detail = `deployment ${state ?? 'unknown'}, workflow ${run.status ?? 'unknown'}`
    } else if (state === 'success' && run.conclusion === 'success') {
      stateClass = 'success'
      detail = 'deployment success, workflow success'
    } else {
      fail(`Beta deployment ${id} has an unexpected workflow conclusion`)
    }

    const candidate = { id, createdAt: timestamp(deployment.created_at), state: stateClass, detail }
    if (newerDeployment(candidate, evidence.get(run.path))) evidence.set(run.path, candidate)
  }

  const failed = []
  const pending = []
  for (const path of deployWorkflows) {
    const found = evidence.get(path)
    if (!found) {
      if (!triggered.get(path)) {
        if (!graceExpired) pending.push(`${path}: deploy workflow run not registered yet`)
      } else {
        pending.push(`${path}: no beta deployment yet`)
      }
    }
    else if (found.state === 'failure') failed.push(`${path}: ${found.detail}`)
    else if (found.state === 'pending') pending.push(`${path}: ${found.detail}`)
  }
  if (failed.length) fail(`Beta deployment evidence failed: ${failed.join('; ')}`)
  if (pending.length) return { ready: false, pending }
  return { ready: true, pending: [] }
}

// Shared poll: the suite gates and the beta deployment are independent, so one
// deadline covers both and each poll re-checks whichever is still outstanding.
export async function pollPromotionEvidence(inputs, { token, fetchImpl, wait = delay, intervalMs = pollIntervalMs, timeoutMs = defaultTimeoutMs, deployRunGraceMs = defaultDeployRunGraceMs, requireDeployment = false, log = () => {} }) {
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  let deploymentReady = !requireDeployment
  while (true) {
    const runs = await list(fetchImpl, token, `/repos/${inputs.repository}/commits/${inputs.headSha}/check-runs?filter=all`)
    const suites = assessSuiteGates(runs)
    if (suites.failed.length) fail(`Application CI gates failed on the head commit: ${suites.failed.join(', ')}`)

    let deploymentPending = []
    if (!deploymentReady) {
      const deployment = await inspectDeploymentEvidence(inputs, { token, fetchImpl, graceExpired: Date.now() >= startedAt + deployRunGraceMs })
      deploymentReady = deployment.ready
      deploymentPending = deployment.pending ?? []
    }
    if (suites.ok && deploymentReady) return

    const pending = [...suites.missing, ...suites.pending, ...deploymentPending]
    if (Date.now() >= deadline) fail(`Promotion evidence did not complete before the timeout; still pending: ${pending.join(', ')}`)
    log(`waiting for promotion evidence: ${pending.join(', ')}`)
    await wait(intervalMs)
  }
}

export async function runPromotionGate(inputs, { token, fetchImpl = fetch, wait = delay, intervalMs = pollIntervalMs, timeoutMs = defaultTimeoutMs, deployRunGraceMs = defaultDeployRunGraceMs, log = () => {} } = {}) {
  if (typeof token !== 'string' || !token) fail('Missing GitHub token')
  allowedHead(inputs) // throws on an unsanctioned source; the hotfix flag is no longer needed here
  log(`source allowed: ${inputs.head} -> ${inputs.base}`)

  const requireDeployment = inputs.base === 'main' && inputs.head === 'beta'
  await pollPromotionEvidence(inputs, { token, fetchImpl, wait, intervalMs, timeoutMs, deployRunGraceMs, requireDeployment, log })
  log(`application CI gates: ${suiteGates.length}/${suiteGates.length} succeeded`)
  if (requireDeployment) log('beta deployment evidence: api-deploy and web-deploy succeeded')

  log(`promotion integrity passed for ${inputs.head} -> ${inputs.base}`)
}

function checkRunDetailsUrl(env, repository) {
  const runId = env.GITHUB_RUN_ID
  if (!runIdPattern.test(String(runId ?? '')) || !repositoryPattern.test(repository)) return undefined
  return `https://github.com/${repository}/actions/runs/${runId}`
}

// The required context is this check run, not the workflow job. It is created
// through the Checks API on the pull request's head SHA and verified on the way
// back, so a renamed or mis-targeted run cannot silently satisfy the gate.
export async function createCheckRun({ repository, headSha, token, conclusion, title, summary, detailsUrl }, { fetchImpl = fetch } = {}) {
  if (!repositoryPattern.test(repository)) fail('Cannot report a promotion integrity verdict: invalid repository')
  if (!shaPattern.test(headSha)) fail('Cannot report a promotion integrity verdict: invalid head SHA')
  if (typeof token !== 'string' || !token) fail('Cannot report a promotion integrity verdict: missing token')
  if (!['success', 'failure'].includes(conclusion)) fail('Cannot report a promotion integrity verdict: invalid conclusion')
  if (typeof title !== 'string' || !title || typeof summary !== 'string' || !summary) fail('Cannot report a promotion integrity verdict: missing output')

  const body = {
    name: checkRunName,
    head_sha: headSha,
    status: 'completed',
    conclusion,
    output: { title: title.slice(0, 255), summary: summary.slice(0, maxSummaryLength) }
  }
  if (detailsUrl) body.details_url = detailsUrl

  let response
  try {
    response = await fetchImpl(`${api}/repos/${repository}/check-runs`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'slax-promotion-gate'
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000)
    })
  } catch {
    fail('Could not report the promotion integrity verdict (request failed)')
  }
  if (!response.ok) fail(`Could not report the promotion integrity verdict (HTTP ${response.status})`)
  let created
  try {
    created = await response.json()
  } catch {
    fail('Could not verify the promotion integrity verdict')
  }
  if (created?.name !== checkRunName || created?.head_sha !== headSha || created?.status !== 'completed' || created?.conclusion !== conclusion) fail('Could not verify the promotion integrity verdict')
}

// CLI wrapper: run the gate, then report exactly one check run. A failing
// verdict is reported as a failing check and does not fail the job — the check
// is the merge gate. Only an unreportable verdict fails the job.
export async function runGateAndReport(env = process.env, { fetchImpl = fetch, wait = delay, log = () => {}, errorLog = () => {} } = {}) {
  const target = {
    repository: env.GITHUB_REPOSITORY ?? '',
    headSha: env.HEAD_SHA ?? '',
    token: env.GH_TOKEN ?? '',
    detailsUrl: checkRunDetailsUrl(env, env.GITHUB_REPOSITORY ?? '')
  }
  const source = `${env.HEAD_REF || '(unknown)'} -> ${env.BASE_REF || '(unknown)'}`

  let inputs
  try {
    inputs = readInputs(env)
    await runPromotionGate(inputs, { token: target.token, fetchImpl, wait, timeoutMs: readTimeout(env), log })
  } catch (error) {
    const message = error instanceof GateError ? error.message : 'Promotion gate failed unexpectedly'
    const guidance = 'Fix the failed condition and push a new commit, or re-run this workflow once the missing evidence exists; the check reports again on the current head.'
    errorLog(message)
    try {
      await createCheckRun({
        ...target,
        conclusion: 'failure',
        title: 'Promotion integrity failed',
        summary: `Promotion ${source} failed.\n\n${message}\n\n${guidance}`
      }, { fetchImpl })
      return { reported: true, passed: false, message }
    } catch (reportError) {
      errorLog(reportError.message)
      return { reported: false, passed: false, message }
    }
  }

  const notes = [`Promotion ${inputs.head} -> ${inputs.base} passed on ${inputs.headSha}.`, `All ${suiteGates.length} application CI gates are green.`]
  if (inputs.base === 'main' && inputs.head === 'beta') notes.push('The beta environment deployment evidence is green.')
  try {
    await createCheckRun({
      ...target,
      conclusion: 'success',
      title: 'Promotion integrity passed',
      summary: notes.join(' ')
    }, { fetchImpl })
    return { reported: true, passed: true }
  } catch (error) {
    errorLog(error.message)
    return { reported: false, passed: false, message: error.message }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runGateAndReport(process.env, {
    log: message => console.log(message),
    errorLog: message => console.error(message)
  })
  if (!result.reported) process.exitCode = 1
}
