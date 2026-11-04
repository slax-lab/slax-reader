# Design

## Context

The archive workflow uses gh-aw Safe Outputs with the default `GITHUB_TOKEN`. gh-aw enforces `draft: true` unless the workflow explicitly sets `draft: false`. The first live run also showed that reviewer-request failure is non-fatal: the PR exists before the warning is visible. The readiness gate ignores draft PRs, so draft creation breaks both team review and notification before any agent prompt is evaluated.

The default token still makes workflow runs approval-required. Non-draft creation does not remove that constraint. The repository already provides **PR Review (on demand)** through `/review`, which gives the task PR author a deterministic alternative that preserves the read-only agent and requires no additional credential.

## Goals / Non-Goals

**Goals:**

- Make non-draft creation explicit and verifiable in the compiled workflow.
- Keep team review, workflow-start instructions, and readiness behavior visible to the task PR author.
- Verify the next real archive PR without adding implementation tasks that depend on this change's own archive output.

**Non-Goals:**

- No change to token identity, agent permissions, review-gate rules, or readiness-card content.
- No new publisher, retry loop, or automatic approval of workflow runs.
- No bridge implementation in this change; the direct-message behavior is sequenced separately.

## Decisions

### D1. Set `draft: false` at the Safe Outputs policy boundary

Set `safe-outputs.create-pull-request.draft` to `false` in the workflow source and regenerate the lock with the pinned gh-aw compiler. This prevents the agent's requested value from being overridden by gh-aw's secure default. Add a contract assertion for both source and compiled configuration.

Alternative considered: retain draft creation and document a manual ready-for-review transition. Rejected because it adds an unnecessary operation and caused the initial team-review request and readiness path to fail.

### D2. Remove draft conversion but retain an explicit workflow-start action

The archive PR body will tell the task PR author to approve the approval-required workflows or comment `/review`. One of these actions is still required after creation. If review is already running, the author takes no additional start action and must not duplicate it with `/review`. No automatic approval is attempted.

Alternative considered: make `/review` mandatory for every archive PR. Rejected because an already-running review needs no duplicate command. The separate bridge change will deliver the same two choices privately to the task PR author.

### D3. Treat live publication fields as required rollout evidence

Tests will pin `draft: false`, the team reviewer, and both instructions in the PR body. The next real archive PR must additionally confirm `isDraft == false`, an effective `slax-lab/reader-core` request, the absence of an unplanned ready-for-review transition, and the subsequent review/readiness result. These observations remain in `validation.md`, not in archive-eligibility tasks.

The bridge's start-review direct message should be deployed before the next end-to-end notification trial. Its implementation and archive sequencing are independent of this repository's delta.

### D4. Admit the archive bot only in automatic PR Review

Add `bots: ["github-actions[bot]"]` to `pr-review.md`, not to `pr-review-command.md`. The existing default token still makes runs approval-required, so a person must approve them before execution. Once approved, the bot actor passes gh-aw's admission check and the review agent can run instead of being skipped. `/review` remains available when no review is running, and existing gate semantics remain unchanged.

Alternative considered: keep the bot rejected and treat Approve and `/review` as equivalent anyway. Rejected because approval preserves `github-actions[bot]` as `github.actor`, which fails the existing role check and can leave readiness without an actual review. Adding the bot to the on-demand command workflow is also rejected because bot comments must not become automatic review commands.

## Risks / Trade-offs

- [Reviewer-request failure remains non-fatal in gh-aw] → Assert the actual team request on the next live PR; do not treat PR creation alone as proof.
- [Default-token workflows still require approval] → Present both approval and `/review` in the PR body and the bridge's direct message.
- [A manual `/review` duplicates an automatic review] → Use it only when no automatic review is running.
- [The first fixed run still diverges from the contract] → Keep the pause switch and manual replay, record the gap, and do not claim success from generated configuration alone.
