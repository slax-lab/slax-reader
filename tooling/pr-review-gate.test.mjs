import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { acceptedReviewRequest, assessReview, gateContext, parseRunTitle, runReviewGate } from './pr-review-gate.mjs'

const repository = 'slax-lab/slax-reader'
const runId = 100
const pullNumber = '42'
const headSha = 'a'.repeat(40)
const mergeSha = 'b'.repeat(40)
const createdAt = '2026-10-28T04:00:00Z'

const automaticRun = (overrides = {}) => ({
  id: runId,
  path: '.github/workflows/pr-review.lock.yml',
  event: 'pull_request',
  display_title: `PR review for #${pullNumber}`,
  head_sha: mergeSha,
  conclusion: 'success',
  created_at: createdAt,
  run_started_at: createdAt,
  ...overrides
})

const reviewJobs = (overrides = {}) => {
  const conclusions = { pre_activation: 'success', activation: 'success', agent: 'success', review_verdict: 'success', ...overrides }
  return Object.entries(conclusions).map(([name, conclusion]) => ({ name, conclusion, steps: [] }))
}

const openPull = (overrides = {}) => ({
  state: 'open',
  draft: false,
  head: { sha: headSha, repo: { full_name: repository } },
  ...overrides
})

const publishedReview = (overrides = {}) => ({
  user: { login: 'github-actions[bot]' },
  submitted_at: '2026-10-28T04:05:00Z',
  commit_id: headSha,
  ...overrides
})

const response = (body, status = 200) => new Response(body === undefined ? '' : JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
})

function fixture({ run = automaticRun(), jobs = reviewJobs(), pull = openPull(), reviews = [publishedReview()], comment, issue, automaticRuns = [], commandRuns = [] } = {}) {
  const statuses = []
  const labelCreates = []
  const labelAdditions = []
  const labelDeletions = []
  const requests = []
  const fetchImpl = async (input, init) => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    const path = url.pathname
    const body = init.body ? JSON.parse(init.body) : undefined
    requests.push({ method, path, body })
    assert.equal(init.headers.Authorization, 'Bearer fixture-token')
    if (method === 'GET' && path === `/repos/${repository}/actions/runs/${runId}`) return response(run)
    if (method === 'GET' && path === `/repos/${repository}/actions/runs/${runId}/jobs`) return response({ jobs })
    if (method === 'GET' && path === `/repos/${repository}/pulls/${pullNumber}`) return response(pull)
    if (method === 'GET' && path === `/repos/${repository}/pulls/${pullNumber}/reviews`) return response(reviews)
    if (method === 'GET' && path === `/repos/${repository}/issues/comments/${parseRunTitle(run.display_title).commentId}`) return response(comment)
    if (method === 'GET' && path === `/repos/${repository}/issues/${pullNumber}`) return response(issue)
    if (method === 'GET' && path === `/repos/${repository}/actions/workflows/pr-review.lock.yml/runs`) return response({ workflow_runs: automaticRuns })
    if (method === 'GET' && path === `/repos/${repository}/actions/workflows/pr-review-command.lock.yml/runs`) return response({ workflow_runs: commandRuns })
    if (method === 'POST' && path === `/repos/${repository}/statuses/${headSha}`) {
      statuses.push(body)
      return response(body, 201)
    }
    if (method === 'POST' && path === `/repos/${repository}/labels`) {
      labelCreates.push(body)
      return response(body, 201)
    }
    if (method === 'POST' && path === `/repos/${repository}/issues/${pullNumber}/labels`) {
      labelAdditions.push(body)
      return response({ labels: body.labels }, 200)
    }
    if (method === 'DELETE' && path === `/repos/${repository}/issues/${pullNumber}/labels/ready-for-human-review`) {
      labelDeletions.push(body)
      return response(undefined, 200)
    }
    throw new Error(`Unexpected GitHub request: ${method} ${url}`)
  }
  return {
    statuses,
    labelCreates,
    labelAdditions,
    labelDeletions,
    requests,
    options: { runId, repository, token: 'fixture-token', fetchImpl, log: () => {} }
  }
}

test('run titles carry the pull request and on-demand comment identities', () => {
  assert.deepEqual(parseRunTitle('PR review for #42'), { prNumber: '42', commentId: '' })
  assert.deepEqual(parseRunTitle('PR review (on demand) for #42 comment 12345'), { prNumber: '42', commentId: '12345' })
  assert.deepEqual(parseRunTitle('PR review (on demand) for #42 comment none'), { prNumber: '42', commentId: '' })
})

test('Important findings post a failing status and remove readiness', async () => {
  const fixtureData = fixture({ jobs: reviewJobs({ review_verdict: 'failure' }) })
  const result = await runReviewGate(fixtureData.options)
  assert.equal(result.state, 'failure')
  assert.equal(result.description, 'Review reported Important findings')
  assert.deepEqual(fixtureData.statuses.map(status => [status.state, status.context, status.description]), [['failure', gateContext, 'Review reported Important findings']])
  assert.equal(fixtureData.labelAdditions.length, 0)
  assert.equal(fixtureData.labelDeletions.length, 1)
})

test('a published clean review posts success and readiness', async () => {
  const fixtureData = fixture()
  const result = await runReviewGate(fixtureData.options)
  assert.equal(result.state, 'success')
  assert.equal(result.description, 'Reviewed: no Important findings')
  assert.equal(fixtureData.statuses[0].state, 'success')
  assert.deepEqual(fixtureData.labelAdditions, [{ labels: ['ready-for-human-review'] }])
  assert.equal(fixtureData.labelDeletions.length, 0)
})

test('an unconfirmed on-demand comment cannot overwrite the current verdict', async () => {
  const run = automaticRun({
    path: '.github/workflows/pr-review-command.lock.yml',
    event: 'issue_comment',
    display_title: `PR review (on demand) for #${pullNumber} comment 12345`
  })
  const fixtureData = fixture({
    run,
    jobs: reviewJobs({ pre_activation: 'skipped', activation: 'skipped', agent: 'skipped', review_verdict: 'skipped' }),
    comment: {
      body: 'looks good',
      author_association: 'MEMBER',
      issue_url: `https://api.github.com/repos/${repository}/issues/${pullNumber}`,
      updated_at: '2026-10-28T03:59:00Z'
    },
    issue: { pull_request: {} }
  })
  const result = await runReviewGate(fixtureData.options)
  assert.equal(result.reason, 'unconfirmed-request')
  assert.equal(fixtureData.statuses.length, 0)
  assert.equal(fixtureData.labelCreates.length, 0)
  assert.equal(fixtureData.labelAdditions.length, 0)
  assert.equal(fixtureData.labelDeletions.length, 0)
})

test('a confirmed declined on-demand request reports a passing skip', async () => {
  const run = automaticRun({
    path: '.github/workflows/pr-review-command.lock.yml',
    event: 'issue_comment',
    display_title: `PR review (on demand) for #${pullNumber} comment 12345`
  })
  const comment = {
    body: '/review',
    author_association: 'MEMBER',
    issue_url: `https://api.github.com/repos/${repository}/issues/${pullNumber}`,
    updated_at: '2026-10-28T03:59:00Z'
  }
  const fixtureData = fixture({
    run,
    jobs: reviewJobs({ pre_activation: 'skipped', activation: 'skipped', agent: 'skipped', review_verdict: 'skipped' }),
    comment,
    issue: { pull_request: {} },
    reviews: []
  })
  const result = await runReviewGate(fixtureData.options)
  assert.equal(result.state, 'success')
  assert.equal(result.description, 'Review not run (not activated for this run)')
  assert.equal(fixtureData.statuses.length, 1)
  assert.equal(fixtureData.labelAdditions.length, 1)
  assert.equal(acceptedReviewRequest({ run, comment, issue: { pull_request: {} }, prNumber: pullNumber, commentId: '12345' }), true)
  assert.equal(acceptedReviewRequest({ run, comment: { ...comment, updated_at: '2026-10-28T04:01:00Z' }, issue: { pull_request: {} }, prNumber: pullNumber, commentId: '12345' }), false)
})

test('a stale lock failure names the activation step and fails closed', async () => {
  const jobs = reviewJobs({ activation: 'failure', agent: 'skipped', review_verdict: 'skipped' })
  jobs.find(job => job.name === 'activation').steps = [{ name: 'Check workflow lock file', conclusion: 'failure' }]
  const fixtureData = fixture({ jobs, reviews: [] })
  const result = await runReviewGate(fixtureData.options)
  assert.equal(result.state, 'failure')
  assert.equal(result.description, "Review did not start (activation failed at 'Check workflow lock file'); failing closed")
  assert.equal(fixtureData.statuses[0].state, 'failure')
})

test('a superseded cancellation leaves the status to the newer run', async () => {
  const fixtureData = fixture({
    run: automaticRun({ conclusion: 'cancelled' }),
    jobs: reviewJobs({ agent: 'skipped', review_verdict: 'skipped' }),
    automaticRuns: [{ event: 'pull_request', created_at: '2026-10-28T04:10:00Z', display_title: `PR review for #${pullNumber}` }]
  })
  const result = await runReviewGate(fixtureData.options)
  assert.equal(result.reason, 'superseded-cancellation')
  assert.equal(fixtureData.statuses.length, 0)
  assert.equal(fixtureData.labelAdditions.length, 0)
  assert.equal(fixtureData.labelDeletions.length, 0)
  assert.equal(fixtureData.requests.some(request => request.path.endsWith(`/pulls/${pullNumber}`)), false)
})

test('an agent success without a published review fails closed', async () => {
  const fixtureData = fixture({ reviews: [] })
  const result = await runReviewGate(fixtureData.options)
  assert.equal(result.state, 'failure')
  assert.equal(result.description, 'No review published for this run; failing closed')
  assert.equal(fixtureData.statuses[0].description, 'No review published for this run; failing closed')
})

test('unknown pre-agent outcomes fail closed rather than passing as skips', () => {
  const result = assessReview({
    jobs: reviewJobs({ pre_activation: 'failure', activation: 'skipped', agent: 'skipped', review_verdict: 'skipped' }),
    stages: { pre: 'failure', activation: 'skipped', agent: 'skipped', verdict: 'skipped' },
    paused: false,
    published: false
  })
  assert.equal(result.state, 'failure')
  assert.match(result.description, /pre_activation/)
})

test('draft, closed, and fork pull requests never gain readiness', async () => {
  const cases = [
    openPull({ draft: true }),
    openPull({ state: 'closed' }),
    openPull({ head: { sha: headSha, repo: { full_name: 'fork/reader' } } })
  ]
  for (const pull of cases) {
    const fixtureData = fixture({ pull })
    const result = await runReviewGate(fixtureData.options)
    assert.equal(result.state, 'success')
    assert.equal(fixtureData.statuses[0].state, 'success')
    assert.equal(fixtureData.labelCreates.length, 0)
    assert.equal(fixtureData.labelAdditions.length, 0)
    assert.equal(fixtureData.labelDeletions.length, 1)
  }
})

test('a cancelled final run with no successor fails closed', async () => {
  const fixtureData = fixture({
    run: automaticRun({ conclusion: 'cancelled' }),
    jobs: reviewJobs({ agent: 'cancelled', review_verdict: 'skipped' }),
    reviews: []
  })
  const result = await runReviewGate(fixtureData.options)
  assert.equal(result.state, 'failure')
  assert.equal(result.description, 'Review did not complete (agent job: cancelled); failing closed')
  assert.equal(fixtureData.statuses[0].state, 'failure')
  assert.equal(fixtureData.labelDeletions.length, 1)
})

test('GitHub error messages retain their safe diagnostic detail', async () => {
  const fetchImpl = async () => response({ message: 'Resource not accessible by integration' }, 403)
  await assert.rejects(
    runReviewGate({ runId, repository, token: 'fixture-token', fetchImpl, log: () => {} }),
    /HTTP 403\): Resource not accessible by integration/
  )
})

test('the workflow is a thin default-branch caller of the tested module', () => {
  const source = readFileSync(new URL('../.github/workflows/pr-review-gate.yml', import.meta.url), 'utf8')
  assert.match(source, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/)
  assert.match(source, /run: node tooling\/pr-review-gate\.mjs/)
  assert.doesNotMatch(source, /confirm_accepted_request\(\)/)
})
