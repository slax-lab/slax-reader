# Tasks

## 1. Per-suite CI gate jobs (design D1)

- [x] 1.1 Add a terminal gate job to `frontend-ci.yml` (`Web CI gate`, `Extension CI gate`), `api-ci.yml` (`API CI gate`), `mobile-ci.yml` (`Mobile CI gate`), `cli-ci.yml` (`CLI CI gate`), and `tooling-ci.yml` (`Tooling CI gate`): each `needs:` all jobs of its suite, uses `if: always()`, fails when any needed job failed, succeeds otherwise. Verify by opening the task PR and confirming all six gate contexts report on it, with unselected suites reporting success
- [x] 1.2 Extend `tooling/ci-workflow.test.mjs` with contract assertions that the six gate jobs exist with their exact names and `if: always()` wiring; verify `pnpm test:ci` passes

## 2. Promotion integrity check (design D2)

- [x] 2.1 Create `.github/workflows/promotion-gate.yml` (`on: pull_request_target` to `beta`/`main`, base-commit checkout, `Promotion gate runner` job) reporting the required `promotion integrity` check run on the head SHA: asserts the head ref is an allowed source for the base (`dev` or `hotfix/*` → `beta`; `beta` or `hotfix/*` → `main`), fails closed on unexpected shapes. Verify with workflow tests covering allowed and rejected source combinations
- [x] 2.2 Add head-validation assertions to the gate: the six suite gates completed successfully on the head SHA (via check-runs API), and for `beta`→`main` additionally the beta deployment evidence chain (merged PR head SHA → beta deployments → api-deploy/web-deploy conclusions). Verify with fixture-based tooling tests, including the hotfix-to-`main` path skipping deploy evidence but still requiring a non-author approving review
- [x] 2.3 Implement the hotfix review assertion in the gate (pull-requests API; approval must come from a non-author, self-approval rejected, API errors fail closed); verify fixture tests cover the approved / unapproved / author-self-approved / API-failure cases

## 3. Codified ruleset state and drift detection (design D4)

- [x] 3.1 Implement `tooling/rulesets.mjs` with `export` / `check` / `apply` modes and normalization (strip server-assigned ids/timestamps, canonical key order); verify `tooling/rulesets.test.mjs` fixtures cover normalization and drift diffs, and `pnpm test:ci` passes
- [x] 3.2 Author `.github/rulesets.expected.json` describing the desired end state: updated `release-branches` (dev: current rules + six suite gates added to required contexts) and the new `beta`/`main` rulesets per the spec delta (PR-only, deletion + non-fast-forward rejection, `allowed_merge_methods: ["merge"]`, required contexts per design D5, admin bypass in `pull_request` mode). Verify `node tooling/rulesets.mjs check` runs and reports the expected drift against the live state before application
- [x] 3.3 Create `.github/workflows/ruleset-drift.yml` (daily off-peak cron + `workflow_dispatch`) running `check` mode with `RULESETS_READ_TOKEN`, opening or updating a single tracking issue on drift or token failure. Verify with workflow tests for the issue-filing logic

## 4. Documentation and agent rules

- [x] 4.1 Update the branching/protection section in `.rulesync/` sources for the per-branch contracts, hotfix flow, and merge-method enforcement; run `pnpm agent:sync` and commit the regenerated files in the same commit; verify the `agent-config drift check` passes on the PR
- [x] 4.2 Update `docs/CI.md` (required contexts per branch, promotion integrity check, drift detection); verify the doc names the same context strings the workflows emit

## 5. Human-authorized application and verification (Definition of Done)

- [ ] 5.1 Human creates a fine-grained PAT with repository Administration read and stores it as the `RULESETS_READ_TOKEN` Actions secret; verify the secret exists (do not print it)
- [ ] 5.2 After the PR merges to `dev`, human runs `node tooling/rulesets.mjs apply` with admin `gh` auth; verify `node tooling/rulesets.mjs check` reports no drift
- [ ] 5.3 Exercise the protections and record everything in `openspec/changes/branch-protection-model/validation.md`: a test promotion PR `dev`→`beta` shows `promotion integrity` and gate contexts reporting and gating; a direct push attempt to `beta` is rejected (even for the admin, whose bypass is `pull_request`-mode); the GitHub merge UI on the test PR offers only merge-commit; the first scheduled `ruleset-drift` run reports no drift. Note what was not verified and why
- [x] 5.4 Run the local pre-push review defined in `REVIEW.md` (all three passes) before pushing; verify Important findings are resolved and the PR body carries `OpenSpec: branch-protection-model`
