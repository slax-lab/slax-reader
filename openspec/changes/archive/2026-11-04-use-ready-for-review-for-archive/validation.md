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

## Archive classification (2026-11-04)

The merge-triggered evaluation for source PR #496 reassessed the merged `dev` state and classified every task in `tasks.md`:

- **Tasks 1.1-1.3 and 2.1 — already checked, evidence unchanged.** The merged tree sets `draft: true` in the archive Safe Outputs block of `.github/workflows/openspec-archive.md`, contains no `on.bots` entry in `.github/workflows/pr-review.md`, and no compiled lock defines `GH_AW_ALLOWED_BOTS`. The archive PR-body prompt and `docs/CI.md` describe the feature merge, automatic archive creation, the author's **Ready for review** action, automatic review, and the final team review and merge, with no Approve or `/review` start choice. The command results recorded under "Local verification" cover these tasks.
- **Task 2.2 — completed, checked off with evidence.** PR #496 targeted `dev` with `OpenSpec: use-ready-for-review-for-archive` and a Test plan separating local verification from the declared live-rollout gap. Its body records that the independent pre-push review found no Important findings. Human reviewer `boxcounter` merged it into `dev` at 2026-11-04T01:58:04Z, so the task's "do not merge it as an agent" condition holds.
- **No unchecked tasks.** `npx --yes @fission-ai/openspec@1.13.1 list --json` reported `5/5` tasks complete for this change before archiving. No historical acceptance gap remains unchecked.
- **No same-capability conflict.** Both delta capabilities (`openspec-change-archiving` and `agentic-pr-review`) were scanned across every other active change; none carries a delta for either capability and none declares an archive order against this change.
- **Rollout observation is not an archive-eligibility task.** Design D3 records the next real draft-archive observation as rollout evidence in this file rather than a task, so the pending "Pending rollout evidence" items do not block this archive.

## Archive outcome (2026-11-04)

- `npx --yes @fission-ai/openspec@1.13.1 archive use-ready-for-review-for-archive --yes` reported `Task status: ✓ Complete`, applied `agentic-pr-review: -1 removed` and `openspec-change-archiving: ~2 modified`, and archived the change as `2026-11-04-use-ready-for-review-for-archive`.
- Living spec updates: `agentic-pr-review` dropped "Automatic review admits the archive bot after human approval"; `openspec-change-archiving` updated "A valid archive produces one reviewed documentation pull request" (draft creation plus CODEOWNERS team request after the author's ready transition) and "Reviewer notification uses the existing readiness path" (draft archive body, human ready-for-review entry, final team merge).
- `npx --yes @fission-ai/openspec@1.13.1 validate --all --strict` passed with `Totals: 97 passed, 0 failed (97 items)`.
- `git add -A` staged the dated archive, the two living-spec updates, and this evidence; `git diff --cached --check` passed with no whitespace errors.

## Remaining review considerations

The "Pending rollout evidence" items above stay open and are not claimed as completed work. The first archive PR produced by the revised workflow must still show draft creation, the lifecycle instruction and `Archive source:` link in its body, exactly one start-review direct message to the feature PR author after the bridge change deploys, the human **Ready for review** transition starting automatic review without workflow approval or `/review`, the `slax-lab/reader-core` team request, and the existing gate, readiness label, and single group card. This archive PR is itself the first observation opportunity for the draft, body, and ready-transition fields; the bridge message, gate, and readiness observations depend on that run and remain for the human reviewers.
