# Tasks

## 1. Ruleset expectation and promotion gate

- [ ] 1.1 In `.github/rulesets.expected.json`, set `required_approving_review_count: 1` in the `pull_request` rule of `release-beta` and `release-main`, leaving every other parameter unchanged; verify with `node tooling/rulesets.mjs check`, which must report exactly that diff (review count 0 → 1 on both rulesets) and no other drift.
- [ ] 1.2 In `tooling/promotion-gate.mjs`, delete the review assertion: `ReviewApprovalRequired`, `reviewApprovers`, `reviewEvidence`, the hotfix call site in `runPromotionGate`, and the special-cased re-run guidance in the top-level catch; verify the remaining hotfix path still skips beta-deployment evidence while requiring green application CI gates.
- [ ] 1.3 Update `tooling/promotion-gate.test.mjs`: remove the review-assertion tests (approver folding, `ReviewApprovalRequired` failure, author self-approval rejection, API-failure fail-closed) and adjust the hotfix-path tests to the new behavior; verify with `node --test tooling/promotion-gate.test.mjs` green.

## 2. Review policy exemption

- [ ] 2.1 In `REVIEW.md`, add a compliance-pass clause exempting promotion pull requests (head `dev` → base `beta`, head `beta` → base `main`) and sync-back pull requests from the `OpenSpec:` line and Test plan evidence-trail requirements, stating that their content was reviewed in the constituent task pull requests, that the batch has no single change-id, and that body references to in-flight evidence on such pull requests are not contradictions; the clause must key on the head/base pair and explicitly NOT exempt `hotfix/*` pull requests; verify by reading the rendered section back and confirming the exemption scope matches design D3.

## 3. Documentation

- [ ] 3.1 Rewrite the hotfix-review and re-run-guidance passages in `.rulesync/rules/overview.md` for ruleset-enforced review on `beta`/`main`, then run `pnpm agent:sync` and commit the regenerated agent files in the same commit; verify `git status` is clean after the sync.
- [ ] 3.2 Update `docs/CI.md`'s promotion-integrity description: review enforcement now comes from the rulesets, the gate no longer checks reviews, and the re-run-after-approval guidance is gone; verify the file contains no remaining mention of gate-asserted hotfix review.

## 4. Validation and rollout

- [ ] 4.1 Run the local pre-push review from `REVIEW.md` on the full diff and resolve Important findings before pushing; verify the review's conclusion is recorded.
- [ ] 4.2 Open the pull request to `dev` with `OpenSpec: release-branch-review-policy` and a Test plan carrying the command outputs above; verify CI is green. (This pull request must merge after the `branch-protection-model` archive pull request.)
- [ ] 4.3 After merge, with human authorization: run `node tooling/rulesets.mjs apply` to raise the review requirement on the live `beta`/`main` rulesets, then `node tooling/rulesets.mjs check`; verify zero drift and record both outputs in `validation.md`.
