# Proposal

## Why

The `PR review gate` required check reads a declined review run as a legitimate skip, so it reports success for a run that never reviewed anything. The on-demand review workflow is triggered by every pull request comment (`issue_comment`), and both the `/review` filter and the actor admission are compiled into its job conditions. A comment that is not an accepted `/review` request therefore creates a run whose pre-activation stage and every later job are skipped. `pr-review-gate.yml` classifies that all-skipped shape as a deliberate decline and posts `success — Review not run (not activated for this run)`.

GitHub resolves a required check to the newest status for its context on a commit, so this write overwrites the commit's real verdict, including a failure. Reproduced on PR #307 (head `153775b788731fd8966113429b1deaeddb1434f9`): a cancelled on-demand review made the gate report failure at 11:21:15Z; the verification comment — prose, not a `/review` request — then created run `39414403579` (all jobs skipped), and its gate run `39414410716` posted success at 11:21:57Z, the latest status on that commit. Four other pull requests from the same window carry the same spurious skip status (#301, #303, #306, #310).

The consequence became user-visible with the `ready-for-human-review` label: the gate's passing status also adds that label, and the notification bridge announces it. On #307 the pull request had already been closed when the gate ran, so the run took the label-removal branch (no `labeled` event exists after 11:21:16Z; the "re-added the label" sentence in that change's validation record is inaccurate for that run). On an open pull request the same gate run would add the label and could announce readiness for a review that was never requested. The defect is already recorded twice: as the known limitation in `openspec/changes/archive/2026-10-20-ready-for-human-review-label/validation.md`, and as unfixed follow-up 4.3 in `openspec/changes/archive/2026-09-20-fail-gate-when-review-did-not-start/tasks.md`.

The current spec requires a passing skip for any declined activation, so fixing this is a behavior change: `agentic-pr-review` needs a delta.

## What Changes

- **The on-demand run name carries the triggering comment id.** `pr-review-command.md` appends `comment <comment-id>` to its `run-name`, and the compiled workflow is regenerated with the pinned gh-aw v0.88.7. The `workflow_run` payload carries no comment, and the run name is the only run-scoped value the gate can read before it reports, so that is the carrier the gate uses to identify the trigger.
- **The gate confirms the trigger before reporting a declined on-demand run.** Before reporting a run of `pr-review-command.lock.yml` whose `pre_activation` and `activation` are both skipped, the gate reads the comment id from the run name and fetches the comment through the Issues API. A trigger is an accepted request when the body is one of the three `/review` forms gh-aw v0.88.7 accepts, the author's association is one the command path admits (OWNER/MEMBER/COLLABORATOR), and the comment belongs to this pull request. A confirmed request keeps the passing skip it gets today — including a paused `/review` decline. A trigger that is not confirmed (an ordinary comment, an unauthorized or malformed request, a comment on a plain issue, a deleted comment, or a run created before this change whose name has no comment id) reports nothing: no status is posted and the readiness label is not changed. A passing skip would overwrite the head's real verdict (PR #307) and claim a readiness the run never earned; a failure verdict would let any repository visitor block a merge and delete the label.
- **The gate's header comment and `docs/CI.md` document the rule and the run-name contract**, including that only a status the gate reports may change the readiness label.
- **Delta spec for `agentic-pr-review`**: the merge-gate requirement gains the confirmation rule and its scenarios; the readiness-label requirement gains the corresponding label scenario.
- No change to the accepted `/review` forms, the check's name, permissions, the ruleset, or the review workflows' jobs and triggers; the only compiled-workflow change is the run-name value.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `agentic-pr-review`: the merge gate must not report an on-demand run whose trigger is not confirmed as an accepted `/review` request, and the readiness label must not change for such a run.

## Impact

- Files: `.github/workflows/pr-review-command.md` and its recompiled `.github/workflows/pr-review-command.lock.yml`, `.github/workflows/pr-review-gate.yml`, `docs/CI.md`, and the delta spec; plus this change directory (`proposal.md`, `design.md`, `tasks.md`, and `validation.md` when implementation runs).
- The compiled workflow is checked by the existing gh-aw drift guard (`tooling/check-gh-aw-drift.sh`, `agent-config drift check`); the recompile is part of the change.
- No permission changes, no dependency changes, no new secret: the gate already holds `issues: write`, which covers reading an issue comment.
- `workflow_run` only triggers workflows on the default branch, so the change can only act after it merges: verification is an offline replay against recorded runs plus live drills on throwaway pull requests after merge (tasks.md, `validation.md`).
- Rollover: declined on-demand runs created before the new run name cannot be confirmed and therefore report nothing. That is the safe direction (a stale real verdict remains until a later review reports), and it only lasts for the runs in flight when the change merges.
- Residual, recorded rather than silently accepted: a head with no gate status at all can stay `Expected` when its only review run was a declined on-demand run, because the watchdog counts that run as an existing review run; the documented `/review` remedy still applies. The gate also mirrors gh-aw's accepted comment forms and actor list, so both must be re-read when the gh-aw pin moves.
- Residual, recorded: the `pre_activation: success, activation: skipped` membership-declined shape is unchanged — a `/review` from an actor whose association the command path admits but whose repository role is not admin/maintainer/write keeps the existing passing skip and can clear a failure. It predates this change and is tracked as follow-up 7.4; the delta's membership scenario keeps that behavior. The confirmation reads the comment's current author association, so an administrator changing the actor's permission between the comment and the gate read can flip the outcome in either direction; that window is declared in `validation.md`.

## Non-Goals

- **Not** reporting failure for an unrequested run. Any repository visitor can comment on a public pull request; a failure verdict would let a passer-by block a merge and delete its readiness label. Silence is the truthful outcome: no review event happened.
- **Not** changing which `/review` bodies the command trigger accepts. gh-aw v0.88.7 compiles three exact forms; the gate mirrors them only to confirm that a decline was requested, and a malformed `/review` no longer produces a misleading green skip. The durable matcher fix remains upstream.
- **Not** changing the automatic path's skip semantics (fork, draft, stacked, budget), the pause's passing skip, the watchdog, the label contract, or the notification bridge.
- **Not** changing the check's name, permissions, or any repository ruleset configuration.
