# Tasks

## 1. Workflows

- [x] 1.1 `pr-review-gate.yml`: grant `issues: write`; after posting the status, add `ready-for-human-review` when the current head's status is a passing one and remove it when it is a failure; skip both when the reported commit is not the current head. Verification: YAML parse, diff review, and a real gate run that adds/removes the label.
- [x] 1.2 Add `.github/workflows/ready-for-review-label.yml`: remove the label on `synchronize`, `reopened`, `ready_for_review`, `converted_to_draft` and `closed`; ignore a missing label. Verification: YAML parse; a push to a ready pull request removes the label.
- [x] 1.3 `docs/CI.md`: document the label contract and its non-effect on mergeability. Verification: review the rendered section.

## 2. Verification

- [x] 2.1 `pnpm exec openspec validate --all --strict` passes.
- [ ] 2.2 `Real machine` A pull request whose gate passes carries the label after the gate reports success, and `slax-notify-bridge` announces the human review (bridge-side check `ready-label-review-announcement`).
- [ ] 2.3 `Real machine` Pushing a commit to that pull request removes the label until the new head's gate passes.
- [ ] 2.4 `Real machine` A gate failure removes the label (a pull request with an Important finding, or an on-demand `/review` that fails).
- [ ] 2.5 `Real machine` Merging still depends only on the ruleset: a pull request with a passing gate can merge whether or not the label is present.

## 3. Review

- [x] 3.1 Run the local pre-push review defined in `REVIEW.md` (Bugs / Security / Compliance passes) and resolve Important findings before pushing. Verification: recorded in `validation.md`; the draft-labelling bug was found and fixed there.

## Status

Workflows, docs, validation trail and strict OpenSpec validation are complete (2026-10-20). Remaining: the real-machine checks 2.2–2.5, which become runnable after the workflows merge to `dev`; the bridge-side counterpart is tracked in `slax-lab/slax-notify-bridge`'s `docs/verification.md` (V15–V17).
