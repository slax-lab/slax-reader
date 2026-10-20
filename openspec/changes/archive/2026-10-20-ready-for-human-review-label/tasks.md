# Tasks

## 1. Workflows

- [x] 1.1 `pr-review-gate.yml`: grant `issues: write` (label creation) and `pull-requests: write` (labels on a pull request); after posting the status, add `ready-for-human-review` for an open, non-draft pull request whose head lives in this repository and whose reported commit is the current head, and remove it otherwise. Verification: YAML parse, diff review, and the live permission probes recorded in `validation.md`; the live add/remove run is deferred to 2.2/2.3 because `workflow_run` workflows only run the default branch's definition.
- [x] 1.2 Add `.github/workflows/ready-for-review-label.yml` with `pull-requests: write`: remove the label on `synchronize`, `reopened`, `ready_for_review`, `converted_to_draft` and `closed`; ignore a missing label. Verification: YAML parse and the permission probes in `validation.md`; a push to a ready pull request removes the label (2.3).
- [x] 1.3 `docs/CI.md`: document the label contract and its non-effect on mergeability. Verification: review the rendered section.

## 2. Verification

- [x] 2.1 `pnpm exec openspec validate --all --strict` passes.
- [x] 2.2 `Real machine` A pull request whose gate passes carries the label after the gate reports success, and `slax-notify-bridge` announces the human review (bridge-side check `ready-label-review-announcement`). Verified 2026-10-20 on scratch PR #303: gate run 39411446555 added the label; the ready card (bridge message `om_x100b6240c0ba30accffe59cc680a0d5`) named and `@`-mentioned Whyjsee. The first live attempt exposed the missing `pull-requests: write` permission, fixed in #304.
- [x] 2.3 `Real machine` Pushing a commit to that pull request removes the label until the new head's gate passes. Verified 2026-10-20 on PR #303: push `f2acc20` dropped the label within 15 seconds; the new head's gate re-added it, and the bridge did not announce a second time.
- [x] 2.4 `Real machine` A gate failure removes the label (a pull request with an Important finding, or an on-demand `/review` that fails). Verified 2026-10-20 on PR #307: a cancelled on-demand run (39414147103) made the gate fail closed (run 39414328159, "Review did not start (pre_activation: cancelled)") and the label was removed. A pre-existing gate weakness then let an unrelated comment's declined run re-add it — recorded in `validation.md` as a known limitation and follow-up.
- [x] 2.5 `Real machine` Merging still depends only on the ruleset: a pull request with a passing gate can merge whether or not the label is present. Verified by inspecting the release-branches ruleset (`agent-config drift check` + `PR review gate` remain the only required contexts; the label is not one) and by merging #301/#304 with passing gates.

## 3. Review

- [x] 3.1 Run the local pre-push review defined in `REVIEW.md` (Bugs / Security / Compliance passes) and resolve Important findings before pushing. Verification: recorded in `validation.md`; the draft-labelling bug was found and fixed there.

## Status

Workflows, docs, validation trail and strict OpenSpec validation are complete (2026-10-20). Remaining: the real-machine checks 2.2–2.5, which become runnable after the workflows merge to `dev`; the bridge-side counterpart is tracked in `slax-lab/slax-notify-bridge`'s `docs/verification.md` (V15–V17).
