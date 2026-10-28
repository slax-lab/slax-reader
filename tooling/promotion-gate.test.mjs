import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { allowedHead, assertMigrationReleaseEvidence, assessSuiteGates, checkRunName, createCheckRun, defaultTimeoutMs, deployWorkflows, pollIntervalMs, readInputs, readTimeout, runGateAndReport, runPromotionGate, suiteGates } from './promotion-gate.mjs'

const require = createRequire(import.meta.url)
const { load } = createRequire(require.resolve('rulesync'))('js-yaml')

const repository = 'slax-lab/slax-reader'
const headSha = 'a'.repeat(40)
const sourceSha = 'b'.repeat(40)
const otherSha = 'c'.repeat(40)
const introducingSha = 'd'.repeat(40)
const ownerBase = 'e'.repeat(40)
const d1 = name => `apps/api/prisma/d1_migrations/${name}.sql`
const pg = name => `apps/api/prisma/pg_migrations/${name}/migration.sql`
const expandText = '-- migration-safety: expand\nALTER TABLE example ADD COLUMN value integer;\n'
const contractText = [
  '-- migration-safety: contract',
  '-- removes: example_unique_key',
  '-- prerequisite-change: example-removal',
  '-- prerequisite-pr: 412',
  '-- prerequisite-merge: ' + '9'.repeat(40),
  '-- reason: The prerequisite release removed the last reader and writer.',
  'DROP INDEX IF EXISTS "example_unique_key";',
  ''
].join('\n')
const codeownersText = [
  '* @slax-lab/reader-core',
  '/apps/api/** @DGuang21 @slax-lab/reader-core',
  '/apps/api/prisma/** @DGuang21 @boxcounter @slax-lab/reader-core'
].join('\n')
const encode = text => Buffer.from(text).toString('base64')

const inputs = (overrides = {}) => ({
  repository, number: 42, base: 'beta', head: 'dev', headSha,
  headRepository: repository, baseRepository: repository, ...overrides
})
const env = (overrides = {}) => ({
  GITHUB_REPOSITORY: repository, GH_TOKEN: 'fixture-token', GITHUB_RUN_ID: '12345',
  PR_NUMBER: '42', BASE_REF: 'beta', HEAD_REF: 'dev', HEAD_SHA: headSha,
  HEAD_REPOSITORY: repository, BASE_REPOSITORY: repository, ...overrides
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
const mergeBaseSha = '4'.repeat(40)
// The promotion diff comes from the merge base plus two recursive tree listings;
// the compare call supplies only the merge base.
const compareRoute = () => [
  [/\/compare\//, () => response({ status: 'ahead', merge_base_commit: { sha: mergeBaseSha } })],
  [/\/git\/trees\/[a-f0-9]{40}\?recursive=1$/, () => response({ truncated: false, tree: [] })],
  // The pre-release target is the base branch tip; a pull request is unmerged.
  [/\/git\/ref\/heads\/(?:main|beta)$/, url => response({ object: { sha: url.endsWith('main') ? '2'.repeat(40) : '3'.repeat(40) } })]
]
const mergedPull = (overrides = {}) => ({ merged_at: '2026-10-22T03:18:30Z', merge_commit_sha: headSha, base: { ref: 'beta' }, head: { sha: sourceSha }, ...overrides })
const deployment = (id, createdAt = '2026-10-22T03:18:35Z') => ({ id, created_at: createdAt, environment: 'beta', sha: sourceSha })
const deploymentStatus = (runId, state = 'success', createdAt = '2026-10-22T03:21:00Z') => ({ state, created_at: createdAt, log_url: `https://github.com/${repository}/actions/runs/${runId}/job/7` })
const workflowRun = (path, overrides = {}) => ({ path, head_sha: sourceSha, status: 'completed', conclusion: 'success', ...overrides })

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
    ...compareRoute(),
    ...checksRoute(greenGates()),
    [/\/commits\/[a-f0-9]{40}\/pulls\?/, () => response(pulls)],
    [/\/actions\/workflows\//, url => {
      // The live endpoint accepts only a workflow id or file name; a
      // repo-relative path 404s. Match the request the way the API would.
      const segment = url.match(/\/actions\/workflows\/([^/]+)\/runs\?head_sha=/)?.[1]
      const path = deployWorkflows.find(candidate => segment === candidate.split('/').pop())
      assert.ok(path, `workflow-runs request must use the workflow file name, got ${url}`)
      const wasTriggered = registered.includes(path)
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
    HEAD_REPOSITORY: repository, BASE_REPOSITORY: repository
  }
  assert.deepEqual(readInputs(values), inputs())
  for (const [key, value] of [
    ['GITHUB_REPOSITORY', 'not-a-repository'], ['PR_NUMBER', '0'], ['PR_NUMBER', '1.5'], ['BASE_REF', 'dev'],
    ['HEAD_REF', ''], ['HEAD_SHA', 'A'.repeat(40)], ['HEAD_REPOSITORY', ''], ['BASE_REPOSITORY', '']
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
    ...compareRoute(),
    [/\/check-runs\?/, () => response({ check_runs: polls++ === 0 ? greenGates().map((run, index) => index === 0 ? { ...run, status: 'in_progress' } : run) : greenGates() })]
  ])
  let waits = 0
  await runPromotionGate(inputs({}), options(fetchImpl, { wait: async milliseconds => { waits++; assert.equal(milliseconds, pollIntervalMs) } }))
  assert.equal(polls, 2)
  assert.equal(waits, 1)
})

test('a failed suite gate fails immediately while a pending one times out with its name', async () => {
  let waits = 0
  const failed = routed([...compareRoute(), ...checksRoute(greenGates().map((run, index) => index === 5 ? { ...run, conclusion: 'failure' } : run))])
  await assert.rejects(runPromotionGate(inputs({}), options(failed, { wait: async () => { waits++ } })), /Tooling CI gate \(failure\)/)
  assert.equal(waits, 0)
  const pending = routed([...compareRoute(), ...checksRoute(greenGates().map((run, index) => index === 0 ? { ...run, status: 'queued' } : run))])
  await assert.rejects(runPromotionGate(inputs({}), options(pending, { wait: async () => { waits++ }, timeoutMs: 0 })), /did not complete before the timeout.*Web CI gate/)
  assert.equal(waits, 0)
})

test('check runs paginate and only the first page cannot satisfy the gate', async () => {
  const pages = [
    ...compareRoute(),
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

test('a hotfix to main skips deploy evidence and never reads reviews', async () => {
  // No reviews route is registered: any attempt to read them throws inside routed().
  await runPromotionGate(inputs({ base: 'main', head: 'hotfix/urgent' }), options(routed([...compareRoute(), ...checksRoute(greenGates())])))
})

test('a dev-to-beta promotion never reads reviews or deployments', async () => {
  await runPromotionGate(inputs({}), options(routed([...compareRoute(), ...checksRoute(greenGates())])))
})

test('a passing gate reports a promotion integrity check run on the head SHA', async () => {
  const posted = []
  const result = await runGateAndReport(env(), { fetchImpl: routed([...compareRoute(), ...checksRoute(greenGates()), checkRunRoute(posted)]) })
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

test('an evidence API error still reports a failing check run', async () => {
  const posted = []
  const routes = [
    ...compareRoute(),
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
  const result = await runGateAndReport(env(), { fetchImpl: routed([...compareRoute(), ...checksRoute(greenGates()), checkRunRoute(posted, 500)]), wait: async () => {} })
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

// Migration release evidence fixtures: the promotion diff comes from the
// compare API, the introduced file and CODEOWNERS from the contents API, and
// ownership from the introducing pull request's reviews. Every frozen ref
// (main, beta, the dev adoption commit) reads as absent.
function migrationRoutes({ baseFiles = [], headFiles = [], truncated = false, content = {}, betaFiles = [], mainTipFiles = [], codeowners = codeownersText, reviews = [{ user: { login: 'DGuang21' }, state: 'APPROVED', submitted_at: '2026-10-27T00:00:00Z', id: 1 }], pulls = [{ number: 700, merged_at: '2026-10-27T00:00:00Z', merge_commit_sha: introducingSha, base: { sha: ownerBase }, head: { sha: sourceSha } }] } = {}) {
  return [
    [/\/git\/trees\/([a-f0-9]{40})\?recursive=1$/, url => {
      const ref = url.match(/\/git\/trees\/([a-f0-9]{40})/)[1]
      if (truncated) return response({ truncated: true, tree: [] })
      return response({ truncated: false, tree: ref === headSha ? headFiles : baseFiles })
    }],
    ...compareRoute(),
    [/\/contents\//, url => {
      const path = decodeURIComponent(url.match(/\/contents\/([^?]+)\?/)[1])
      const ref = new URL(url).searchParams.get('ref')
      if (path === '.github/CODEOWNERS' && (ref === headSha || ref === ownerBase)) return response({ type: 'file', encoding: 'base64', content: encode(codeowners) })
      // The pre-release target tip is whichever branch the gate reads; beta is
      // the source branch of a beta-to-main promotion.
      if (ref === '2'.repeat(40) || ref === 'main') return mainTipFiles.includes(path) ? response({ type: 'file', encoding: 'base64', content: encode(content[path] ?? '') }) : httpFailure(404)
      if (ref === '3'.repeat(40) || ref === 'beta') return betaFiles.includes(path) ? response({ type: 'file', encoding: 'base64', content: encode(content[path] ?? '') }) : httpFailure(404)
      if (ref !== headSha) return httpFailure(404)
      if (path in content) return response({ type: 'file', encoding: 'base64', content: encode(content[path]) })
      return httpFailure(404)
    }],
    [/\/commits\?path=/, () => response([{ sha: introducingSha }])],
    [/\/commits\/[a-f0-9]{40}\/pulls/, () => response(pulls)],
    [/\/pulls\/\d+\/reviews/, () => response(reviews)],
    ...checksRoute(greenGates())
  ]
}

test('a promotion adding an undeclared migration fails the gate on the declaration stage', async () => {
  const routes = migrationRoutes({ headFiles: [{ path: d1('0002'), type: 'blob', sha: '5'.repeat(40) }], content: { [d1('0002')]: 'ALTER TABLE t ADD COLUMN c int;\n' } })
  await assert.rejects(runPromotionGate(inputs({}), options(routed(routes))), /Migration release evidence failed:[\s\S]*declaration: apps\/api\/prisma\/d1_migrations\/0002\.sql/)
})

test('a promotion adding an approved expand migration passes', async () => {
  const routes = migrationRoutes({ headFiles: [{ path: d1('0002'), type: 'blob', sha: '5'.repeat(40) }], content: { [d1('0002')]: expandText } })
  await runPromotionGate(inputs({}), options(routed(routes)))
})

test('a promotion whose new migration has no named-owner approval fails on ownership', async () => {
  const routes = migrationRoutes({
    headFiles: [{ path: d1('0002'), type: 'blob', sha: '5'.repeat(40) }],
    content: { [d1('0002')]: expandText },
    reviews: [{ user: { login: 'outsider' }, state: 'APPROVED', submitted_at: '2026-10-27T00:00:00Z', id: 1 }]
  })
  await assert.rejects(runPromotionGate(inputs({}), options(routed(routes))), /Migration release evidence failed:[\s\S]*ownership:/)
})

test('a promotion that deletes a migration fails on immutability', async () => {
  const routes = migrationRoutes({ baseFiles: [{ path: d1('0001'), type: 'blob', sha: '5'.repeat(40) }] })
  await assert.rejects(runPromotionGate(inputs({}), options(routed(routes))), /immutability:/)
})

test('a hotfix promotion carrying a contract fails before any deployment evidence', async () => {
  const routes = migrationRoutes({ headFiles: [{ path: pg('drop'), type: 'blob', sha: '5'.repeat(40) }], content: { [pg('drop')]: contractText } })
  await assert.rejects(runPromotionGate(inputs({ base: 'main', head: 'hotfix/urgent' }), options(routed(routes))), /hotfix may add only expand/)
})

test('a beta-to-main promotion whose migrations already live on beta passes as frozen', async () => {
  const path = d1('0002')
  const routes = migrationRoutes({ headFiles: [{ path, type: 'blob', sha: '5'.repeat(40) }], betaFiles: [path], content: { [path]: 'ALTER TABLE t ADD COLUMN c int;\n' } })
  const result = await assertMigrationReleaseEvidence(inputs({ base: 'main', head: 'beta' }), { token: 'fixture-token', fetchImpl: routed(routes) })
  assert.deepEqual(result.current, [])
  assert.deepEqual(result.frozen, [path])
})

test('an actual re-add on the target branch fails the promotion', async () => {
  const path = d1('0002')
  const routes = migrationRoutes({ headFiles: [{ path, type: 'blob', sha: '5'.repeat(40) }], mainTipFiles: [path], content: { [path]: expandText } })
  await assert.rejects(
    assertMigrationReleaseEvidence(inputs({ base: 'main', head: 'beta' }), { token: 'fixture-token', fetchImpl: routed(routes) }),
    /already carried this migration before the release/
  )
})

test('a dev-to-beta promotion whose migrations came from main is frozen', async () => {
  const path = d1('0002')
  const routes = migrationRoutes({ headFiles: [{ path, type: 'blob', sha: '5'.repeat(40) }], mainTipFiles: [path], content: { [path]: 'ALTER TABLE t ADD COLUMN c int;\n' } })
  const result = await assertMigrationReleaseEvidence(inputs({}), { token: 'fixture-token', fetchImpl: routed(routes) })
  assert.deepEqual(result.current, [])
  assert.deepEqual(result.frozen, [path])
})

test('a truncated tree listing fails the gate closed', async () => {
  const routes = migrationRoutes({ truncated: true })
  await assert.rejects(runPromotionGate(inputs({}), options(routed(routes))), /tree listing is truncated/)
})

test('a promotion diff larger than 300 files still reaches the migration verdict', async () => {
  const headFiles = [
    ...Array.from({ length: 400 }, (_, index) => ({ path: `apps/web/file-${index}.vue`, type: 'blob', sha: String(index).padStart(40, '0') })),
    { path: d1('0002'), type: 'blob', sha: '5'.repeat(40) }
  ]
  const routes = migrationRoutes({ headFiles, content: { [d1('0002')]: 'ALTER TABLE t ADD COLUMN c int;\n' } })
  await assert.rejects(runPromotionGate(inputs({}), options(routed(routes))), /declaration: apps\/api\/prisma\/d1_migrations\/0002\.sql/)
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
  for (const key of ['GH_TOKEN', 'PR_NUMBER', 'BASE_REF', 'HEAD_REF', 'HEAD_SHA', 'HEAD_REPOSITORY', 'BASE_REPOSITORY']) assert.ok(step.env[key], key)
})
