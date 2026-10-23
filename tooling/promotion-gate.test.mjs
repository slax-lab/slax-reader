import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { allowedHead, assessSuiteGates, checkRunName, createCheckRun, defaultTimeoutMs, deployWorkflows, pollIntervalMs, readInputs, readTimeout, reviewApprovers, runGateAndReport, runPromotionGate, suiteGates } from './promotion-gate.mjs'

const require = createRequire(import.meta.url)
const { load } = createRequire(require.resolve('rulesync'))('js-yaml')

const repository = 'slax-lab/slax-reader'
const headSha = 'a'.repeat(40)
const sourceSha = 'b'.repeat(40)
const otherSha = 'c'.repeat(40)

const inputs = (overrides = {}) => ({
  repository, number: 42, base: 'beta', head: 'dev', headSha,
  headRepository: repository, baseRepository: repository, author: 'author', ...overrides
})
const env = (overrides = {}) => ({
  GITHUB_REPOSITORY: repository, GH_TOKEN: 'fixture-token', GITHUB_RUN_ID: '12345',
  PR_NUMBER: '42', BASE_REF: 'beta', HEAD_REF: 'dev', HEAD_SHA: headSha,
  HEAD_REPOSITORY: repository, BASE_REPOSITORY: repository, PR_AUTHOR: 'author', ...overrides
})
const options = (fetchImpl, overrides = {}) => ({ token: 'fixture-token', fetchImpl, wait: async () => {}, ...overrides })
const response = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const httpFailure = status => new Response('fixture-private-error', { status })

function routed(routes) {
  return async (url, request) => {
    assert.equal(request.headers.Authorization, 'Bearer fixture-token')
    for (const [pattern, handler] of routes) if (pattern.test(url)) return handler(url, request)
    throw new Error(`Unexpected GitHub request: ${url}`)
  }
}

const gateRun = (name, id, overrides = {}) => ({ id, name, status: 'completed', conclusion: 'success', app: { slug: 'github-actions' }, ...overrides })
const greenGates = () => suiteGates.map((name, index) => gateRun(name, index + 1))
const checksRoute = runs => [[/\/check-runs\?/, () => response({ total_count: runs.length, check_runs: runs })]]
const mergedPull = (overrides = {}) => ({ merged_at: '2026-10-22T03:18:30Z', merge_commit_sha: headSha, base: { ref: 'beta' }, head: { sha: sourceSha }, ...overrides })
const deployment = (id, createdAt = '2026-10-22T03:18:35Z') => ({ id, created_at: createdAt, environment: 'beta', sha: sourceSha })
const deploymentStatus = (runId, state = 'success', createdAt = '2026-10-22T03:21:00Z') => ({ state, created_at: createdAt, log_url: `https://github.com/${repository}/actions/runs/${runId}/job/7` })
const workflowRun = (path, overrides = {}) => ({ path, head_sha: sourceSha, status: 'completed', conclusion: 'success', ...overrides })
const review = (login, state, submitted = '2026-10-22T05:00:00Z') => ({ id: 1, user: { login }, state, submitted_at: submitted })

function checkRunRoute(posted, status = 201) {
  return [/\/check-runs$/, (url, request) => {
    assert.equal(request.method, 'POST')
    const body = JSON.parse(request.body)
    posted.push(body)
    if (status !== 201) return httpFailure(status)
    return new Response(JSON.stringify({ id: 7, name: body.name, head_sha: body.head_sha, status: body.status, conclusion: body.conclusion }), { status, headers: { 'content-type': 'application/json' } })
  }]
}

function betaDeploymentRoutes({ pulls = [mergedPull()], deployments = [deployment(11), deployment(12)], statuses = {}, runs = {}, registered = deployWorkflows } = {}) {
  const deploymentHandlers = deployments.map(item => [new RegExp(`/deployments/${item.id}/statuses\\?`), typeof statuses[item.id] === 'function' ? statuses[item.id] : () => response(statuses[item.id] ?? [deploymentStatus(1000 + item.id)])])
  const runHandlers = Object.entries(runs).map(([id, run]) => [new RegExp(`/actions/runs/${id}$`), () => response(run)])
  return [
    ...checksRoute(greenGates()),
    [/\/commits\/[a-f0-9]{40}\/pulls\?/, () => response(pulls)],
    [/\/actions\/workflows\//, url => {
      const path = deployWorkflows.find(candidate => url.includes(candidate))
      const wasTriggered = path !== undefined && registered.includes(path)
      return response({ total_count: wasTriggered ? 1 : 0, workflow_runs: wasTriggered ? [workflowRun(path)] : [] })
    }],
    [/\/deployments\?sha=/, () => response(deployments)],
    ...deploymentHandlers,
    ...runHandlers
  ]
}

const defaultDeploymentRuns = () => ({ 1011: workflowRun(deployWorkflows[0]), 1012: workflowRun(deployWorkflows[1]) })

test('inputs require a complete beta/main pull request identity', () => {
  const values = {
    GITHUB_REPOSITORY: repository, PR_NUMBER: '42', BASE_REF: 'beta', HEAD_REF: 'dev', HEAD_SHA: headSha,
    HEAD_REPOSITORY: repository, BASE_REPOSITORY: repository, PR_AUTHOR: 'author'
  }
  assert.deepEqual(readInputs(values), inputs())
  for (const [key, value] of [
    ['GITHUB_REPOSITORY', 'not-a-repository'], ['PR_NUMBER', '0'], ['PR_NUMBER', '1.5'], ['BASE_REF', 'dev'],
    ['HEAD_REF', ''], ['HEAD_SHA', 'A'.repeat(40)], ['HEAD_REPOSITORY', ''], ['BASE_REPOSITORY', ''], ['PR_AUTHOR', '']
  ]) {
    assert.throws(() => readInputs({ ...values, [key]: value }), /Missing|Invalid|only supports/, key)
  }
})

test('the evidence timeout is configurable and validated', () => {
  assert.equal(readTimeout({}), defaultTimeoutMs)
  assert.equal(defaultTimeoutMs, 45 * 60_000)
  assert.equal(pollIntervalMs, 30_000)
  assert.equal(readTimeout({ PROMOTION_GATE_TIMEOUT_MS: '60000' }), 60_000)
  for (const value of ['0', '-1', '1.5', 'abc']) assert.throws(() => readTimeout({ PROMOTION_GATE_TIMEOUT_MS: value }), /PROMOTION_GATE_TIMEOUT_MS/, value)
})

test('only the sanctioned upstream or a hotfix branch of this repository is an allowed source', () => {
  assert.equal(allowedHead(inputs({ base: 'beta', head: 'dev' })), false)
  assert.equal(allowedHead(inputs({ base: 'beta', head: 'hotfix/urgent' })), true)
  assert.equal(allowedHead(inputs({ base: 'main', head: 'beta' })), false)
  assert.equal(allowedHead(inputs({ base: 'main', head: 'hotfix/urgent' })), true)
  for (const base of ['beta', 'main']) {
    for (const head of ['dev', 'beta', 'main', 'feature/topic', 'hotfix', 'hotfix/', 'hotfix//urgent']) {
      if ((base === 'beta' && head === 'dev') || (base === 'main' && head === 'beta') || head.startsWith('hotfix/')) continue
      assert.throws(() => allowedHead(inputs({ base, head })), /not an allowed source/, `${head} -> ${base}`)
    }
  }
  assert.throws(() => allowedHead(inputs({ base: 'main', head: 'hotfix/urgent', headRepository: 'fork/reader' })), /Head repository/)
  assert.throws(() => allowedHead(inputs({ base: 'beta', head: 'dev', headRepository: 'fork/reader' })), /Head repository/)
})

test('unsanctioned sources and forks fail before any API call', async () => {
  const never = async () => assert.fail('must not call the API')
  await assert.rejects(runPromotionGate(inputs({ head: 'main' }), options(never)), /not an allowed source/)
  await assert.rejects(runPromotionGate(inputs({ head: 'dev', headRepository: 'fork/reader' }), options(never)), /Head repository/)
  await assert.rejects(runPromotionGate(inputs({}), { token: '', fetchImpl: never }), /Missing GitHub token/)
})

test('suite gate assessment reads the latest Actions run per required name', () => {
  assert.deepEqual(assessSuiteGates(greenGates()), { missing: [], pending: [], failed: [], ok: true })
  assert.deepEqual(assessSuiteGates(greenGates().slice(1)), { missing: ['Web CI gate'], pending: [], failed: [], ok: false })
  assert.deepEqual(assessSuiteGates(greenGates().map((run, index) => index === 2 ? { ...run, status: 'in_progress' } : run)), { missing: [], pending: ['API CI gate (in_progress)'], failed: [], ok: false })
  assert.deepEqual(assessSuiteGates(greenGates().map((run, index) => index === 3 ? { ...run, conclusion: 'skipped' } : run)), { missing: [], pending: [], failed: [], ok: true })
  assert.deepEqual(assessSuiteGates(greenGates().map((run, index) => index === 3 ? { ...run, conclusion: 'neutral' } : run)), { missing: [], pending: [], failed: ['Mobile CI gate (neutral)'], ok: false })
  assert.equal(assessSuiteGates([...greenGates(), gateRun('Web CI gate', 99, { conclusion: 'failure' })]).ok, false, 'a newer failure supersedes an older success')
  assert.equal(assessSuiteGates([...greenGates(), gateRun('Web CI gate', 99, { status: 'queued', conclusion: null })]).ok, false, 'a newer queued run supersedes an older success')
  assert.equal(assessSuiteGates([gateRun('Web CI gate', 0, { conclusion: 'failure' }), ...greenGates()]).ok, true, 'an older failure is superseded by a newer success')
  assert.equal(assessSuiteGates([...greenGates(), gateRun('Web CI gate', 99, { conclusion: 'failure', app: { slug: 'other-app' } })]).ok, true, 'another app cannot satisfy or block a suite gate')
})

test('a dev-to-beta promotion passes with six green gates and polls pending ones', async () => {
  let polls = 0
  const fetchImpl = routed([
    [/\/check-runs\?/, () => response({ check_runs: polls++ === 0 ? greenGates().map((run, index) => index === 0 ? { ...run, status: 'in_progress' } : run) : greenGates() })]
  ])
  let waits = 0
  await runPromotionGate(inputs({}), options(fetchImpl, { wait: async milliseconds => { waits++; assert.equal(milliseconds, pollIntervalMs) } }))
  assert.equal(polls, 2)
  assert.equal(waits, 1)
})

test('a failed suite gate fails immediately while a pending one times out with its name', async () => {
  let waits = 0
  const failed = routed(checksRoute(greenGates().map((run, index) => index === 5 ? { ...run, conclusion: 'failure' } : run)))
  await assert.rejects(runPromotionGate(inputs({}), options(failed, { wait: async () => { waits++ } })), /Tooling CI gate \(failure\)/)
  assert.equal(waits, 0)
  const pending = routed(checksRoute(greenGates().map((run, index) => index === 0 ? { ...run, status: 'queued' } : run)))
  await assert.rejects(runPromotionGate(inputs({}), options(pending, { wait: async () => { waits++ }, timeoutMs: 0 })), /did not complete before the timeout.*Web CI gate/)
  assert.equal(waits, 0)
})

test('check runs paginate and only the first page cannot satisfy the gate', async () => {
  const pages = [
    [/\/check-runs\?filter=all&per_page=100&page=1$/, () => response({ check_runs: Array.from({ length: 100 }, (_, index) => gateRun(`filler ${index}`, index + 1)) })],
    [/\/check-runs\?filter=all&per_page=100&page=2$/, () => response({ check_runs: greenGates() })]
  ]
  await runPromotionGate(inputs({}), options(routed(pages)))
})

test('a beta-to-main promotion requires both deploy workflows to succeed on the beta deployment', async () => {
  await runPromotionGate(inputs({ base: 'main', head: 'beta' }), options(routed(betaDeploymentRoutes({ runs: defaultDeploymentRuns() }))))
})

test('beta deployment evidence is polled while the deploy workflows are still running', async () => {
  const calls = new Map()
  const pendingThenSuccess = id => () => {
    const count = calls.get(id) ?? 0
    calls.set(id, count + 1)
    return response([deploymentStatus(1000 + id, count === 0 ? 'in_progress' : 'success')])
  }
  let waits = 0
  const routes = betaDeploymentRoutes({ statuses: { 11: pendingThenSuccess(11), 12: pendingThenSuccess(12) }, runs: defaultDeploymentRuns() })
  await runPromotionGate(inputs({ base: 'main', head: 'beta' }), options(routed(routes), { wait: async () => { waits++ } }))
  assert.equal(waits, 1)
  assert.equal(calls.get(11), 2)
  assert.equal(calls.get(12), 2)
})

test('beta deployment evidence times out and names every workflow that never deployed', async () => {
  let waits = 0
  const routes = betaDeploymentRoutes({ deployments: [] })
  await assert.rejects(
    runPromotionGate(inputs({ base: 'main', head: 'beta' }), options(routed(routes), { timeoutMs: 0, wait: async () => { waits++ } })),
    /did not complete before the timeout.*api-deploy\.yml: no beta deployment yet.*web-deploy\.yml: no beta deployment yet/
  )
  assert.equal(waits, 0)
})

test('beta deployment evidence fails closed when a workflow, deployment or run is missing or red', async () => {
  const cases = [
    ['no merged beta pull request', { pulls: [] }, /No merged pull request into beta/],
    ['ambiguous beta provenance', { pulls: [mergedPull(), mergedPull({ head: { sha: otherSha } })] }, /Ambiguous beta provenance/],
    ['no beta deployment', { deployments: [] }, /no beta deployment yet/],
    ['one deploy workflow absent', { deployments: [deployment(11)], runs: { 1011: workflowRun(deployWorkflows[0]) } }, /no beta deployment yet/],
    ['deployment failed', { statuses: { 11: [deploymentStatus(1011, 'failure')] }, runs: defaultDeploymentRuns() }, /Beta deployment evidence failed.*api-deploy\.yml: deployment failure/],
    ['workflow run failed', { runs: { 1011: workflowRun(deployWorkflows[0], { conclusion: 'failure' }), 1012: workflowRun(deployWorkflows[1]) } }, /api-deploy\.yml: deployment success, workflow failure/],
    ['run belongs to another commit', { runs: { 1011: workflowRun(deployWorkflows[0], { head_sha: otherSha }), 1012: workflowRun(deployWorkflows[1]) } }, /another commit/]
  ]
  for (const [name, overrides, expected] of cases) {
    const timed = name === 'no beta deployment' || name === 'one deploy workflow absent'
    await assert.rejects(
      runPromotionGate(inputs({ base: 'main', head: 'beta' }), options(routed(betaDeploymentRoutes({ runs: defaultDeploymentRuns(), ...overrides })), timed ? { timeoutMs: 0 } : {})),
      expected,
      name
    )
  }
})

test('a failed beta deployment fails immediately without waiting', async () => {
  let waits = 0
  const routes = betaDeploymentRoutes({ statuses: { 11: [deploymentStatus(1011, 'failure')] }, runs: defaultDeploymentRuns() })
  await assert.rejects(runPromotionGate(inputs({ base: 'main', head: 'beta' }), options(routed(routes), { wait: async () => { waits++ } })), /Beta deployment evidence failed/)
  assert.equal(waits, 0)
})

test('an unrelated environment deployment cannot substitute for a deploy workflow', async () => {
  const routes = betaDeploymentRoutes({
    deployments: [deployment(11), deployment(13)],
    runs: { 1011: workflowRun(deployWorkflows[0]), 1013: workflowRun('.github/workflows/extension-release.yml') }
  })
  await assert.rejects(runPromotionGate(inputs({ base: 'main', head: 'beta' }), options(routed(routes), { timeoutMs: 0 })), /web-deploy\.yml: no beta deployment yet/)
})

test('a batch that triggered no deploy workflow needs no deployment evidence once the grace window passed', async () => {
  const routes = betaDeploymentRoutes({ deployments: [], registered: [] })
  await runPromotionGate(inputs({ base: 'main', head: 'beta' }), options(routed(routes), { deployRunGraceMs: 0 }))
})

test('within the grace window an unregistered deploy workflow stays pending instead of being excused', async () => {
  const routes = betaDeploymentRoutes({ deployments: [], registered: [] })
  await assert.rejects(
    runPromotionGate(inputs({ base: 'main', head: 'beta' }), options(routed(routes), { timeoutMs: 0, deployRunGraceMs: 600_000 })),
    /api-deploy\.yml: deploy workflow run not registered yet.*web-deploy\.yml: deploy workflow run not registered yet/
  )
})

test('a batch that triggered only one deploy workflow requires evidence only from that one', async () => {
  const routes = betaDeploymentRoutes({
    deployments: [deployment(11)],
    runs: { 1011: workflowRun(deployWorkflows[0]) },
    registered: [deployWorkflows[0]]
  })
  await runPromotionGate(inputs({ base: 'main', head: 'beta' }), options(routed(routes), { deployRunGraceMs: 0 }))
})

test('a hotfix to main skips deploy evidence but requires a non-author approval', async () => {
  const hotfix = inputs({ base: 'main', head: 'hotfix/urgent' })
  const approved = routed([...checksRoute(greenGates()), [/\/pulls\/42\/reviews\?/, () => response([review('reviewer', 'APPROVED')])]])
  await runPromotionGate(hotfix, options(approved))

  const cases = [
    ['no review', [], /approving review/],
    ['author self-approval', [review('author', 'APPROVED')], /approving review/],
    ['comment only', [review('reviewer', 'COMMENTED')], /approving review/],
    ['approval revoked by changes requested', [review('reviewer', 'APPROVED', '2026-10-22T05:00:00Z'), review('reviewer', 'CHANGES_REQUESTED', '2026-10-22T06:00:00Z')], /approving review/],
    ['approval dismissed', [review('reviewer', 'APPROVED'), review('reviewer', 'DISMISSED', '2026-10-22T06:00:00Z')], /approving review/]
  ]
  for (const [name, reviews, expected] of cases) {
    const routes = [...checksRoute(greenGates()), [/\/pulls\/42\/reviews\?/, () => response(reviews)]]
    await assert.rejects(runPromotionGate(hotfix, options(routed(routes))), expected, name)
  }
})

test('a comment after approval does not revoke it, and a second approver counts', () => {
  assert.deepEqual(reviewApprovers([review('reviewer', 'APPROVED'), review('reviewer', 'COMMENTED', '2026-10-22T06:00:00Z')], 'author'), ['reviewer'])
  assert.deepEqual(reviewApprovers([review('author', 'APPROVED'), review('reviewer', 'APPROVED')], 'author'), ['reviewer'])
  assert.deepEqual(reviewApprovers([review('reviewer', 'APPROVED'), review('reviewer', 'CHANGES_REQUESTED', '2026-10-22T06:00:00Z')], 'author'), [])
  assert.deepEqual(reviewApprovers([review('reviewer', 'PENDING'), review('other', 'APPROVED')], 'author'), ['other'])
})

test('review pagination finds an approval beyond the first page', async () => {
  const filler = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, user: { login: `noise-${index}` }, state: 'COMMENTED', submitted_at: '2026-10-22T05:00:00Z' }))
  const routes = [
    ...checksRoute(greenGates()),
    [/\/pulls\/42\/reviews\?per_page=100&page=1$/, () => response(filler)],
    [/\/pulls\/42\/reviews\?per_page=100&page=2$/, () => response([review('reviewer', 'APPROVED')])]
  ]
  await runPromotionGate(inputs({ base: 'main', head: 'hotfix/urgent' }), options(routed(routes)))
})

test('review API errors fail the gate closed', async () => {
  const routes = [...checksRoute(greenGates()), [/\/pulls\/42\/reviews\?/, () => httpFailure(500)]]
  await assert.rejects(runPromotionGate(inputs({ base: 'main', head: 'hotfix/urgent' }), options(routed(routes))), /HTTP 500/)
})

test('a dev-to-beta promotion never reads reviews or deployments', async () => {
  await runPromotionGate(inputs({}), options(routed(checksRoute(greenGates()))))
})

test('a passing gate reports a promotion integrity check run on the head SHA', async () => {
  const posted = []
  const result = await runGateAndReport(env(), { fetchImpl: routed([...checksRoute(greenGates()), checkRunRoute(posted)]) })
  assert.deepEqual(result, { reported: true, passed: true })
  assert.equal(posted.length, 1)
  assert.deepEqual(
    { name: posted[0].name, head_sha: posted[0].head_sha, status: posted[0].status, conclusion: posted[0].conclusion },
    { name: checkRunName, head_sha: headSha, status: 'completed', conclusion: 'success' }
  )
  assert.match(posted[0].output.title, /passed/)
  assert.match(posted[0].output.summary, /dev -> beta/)
  assert.equal(posted[0].details_url, `https://github.com/${repository}/actions/runs/12345`)
})

test('a failing verdict still reports a failing check run with an actionable summary', async () => {
  const posted = []
  const result = await runGateAndReport(env({ HEAD_REF: 'main' }), { fetchImpl: routed([checkRunRoute(posted)]) })
  assert.equal(result.reported, true)
  assert.equal(result.passed, false)
  assert.match(result.message, /not an allowed source/)
  assert.equal(posted[0].conclusion, 'failure')
  assert.match(posted[0].output.summary, /not an allowed source/)
  assert.match(posted[0].output.summary, /push a new commit|re-run this workflow/)
})

test('a hotfix review-only failure tells the approver exactly how to re-run the gate', async () => {
  const posted = []
  const routes = [
    ...checksRoute(greenGates()),
    [/\/pulls\/42\/reviews\?/, () => response([])],
    checkRunRoute(posted)
  ]
  const result = await runGateAndReport(env({ BASE_REF: 'main', HEAD_REF: 'hotfix/urgent' }), { fetchImpl: routed(routes) })
  assert.equal(result.reported, true)
  assert.equal(result.passed, false)
  assert.equal(posted[0].conclusion, 'failure')
  assert.match(posted[0].output.summary, /approving review/)
  assert.match(posted[0].output.summary, /After a non-author approving review lands, re-run this workflow \(Actions → re-run all jobs\) to re-evaluate\./)
})

test('an evidence API error still reports a failing check run', async () => {
  const posted = []
  const routes = [
    [/\/check-runs\?/, () => httpFailure(503)],
    checkRunRoute(posted)
  ]
  const result = await runGateAndReport(env(), { fetchImpl: routed(routes), wait: async () => {} })
  assert.equal(result.reported, true)
  assert.equal(result.passed, false)
  assert.equal(posted[0].conclusion, 'failure')
  assert.match(posted[0].output.summary, /HTTP 503/)
})

test('invalid inputs are reported as a failing check run when the target identity is usable', async () => {
  const posted = []
  const result = await runGateAndReport(env({ BASE_REF: 'dev' }), { fetchImpl: routed([checkRunRoute(posted)]) })
  assert.equal(result.reported, true)
  assert.equal(result.passed, false)
  assert.equal(posted[0].conclusion, 'failure')
  assert.match(posted[0].output.summary, /only supports/)
})

test('an unreportable target leaves the verdict unreported', async () => {
  const result = await runGateAndReport(env({ HEAD_SHA: 'not-a-sha' }), { fetchImpl: async () => assert.fail('must not call the API') })
  assert.equal(result.reported, false)
  assert.equal(result.passed, false)
})

test('a rejected check run creation leaves the verdict unreported', async () => {
  const result = await runGateAndReport(env({ HEAD_REF: 'main' }), { fetchImpl: routed([checkRunRoute([], 500)]) })
  assert.equal(result.reported, false)
  assert.equal(result.passed, false)
})

test('a failed success report is never misreported as a gate failure', async () => {
  const posted = []
  const result = await runGateAndReport(env(), { fetchImpl: routed([...checksRoute(greenGates()), checkRunRoute(posted, 500)]), wait: async () => {} })
  assert.equal(result.reported, false)
  assert.equal(result.passed, false)
  assert.equal(posted.length, 1)
  assert.equal(posted[0].conclusion, 'success')
})

test('check run creation verifies the returned identity', async () => {
  await assert.rejects(createCheckRun({
    repository, headSha, token: 'fixture-token', conclusion: 'success', title: 'Promotion integrity passed', summary: 'fixture'
  }, {
    fetchImpl: async () => response({ name: 'wrong name', head_sha: headSha, status: 'completed', conclusion: 'success' })
  }), /Could not verify/)
})

test('the workflow uses the trusted pull_request_target trigger and reports a distinct check run', () => {
  const workflow = load(readFileSync(new URL('../.github/workflows/promotion-gate.yml', import.meta.url), 'utf8'))
  assert.equal(workflow.on.pull_request, undefined)
  assert.equal(workflow.on.pull_request_review, undefined)
  assert.deepEqual(workflow.on.pull_request_target, { types: ['opened', 'synchronize', 'reopened'], branches: ['beta', 'main'] })
  assert.deepEqual(workflow.permissions, { actions: 'read', checks: 'write', contents: 'read', deployments: 'read', 'pull-requests': 'read' })
  assert.deepEqual(Object.keys(workflow.jobs), ['gate'])
  assert.equal(workflow.jobs.gate.name, 'Promotion gate runner')
  assert.notEqual(workflow.jobs.gate.name, checkRunName)
  assert.equal(workflow.jobs.gate['timeout-minutes'], 60)
  assert.equal(workflow.concurrency['cancel-in-progress'], true)
  assert.match(workflow.concurrency.group, /pull_request\.number/)
  const checkout = workflow.jobs.gate.steps.find(step => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.with.ref, '${{ github.event.repository.default_branch }}')
  assert.equal(checkout.with['persist-credentials'], false)
  const step = workflow.jobs.gate.steps.find(step => step.run === 'node tooling/promotion-gate.mjs')
  assert.ok(step)
  for (const key of ['GH_TOKEN', 'PR_NUMBER', 'PR_AUTHOR', 'BASE_REF', 'HEAD_REF', 'HEAD_SHA', 'HEAD_REPOSITORY', 'BASE_REPOSITORY']) assert.ok(step.env[key], key)
})
