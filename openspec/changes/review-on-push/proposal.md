# Proposal

## Why

Today a review run starts only when a pull request is opened, reopened, or marked ready; every later push needs a human to comment `/review` before the required `PR review gate` check reports on the new head. For team members — whose pull requests live on branches of this repository — this is pure friction: the push is the event that should re-request the review. Fork pull requests must stay manual, because auto-running on external pushes would spend inference budget on untrusted input without a maintainer's say.

## What Changes

- The automatic review workflow (`.github/workflows/pr-review.md`) adds `synchronize` to its `pull_request` trigger types, so pushes to an open, non-draft pull request start a new review run.
- Fork pull requests are unaffected: the compiled activation condition already restricts automatic runs to heads living in this repository (`head.repo.id == github.repository_id`), and the pre-activation membership check (`admin,maintainer,write`) gates the actor. Pushes on fork pull requests continue to require a maintainer's `/review`.
- The concurrency group stays per-pull-request without `cancel-in-progress`: a superseded in-progress run finishes, and GitHub's default pending-run replacement drops intermediate queued runs. The gate and the watchdog are unchanged.
- The spec statement "MUST NOT start a new review on ordinary pushes" is narrowed: it now applies to fork pull requests only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agentic-pr-review`: the trigger requirement changes — pushes to a same-repository, non-draft pull request now request a review; the push exclusion narrows to fork pull requests.

## Impact

- `.github/workflows/pr-review.md` (source) and `pr-review.lock.yml` plus `.github/aw` (recompiled with the CI-pinned gh-aw version; drift check enforced by `pnpm agent:check` and pre-commit).
- Cost: every push to a same-repository pull request runs one review, billed by DeepSeek through BYOK. Rapid pushes overlap at most one in-progress stale review; intermediate pending runs are replaced, not queued.
- `.github/workflows/pr-review-gate.yml`, `pr-review-gate-watchdog.yml`, `pr-review-command.md`: no changes. The gate matches runs to pull requests via the `#<n>` run name and reports on the run's reviewed head, which synchronize-triggered runs satisfy. The watchdog's "no review run since the head moved" deadlock case occurs less often.
- `AGENTS.md` documents that review triggers "do not include `synchronize`" in its promotion-notes paragraph; that sentence becomes stale and is updated in this change.
