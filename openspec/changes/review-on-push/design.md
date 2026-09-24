# Design

## Context

See proposal.md for motivation. The automatic review is a gh-aw agentic workflow: its source is `.github/workflows/pr-review.md`, compiled to `pr-review.lock.yml` with a CI-pinned gh-aw version (drift enforced by `tooling/check-gh-aw-drift.sh`). The trigger list (`opened, ready_for_review, reopened`) lives in that source. Two guards are already compiled into the lock's activation conditions and apply to every `pull_request` event type, including a newly added one:

- `github.event.pull_request.head.repo.id == github.repository_id` — automatic runs only for heads living in this repository (fork exclusion, per the existing spec requirement).
- `GH_AW_REQUIRED_ROLES: admin,maintainer,write` — a pre-activation membership check on the actor.

The merge gate (`pr-review-gate.yml`) reacts to `workflow_run` completions of the review workflows, finds the pull request via the `#<n>` run name, and posts one status per run on the commit that run's published review is pinned to, falling back to the current pull request head when the run published none. It passes only on positive evidence (`activation: skipped`, or a completed agent/verdict path) and fails closed on anything else, explicitly including a cancelled run.

## Goals / Non-Goals

**Goals:**

- A push to an open, non-draft, same-repository pull request starts a review of the pushed head, with no human action.
- Fork pull requests, drafts, and the pause switch behave exactly as today.
- No changes to the gate, the watchdog, or the on-demand command workflow.

**Non-Goals:**

- Cancelling in-progress stale reviews to save inference cost (see Risks; requires changing the gate's fail-closed contract).
- Auto-reviewing fork pushes.
- Changing what a review publishes or how the verdict blocks merges.

## Decisions

### D1: Add `synchronize` to the existing automatic workflow's trigger

One-word change in `pr-review.md`: `types: [opened, ready_for_review, reopened, synchronize]`, then recompile.

Alternatives considered:

- **A plain Actions workflow that comments `/review` on member pushes.** Rejected: comments posted with `GITHUB_TOKEN` carry `author_association: NONE`, and the command workflow's compiled pre-activation requires `OWNER/MEMBER/COLLABORATOR`, so the bot comment would be ignored; authenticating as a real user adds a secret and a second moving part for zero behavioral gain.
- **Extending the on-demand command workflow (`pr-review-command.md`) with a `pull_request` trigger.** Rejected: that workflow exists separately precisely because mixing `slash_command` with `pull_request` triggers made gh-aw's command-position check silently skip automatic runs (documented in its header comment, observed on #18).

### D2: Rely on the compiled fork and membership guards; verify them after recompile

No new gating logic is written. The fork exclusion and the membership roles are emitted by gh-aw from the workflow's existing configuration, and both are event-type-agnostic, so `synchronize` inherits them. Because the guard is generated rather than hand-written, the recompiled lock MUST be inspected to confirm `head.repo.id == github.repository_id` is still present — this verification is a task, not an assumption.

Side benefit: a fork push now fires a declined run, and the gate reports a passing skip on the pushed head (spec: the gate must never leave an un-reviewed fork pull request pending). Today a fork push leaves the new head with no gate status until a maintainer comments `/review`.

### D3: Keep the concurrency group without `cancel-in-progress`

GitHub's default concurrency semantics keep one run in progress and one pending per group, and a new arrival replaces the pending one. With rapid pushes this yields at most one wasted in-progress review of a stale head plus one review of the final head — intermediate heads are never reviewed, which is the desired cost shape.

The tempting alternative, `cancel-in-progress: true`, is rejected for this change: the gate fails closed on a cancelled run and, finding no published review, posts that failure on the *current* pull request head (`pr-review-gate.yml` SHA fallback) — a spurious red required check on the new head until the replacement run reports. Making cancellation safe requires teaching the gate to recognize cancelled-by-supersession, a change to its fail-closed contract that deserves its own evaluation.

### D4: Update the stale promotion note at its source

`AGENTS.md` states the review triggers "do not include `synchronize`" in its promotion-notes paragraph. `AGENTS.md` is generated; the source sentence is `.rulesync/rules/overview.md`. The edit goes through `pnpm agent:sync`, with source and regenerated files in the same commit (pre-commit hook and `agent:check` enforce this). After this change, a sync-back merge that resolves a promotion pull request's conflicts re-triggers the review automatically, so the note's remedy paragraph is narrowed rather than deleted: the conflicted-open case itself still produces no run.

## Risks / Trade-offs

- [Inference cost grows with push frequency — one review per push on same-repository pull requests] → Bounded by pending-run replacement (D3); DeepSeek flash pricing is cheap per run; the `PR_REVIEW_ENABLED` pause switch remains available.
- [Recompilation with a wrong local gh-aw version produces locks CI rejects] → `tooling/check-gh-aw-drift.sh` refuses to compile unless the local CLI matches the pin in `agent-config.yml`; the task list includes installing the pinned version first.
- [A future gh-aw upgrade could stop emitting the fork guard, silently extending auto-review to fork pushes] → The recompiled lock is diff-inspected for the guard in this change; the fork-skip spec requirement keeps the review's compliance pass watching it.
- [A push to a pull request with unresolved merge conflicts may still produce no run, because GitHub does not build the merge ref for conflicted pull requests] → Same behavior as today's `opened` case; the watchdog remains the alarm for heads with no gate status.

## Migration Plan

Single pull request against `dev`: source edit, recompiled locks, rulesync edit, regenerated agent files. No data or deployment migration. Rollback is reverting the pull request (or flipping `PR_REVIEW_ENABLED=false` for an immediate stop).
