# Validation

## Acceptance scope

Verify that archive PRs retain gh-aw's draft default, automatic review has no archive-bot allowlist, and the archive-body instruction explains the feature merge, automatic archive creation, **Ready for review**, automatic review, and final team merge. The next real archive PR must verify the human transition and downstream gate; this is rollout evidence, not an archive-eligibility task.

## Local verification

- `node --test tooling/openspec-archive-workflow.test.mjs`: before implementation, the new assertions failed for `draft: false`, the missing lifecycle instruction, and the bot allowlist. After implementation, all 7 tests passed.
- `node --test tooling/openspec-archive-workflow.test.mjs tooling/ci-workflow.test.mjs`: 20 tests passed, 0 failed.
- `pnpm test:ci`: 87 tests passed, 0 failed.
- `gh aw compile --strict --purge --no-check-update`: three workflows compiled. The existing conclusion-concurrency warning remains intentional.
- `pnpm agent:check`: rulesync checks, strict OpenSpec validation (98 items, 0 failed), and gh-aw drift passed.
- `git diff HEAD --check`: passed with no whitespace errors.
- The archive Safe Outputs source and compiled config explicitly set `draft: true`, while `team-reviewers` is absent to avoid the known draft-request 422. GitHub CODEOWNERS owns the team request after the human ready transition. Neither automatic nor on-demand review lock contains `GH_AW_ALLOWED_BOTS`; automatic review retains `ready_for_review`.
- `docs/CI.md` and the PR-body prompt describe the same human ready-for-review path without presenting Approve or `/review` as the archive's start choice.

## Live evidence and root cause

- Archive PR #485 showed that a human ready-for-review transition triggers automatic PR Review, the downstream gate, readiness labeling, and the Feishu group card.
- Archive PR #492 showed that approving a bot-created PR's workflows runs automatic review but does not trigger the downstream gate. Its run actor remained `github-actions[bot]`; the human approver appeared only as `triggering_actor`.
- The on-demand `/review` run on #492 had the human as actor and did trigger the gate. The new path avoids requiring users to understand these token and actor differences.

## Pending rollout evidence

After this task PR merges and bridge PR #73 deploys, inspect the next real archive PR for all of the following:

- It starts as a draft, links the merged feature PR, and explains the archive lifecycle in its body.
- The feature PR author receives exactly one direct message explaining that the feature PR merged, the archive PR was created automatically, and **Ready for review** starts automatic review.
- Clicking **Ready for review** starts automatic review without Approve workflows or `/review`, requests `slax-lab/reader-core`, and drives the existing gate.
- A passing review adds `ready-for-human-review` and sends one existing readiness group card.

No result for the revised workflow is claimed by the local checks above.

## Review

The independent pre-push review reported no Important findings. Follow-up corrections removed the draft-incompatible team-review Safe Output, named GitHub CODEOWNERS as the provider of the team request after the ready transition, pinned `draft: true` explicitly, and removed non-executable scenarios from the REMOVED delta. The focused, CI, OpenSpec, compile/drift, and whitespace checks above were rerun after those corrections.
