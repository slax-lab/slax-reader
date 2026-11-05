import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const api = 'https://api.github.com'
const automaticWorkflow = 'pr-review.lock.yml'
const commandWorkflow = 'pr-review-command.lock.yml'
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export const gateContext = 'PR review gate'
export const defaultReadyLabel = 'ready-for-human-review'

// Fail closed when an unconfirmed comment, an unfamiliar stage outcome, or an
// unpublished agent result tries to clear a merge. A cancelled run stays silent
// only when a newer review for the same pull request owns the current head.

export function parseRunTitle(title) {
  const text = String(title ?? '')
  const pullRequests = [...text.matchAll(/#([0-9]+)(?![0-9])/g)]
  const comments = [...text.matchAll(/ comment ([0-9]+)(?![0-9])/g)]
  return {
    prNumber: pullRequests.at(-1)?.[1] ?? '',
    commentId: comments.at(-1)?.[1] ?? ''
  }
}

function reviewKind(run) {
  const workflow = String(run?.path ?? '').split('/').pop()
  if (workflow === automaticWorkflow) return run.event === 'pull_request' ? 'automatic' : undefined
  if (workflow === commandWorkflow) return ['issue_comment', 'pull_request_review_comment'].includes(run.event) ? 'command' : undefined
  return undefined
}

function stageConclusions(jobs) {
  if (!Array.isArray(jobs)) throw new Error('GitHub jobs response has an unexpected shape')
  const conclusion = name => jobs.find(job => job?.name === name)?.conclusion || 'missing'
  return {
    pre: conclusion('pre_activation'),
    activation: conclusion('activation'),
    agent: conclusion('agent'),
    verdict: conclusion('review_verdict')
  }
}

function describeStoppedStage(jobs, stage) {
  const job = jobs.find(candidate => candidate?.name === stage)
  const failedSteps = (job?.steps ?? []).filter(step => step?.conclusion === 'failure').map(step => step.name).filter(Boolean)
  if (failedSteps.length === 1) {
    const step = failedSteps[0]
    return `${stage} failed at '${step.length > 50 ? `${step.slice(0, 47)}...` : step}'`
  }
  return `${stage}: ${job?.conclusion || 'did not run'}`
}

export function assessReview({ jobs, stages, paused, published }) {
  const { pre, activation, agent, verdict } = stages
  let state
  let description

  if (activation === 'skipped' && ['success', 'skipped'].includes(pre)) {
    state = 'success'
    description = paused ? 'Review not run (reviews are currently paused)' : 'Review not run (not activated for this run)'
  } else if (pre === 'success' && activation === 'success') {
    if (agent === 'skipped') {
      state = 'success'
      description = 'Review not run (agent not started)'
    } else if (agent === 'success') {
      if (verdict === 'success') {
        state = 'success'
        description = 'Reviewed: no Important findings'
      } else if (verdict === 'failure') {
        state = 'failure'
        description = 'Review reported Important findings'
      } else {
        state = 'failure'
        description = 'Review ran but produced no verdict; failing closed'
      }
    } else {
      state = 'failure'
      description = `Review did not complete (agent job: ${agent}); failing closed`
    }
  } else {
    state = 'failure'
    const stoppedStage = !['success', 'skipped'].includes(pre)
      ? 'pre_activation'
      : !['success', 'skipped'].includes(activation) ? 'activation' : ''
    description = stoppedStage
      ? `Review did not start (${describeStoppedStage(jobs, stoppedStage)}); failing closed`
      : `Review did not start (pre_activation: ${pre}, activation: ${activation}); failing closed`
  }

  if (agent === 'success' && !published) {
    state = 'failure'
    description = 'No review published for this run; failing closed'
  }
  return { state, description }
}

export function acceptedReviewRequest({ run, comment, issue, prNumber, commentId }) {
  if (!prNumber || !commentId || !run?.created_at || !comment) return false
  const updated = comment.updated_at ?? comment.created_at ?? ''
  if (!updated || updated > run.created_at) return false
  const body = comment.body
  const acceptedBody = body === '/review' || body?.startsWith('/review ') || body?.startsWith('/review\n')
  const acceptedActor = ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.author_association)
  const acceptedIssue = comment.issue_url?.endsWith(`/issues/${prNumber}`)
  return Boolean(acceptedBody && acceptedActor && acceptedIssue && issue && Object.hasOwn(issue, 'pull_request'))
}

function titleMatchesPullRequest(title, prNumber) {
  return new RegExp(`#${prNumber}([^0-9]|$)`).test(String(title ?? ''))
}

function newerReviewRuns(runs, kind, prNumber, createdAt) {
  const events = kind === 'automatic' ? ['pull_request'] : ['issue_comment', 'pull_request_review_comment']
  return (runs ?? []).filter(run => events.includes(run.event) && run.created_at > createdAt && titleMatchesPullRequest(run.display_title, prNumber))
}

function githubClient(token, fetchImpl) {
  return async (path, { method = 'GET', body } = {}) => {
    const response = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'slax-pr-review-gate',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000)
    })
    const text = await response.text()
    if (!response.ok) {
      let detail = ''
      try {
        const error = JSON.parse(text)
        if (typeof error.message === 'string' && error.message) detail = `: ${error.message}`
      } catch {}
      throw new Error(`GitHub API request failed (HTTP ${response.status})${detail}`)
    }
    if (!text) return undefined
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('GitHub API returned an invalid response')
    }
  }
}

async function allPages(request, path) {
  const items = []
  for (let page = 1; ; page++) {
    const separator = path.includes('?') ? '&' : '?'
    const batch = await request(`${path}${separator}per_page=100&page=${page}`)
    if (!Array.isArray(batch)) throw new Error('GitHub API returned an unexpected list response')
    items.push(...batch)
    if (batch.length < 100) return items
  }
}

export async function runReviewGate({
  runId,
  repository,
  token,
  paused = false,
  readyLabel = defaultReadyLabel,
  fetchImpl = fetch,
  log = console.log
}) {
  if (!repositoryPattern.test(repository ?? '')) throw new Error('Missing or invalid REPO')
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error('Missing or invalid RUN_ID')
  if (!token) throw new Error('Missing GitHub token')
  const request = githubClient(token, fetchImpl)
  const run = await request(`/repos/${repository}/actions/runs/${runId}`)
  const workflow = String(run.path ?? '').split('/').pop()
  const kind = reviewKind(run)
  if (!kind) {
    log(`Run ${runId} is ${workflow || 'unknown'} on '${run.event}', not a review. Leaving the status untouched.`)
    return { action: 'ignored', reason: 'not-a-review' }
  }

  const jobsResponse = await request(`/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`)
  const jobs = jobsResponse?.jobs
  const stages = stageConclusions(jobs)
  const title = run.display_title ?? ''
  const { prNumber, commentId } = parseRunTitle(title)

  if (kind === 'command' && stages.pre === 'skipped' && stages.activation === 'skipped') {
    let accepted = false
    if (prNumber && commentId) {
      try {
        const comment = await request(`/repos/${repository}/issues/comments/${commentId}`)
        const issue = await request(`/repos/${repository}/issues/${prNumber}`)
        accepted = acceptedReviewRequest({ run, comment, issue, prNumber, commentId })
      } catch {}
    }
    if (!accepted) {
      log(`Run ${runId} was not a requested review (trigger '${commentId || 'none'}' not confirmed); leaving the status and label untouched.`)
      return { action: 'ignored', reason: 'unconfirmed-request' }
    }
    log(`Run ${runId} was created by an accepted /review request (comment ${commentId}); reporting the decline.`)
  }

  if (!prNumber) {
    log(`::warning::Run ${runId} has no pull request number in its title; not reporting.`)
    return { action: 'ignored', reason: 'missing-pull-request' }
  }

  if (run.conclusion === 'cancelled') {
    const created = encodeURIComponent(`>=${run.created_at}`)
    const [automatic, command] = await Promise.all([
      request(`/repos/${repository}/actions/workflows/${automaticWorkflow}/runs?per_page=30&created=${created}`),
      request(`/repos/${repository}/actions/workflows/${commandWorkflow}/runs?per_page=30&created=${created}`)
    ])
    const newer = [
      ...newerReviewRuns(automatic?.workflow_runs, 'automatic', prNumber, run.created_at),
      ...newerReviewRuns(command?.workflow_runs, 'command', prNumber, run.created_at)
    ]
    if (newer.length > 0) {
      log(`Run ${runId} was cancelled and a newer review run exists for #${prNumber}; leaving the status to the newest run.`)
      return { action: 'ignored', reason: 'superseded-cancellation' }
    }
    log(`Run ${runId} was cancelled with no newer review run for #${prNumber}; failing closed below.`)
  }

  const pull = await request(`/repos/${repository}/pulls/${prNumber}`)
  const reviews = await allPages(request, `/repos/${repository}/pulls/${prNumber}/reviews`)
  const runStarted = run.run_started_at ?? run.created_at
  const publishedReviews = reviews.filter(review => review?.user?.login?.includes('github-actions') && review.submitted_at >= runStarted)
  const reviewSha = publishedReviews.at(-1)?.commit_id ?? ''
  const pullHead = pull?.head?.sha ?? ''
  const sha = reviewSha || pullHead
  log(`pull request #${prNumber}: head=${pullHead} reviewed=${reviewSha} reporting on ${sha}`)

  const verdict = assessReview({ jobs, stages, paused, published: Boolean(reviewSha) })
  log(`workflow=${workflow} event=${run.event} pre=${stages.pre} activation=${stages.activation} agent=${stages.agent} verdict=${stages.verdict} -> ${verdict.state} (${verdict.description}) on ${sha}`)
  await request(`/repos/${repository}/statuses/${sha}`, {
    method: 'POST',
    body: {
      state: verdict.state,
      context: gateContext,
      description: verdict.description,
      target_url: `https://github.com/${repository}/actions/runs/${runId}`
    }
  })

  if (sha === pullHead) {
    const ready = verdict.state === 'success' && pull.state === 'open' && pull.draft !== true && pull.head?.repo?.full_name === repository
    if (ready) {
      try {
        await request(`/repos/${repository}/labels`, {
          method: 'POST',
          body: { name: readyLabel, color: '0e8a16', description: 'Automated checks passed; ready for human review' }
        })
      } catch {}
      await request(`/repos/${repository}/issues/${prNumber}/labels`, { method: 'POST', body: { labels: [readyLabel] } })
    } else {
      try {
        await request(`/repos/${repository}/issues/${prNumber}/labels/${readyLabel}`, { method: 'DELETE' })
      } catch {}
    }
  }

  return { action: 'reported', prNumber, sha, ...verdict }
}

export async function runReviewGateFromEnv(env = process.env) {
  return runReviewGate({
    runId: Number(env.RUN_ID),
    repository: env.REPO ?? '',
    token: env.GH_TOKEN ?? '',
    paused: env.PAUSED === 'true',
    readyLabel: env.READY_LABEL || defaultReadyLabel
  })
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try {
    await runReviewGateFromEnv()
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exitCode = 1
  }
}
