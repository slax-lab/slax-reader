# Proposal

## Why

The merge gate (`pr-review-gate.yml`) only wakes on `workflow_run` completions of the review workflows. When a review run never starts at all — the PR #97 incident shape, where a conflicted pull request has no merge ref and no `pull_request` workflow ever runs — no status named `PR review gate` is ever posted to the head commit, and the required check sits at `Expected` forever, silently blocking the merge with no visible failure. The system has no component that can even observe this shape, let alone report it.

## What Changes

- Add a new workflow `.github/workflows/pr-review-gate-watchdog.yml`, triggered by `schedule` only (a trigger independent of the failure shapes it watches for), that periodically scans open pull requests and fails closed: when a pull request that should have been reviewed has no `PR review gate` status on its head commit, no review run exists for it, and the absence has outlasted a grace threshold, the watchdog posts a **failing** `PR review gate` status on the head commit with an actionable description (e.g. comment `/review` or close/reopen the pull request).
- The watchdog stays silent where a review is intentionally absent: while reviews are paused (`PR_REVIEW_ENABLED`), for draft pull requests, and for fork pull requests — the same decline conditions compiled into the review workflow's activation stage.
- The watchdog is idempotent per head commit (it only speaks while the context is entirely absent, so it posts at most once per head) and self-healing (a later genuine gate report on the same commit supersedes its failure, per Statuses API latest-wins semantics).
- No changes to the review workflows or the existing gate workflow; no model spend; no new dependencies.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `agentic-pr-review`: the merge-gate requirement gains a watchdog obligation — when no review run ever started for an eligible pull request's head, a scheduled fallback reports a failing result on the gate's status context instead of leaving the required check unreported.

## Impact

- **Code**: one new file, `.github/workflows/pr-review-gate-watchdog.yml` (plain GitHub Actions, no gh-aw compilation involved).
- **Activation**: like the gate itself, a `schedule` workflow only runs from the default branch — it takes effect only after merging to `dev`.
- **User-visible behavior**: pull requests in the "review never started" deadlock show a red `PR review gate` failure with an actionable description instead of a permanent `Expected`.
- **Permissions**: the new workflow needs `statuses: write`, `actions: read`, `pull-requests: read`, `contents: read` — no secrets, no model credentials.
- **Operational note**: GitHub disables scheduled workflows after 60 days of repository inactivity; acceptable for this repository, documented in the workflow header.
