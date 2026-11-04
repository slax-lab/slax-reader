# Design

## Context

The live approval experiment showed that a bot-authored automatic PR Review can execute after human approval, but its completion does not trigger the downstream `workflow_run` gate. By contrast, the human-initiated ready-for-review path used by archive PR #485 completed automatic review, the gate, readiness labeling, and Feishu notification. The design should use that existing path rather than expanding bot admission or adding another trigger.

The archive agent still creates the PR through Safe Outputs with the default `GITHUB_TOKEN`. gh-aw already creates draft PRs by default, so retaining that behavior is simpler than overriding it. The bridge change `notify-archive-review-start` owns the direct message; this repository change owns the PR state and matching PR-body instruction.

## Goals / Non-Goals

**Goals:**

- Reuse the human `ready_for_review` event as the single archive-review entry point.
- Explain the archive's purpose and the consequence of clicking **Ready for review** in one visible instruction.
- Remove the now-unneeded non-draft override and automatic-review bot allowlist without changing unrelated `/review` behavior.

**Non-Goals:**

- No automatic ready transition, workflow approval, bot allowlist, or additional trigger.
- No bridge implementation in this repository.
- No change to gate logic or the readiness group card.

## Decisions

### D1. Restore draft creation and remove bot admission

Set `draft: true` explicitly in the archive Safe Outputs configuration and remove `on.bots` from `pr-review.md`. Remove the draft-incompatible `team-reviewers` Safe Output; GitHub CODEOWNERS requests `slax-lab/reader-core` when the human marks the PR ready. Regenerate both locks. Update contract tests to assert draft creation and the absence of the added bot allowlist from both review workflows.

Alternative considered: keep the allowlist and use `/review` after approval. Rejected because it requires understanding two non-equivalent operations and leaves an unnecessary trust expansion in automatic review.

### D2. Make the instruction explain the lifecycle before naming the button

The archive PR body and the bridge direct message will state, in this order:

1. The feature PR has merged.
2. The corresponding spec archive PR has been created automatically.
3. The author should inspect the archive and click **Ready for review** to start automatic review.
4. After review passes, the team reviews and merges it, completing the archive.

This explains why the action matters rather than relying on the reader to understand GitHub's draft terminology. The bridge updates its existing change and PR instead of adding a second notification concept.

### D3. Verify with the next real draft archive PR

Local tests cover source and compiled configuration plus the instruction text. Rollout evidence must show a real archive PR starts as a draft, the author receives one direct message, clicking **Ready for review** starts automatic review without Approve or `/review`, and the existing gate and readiness group card follow. These observations remain in `validation.md`, not archive-eligibility tasks.

## Risks / Trade-offs

- [The initial draft does not request the review team] → Expected; the team request follows the human ready-for-review transition, and rollout must verify it.
- [The author does not understand the draft state] → Explain the feature merge, automatic archive creation, and what the click starts before naming the button.
- [The author never clicks Ready for review] → The direct message names the required action; no automatic transition or merge is introduced.
- [The previous bot allowlist remains trusted unnecessarily] → Remove it in this change and assert its absence from both review workflow locks.
