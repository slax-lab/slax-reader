# Proposal

## Why

Approving workflows for a bot-created archive PR starts the automatic review but does not trigger the downstream readiness gate. Offering Approve and `/review` as equivalent choices is therefore misleading. A human-initiated ready-for-review transition already has the correct actor and has been proven to trigger review, the gate, and Feishu notification.

## What Changes

- Keep newly created archive PRs as drafts by setting `draft: true` explicitly; remove the `draft: false` override and the draft-incompatible Safe Outputs team-review request. GitHub CODEOWNERS requests the review team after the human ready-for-review transition.
- Remove the automatic PR Review bot allowlist; the ready-for-review transition is performed by a human, so no bot actor admission is needed.
- Tell the task PR author why the archive PR exists and what happens next: the feature PR has merged, the corresponding spec archive PR has been created automatically, and the author should inspect it and click **Ready for review** to start automatic review.
- Explain the remaining lifecycle in the same instruction: after automatic review passes, the team reviews and merges the archive PR, completing the archive.
- Remove Approve-versus-`/review` choices from the archive PR instructions and the separate bridge's start-review direct message.

## Resulting workflow

1. A merged feature PR automatically produces a draft archive PR and a direct message to its author.
2. The message explains that the feature work has merged and the archive PR is ready for the author's inspection.
3. The author clicks **Ready for review**, which starts automatic review without requiring bot approval or a slash command.
4. A passing review drives the existing gate and readiness notification.
5. The team performs the final human review and merges the archive PR.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-change-archiving`: archive PRs start as drafts and use the author's ready-for-review action to enter the existing review and readiness path.
- `agentic-pr-review`: remove the archive-bot actor allowlist because the review-triggering actor is the human performing the ready-for-review transition.

## Non-goals

- No bot allowlist, PAT, extra empty commit, or automatic draft-to-ready transition.
- No Approve-versus-`/review` choice and no change to `/review` for other PRs.
- No automatic approval or merge of archive PRs.
- No change to the existing readiness card or review-gate semantics.

## Impact

- `.github/workflows/openspec-archive.md`, `.github/workflows/pr-review.md`, and their generated locks.
- Workflow contract tests and `docs/CI.md`.
- The existing bridge change `notify-archive-review-start`, whose direct-message copy and requirements are updated separately before deployment.
