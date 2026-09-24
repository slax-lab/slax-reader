# Tasks

## 1. Watchdog workflow

- [x] 1.1 Create `.github/workflows/pr-review-gate-watchdog.yml` with a `schedule`-only trigger (every 15 minutes, off the `:00`/`:30` herd marks), a header comment covering purpose, the default-branch-only activation rule, and the 60-day-inactivity caveat; verify with `actionlint` (or `npx actionlint`) that the workflow parses
- [x] 1.2 Implement the scan job per design D3/D5: permissions `statuses: write, actions: read, pull-requests: read, contents: read`, early exit when `vars.PR_REVIEW_ENABLED == 'false'`, then per open pull request apply the predicate (skip draft/fork; skip when a `PR review gate` status exists on the head SHA; skip when a `pr-review.lock.yml` or `pr-review-command.lock.yml` run whose `display_title` contains `#<n>` exists with `created_at` >= the head commit's committer date; skip when the head commit is younger than 45 minutes) — verify by running the script locally with `GH_TOKEN` against the repository in a dry-run mode that prints decisions without posting
- [x] 1.3 Implement the fail-closed POST per design D4 (`state=failure`, `context="PR review gate"`, actionable description naming `/review` and close/reopen, `target_url` at the watchdog run), keeping the dry-run guard; verify the dry run on PR-shaped fixtures prints the expected status payloads

## 2. Verification

- [x] 2.1 Walk each spec scenario in `specs/agentic-pr-review/spec.md` against the implementation and confirm the predicate covers it (deadlock fires; reported/queued/fresh/draft/fork/paused stay silent; once-per-head idempotency; latest-wins supersede) — verify by mapping each scenario to the guard clause that implements it in a PR-body self-check note
- [x] 2.2 Run the local pre-push review required by `REVIEW.md` on the full diff and resolve Important findings before pushing

## 3. Rollout

- [ ] 3.1 Open the PR targeting `dev` with `OpenSpec: pr-review-gate-watchdog` in the body; after merge, confirm on the Actions tab that the schedule appears and the first tick completes clean (no posts on a healthy repository)
