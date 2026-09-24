# Design

## Context

See proposal.md for motivation (the PR #97 deadlock). The facts that shape the approach, all verified in the current repository:

- `pr-review-gate.yml` wakes only on `workflow_run` completions of `PR Review` / `PR Review (on demand)`. A review that never starts produces no run, no `workflow_run` event, and therefore no status — the required check waits forever at `Expected`.
- A conflicted pull request has no merge ref, so no `pull_request` workflow starts for it at all (observed on #97; tutorial 5.2). Any watchdog triggered by `pull_request` would be absent in exactly the shape it exists for.
- The review workflow's decline conditions are compiled into the `activation` job's `if:` in `pr-review.lock.yml`: paused (`PR_REVIEW_ENABLED == 'false'`), draft, fork (`head.repo.id != repository_id`), and a stacked pull request that is not the top of its stack (a GraphQL-only field, null in webhook payloads).
- For `pull_request` runs, the run's `head_sha` is the merge commit, not the pull request head (`pr-review-gate.yml:113-131` handles this). Runs therefore cannot be matched to a pull request by SHA; the existing contract is the run's `display_title` carrying `#<number>` (`run-name` in `pr-review.md`).
- The Statuses API keeps the latest status per context per SHA, so a genuine gate report posted after the watchdog automatically supersedes it.
- The default branch is `dev`; `schedule` workflows run only from the default branch's copy of the file.

## Goals / Non-Goals

**Goals:**

- Every "review was supposed to happen but never started" shape becomes a visible red failure on the required `PR review gate` context within a bounded time, regardless of cause (conflict vacuum, dropped event, broken or renamed review workflow).
- Zero false positives in steady state: a healthy pull request (status present, run present, or fresh) is never touched.
- Near-zero operating cost: a handful of REST calls per tick, no model spend, no secrets.

**Non-Goals:**

- Self-healing (triggering a review): the deadlock's flagship shape — a conflicted pull request — has no merge ref to review, so the watchdog alarms with a remedial instruction instead.
- Covering declined-by-design pull requests (drafts, forks, paused reviews, non-top stacked pull requests): those intentionally have no review.
- Changing option 1 from the incident analysis (adding `synchronize` to the review triggers): a separate, complementary change.

## Decisions

### D1: `schedule` trigger only, every 15 minutes

The trigger must be independent of the failure shapes it watches. `pull_request` dies with conflicted pull requests; `workflow_run` is the blind spot being fixed. Schedule runs from the default branch, so the watchdog takes effect on merge to `dev` — same activation rule as the gate itself.

*Alternative considered*: `pull_request` + schedule hybrid. Rejected: the `pull_request` leg covers nothing the schedule leg misses, and doubles the code paths.

### D2: Separate workflow file, not a job in `pr-review-gate.yml`

The gate's script reads `github.event.workflow_run.*` from its first line; under a `schedule` event that payload does not exist and the job would fail or, worse, misreport. A separate `pr-review-gate-watchdog.yml` keeps both scripts single-purpose. Plain GitHub Actions, not gh-aw — no agent, no model request, like `pr-review-paused-notice.yml`.

### D3: Detection predicate, per open pull request

```
skip everything            if vars.PR_REVIEW_ENABLED == 'false'        (mirrors gate's PAUSED read)
skip pull request          if draft || head.repo.fork                  (REST-visible decline conditions)
skip pull request          if a "PR review gate" status exists on head SHA
skip pull request          if a review run titled "...#N" exists with created_at >= head commit's committer date
skip pull request          if head commit's committer date is younger than 45 minutes
otherwise                  POST failure to repos/.../statuses/<head SHA>
```

Rationale for the details:

- **Reference timestamp is the head commit's committer date.** There is no cheap REST field for "when the head was pushed"; committer date is the available proxy. Its known weakness (a plain push keeps the original committer date, so the age test can pass "early") is harmless because the run-existence test is what actually guards a just-triggered review: GitHub creates the run record within seconds of the event, so any review that *will* run is already visible as a run. The 45-minute grace threshold is then pure margin, comfortably above the review's `timeout-minutes: 20` plus queueing.
- **Run matching parses `#N` from `display_title`**, not `head_sha` — per the merge-commit fact above. This reuses the contract the gate already depends on. Both review workflows are queried (automatic and on-demand).
- **Fork and draft are skipped via REST fields** (`head.repo.fork`, `draft`). The stacked-PR decline uses a GraphQL-only field and cannot be mirrored cheaply — see Risks.
- **Idempotency is structural**: posting once makes the context exist, so the first predicate turns the pull request silent on later ticks. A moved head is a new SHA and re-evaluates cleanly.

### D4: Fail closed with an actionable description

The posted status is `state=failure`, `context="PR review gate"`, `target_url` pointing at the watchdog run, and a description that (a) states no review ever started for this head, (b) names the remedial actions (comment `/review`, or close and reopen the pull request), and (c) claims no unverified cause — same discipline as the gate's own messages. Failure rather than pending: the point of the change is that a red cross draws a human, where `Expected` did not.

*Alternative considered*: post `pending` to avoid blocking merges on false positives. Rejected: pending is visually indistinguishable from the deadlock being fixed.

### D5: Minimal permissions, no secrets

`statuses: write`, `actions: read`, `pull-requests: read`, `contents: read`, using `github.token`. No model credentials exist in this workflow, so nothing in the credential-isolation requirement is engaged.

## Risks / Trade-offs

- **False positive races a just-started review** → the run-existence test sees run records seconds after the triggering event; the 45-minute threshold is additional margin. If it ever fires wrongly, the genuine gate report supersedes the failure automatically (latest status wins), so the cost is a temporary red cross.
- **Stacked pull requests**: the activation stage declines a pull request that is not the top of its stack, using a GraphQL-only field the watchdog does not read. A conflicted, non-top stacked pull request would get a failure it does not deserve → accepted: this repository's branching model (one task = one branch → `dev`) makes stacks rare; the remediation hint (`/review`) resolves it; adding a GraphQL stack lookup is a possible later refinement.
- **The watchdog can itself fail silently** (schedule disabled after 60 days of repository inactivity, a bug in its own script) → accepted as one-level-up invisibility inherent to any watcher; the inactivity caveat is documented in the workflow header. Not worth a watcher-watcher.
- **Statuses API caps 1000 statuses per SHA/context** → unreachable: at most one post per head SHA by construction.

## Migration Plan

1. Merge the workflow file to `dev`. Nothing else changes; existing workflows are untouched.
2. The watchdog starts on the next scheduled tick after merge. No backfill needed — any currently deadlocked pull request is picked up automatically once it exceeds the threshold.
3. Rollback: delete the file (or disable the workflow in the Actions UI). Pull requests the watchdog flagged keep their failure status until a genuine gate report or a head push supersedes it — cosmetically stale, but merge-blocking only as intended.
