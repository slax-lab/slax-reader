# Validation

## Verified (agent-executable, pre-merge)

- `pnpm test:ci` — passing on the task branch tip: ci-scope, ci-workflow contract tests (six gate jobs, exact names, `if: always()` wiring, pinned action/Node versions), rulesets normalization/drift/apply fixtures, and promotion-gate fixtures (allowed/rejected sources, suite-gate assessment, beta deployment evidence chain including paths-filtered batches, hotfix review adjudication, check-run reporting, fail-closed paths).
- `openspec validate --all --strict` — passing (also enforced by the pre-commit hook on every commit of this change).
- Independent per-mission reviews: all four implementation branches (suite CI gates, promotion integrity gate, ruleset drift detection, docs/agent rules) were reviewed by independent reviewers and merged with clean verdicts and a merge recommendation.
- The six gate contexts on a real pull request: verified on this change's own PR (#350) — all six suite gate contexts reported and passed, with unselected suites green by design.
- The beta deployment evidence chain verified end-to-end against the live repository (re-confirmed during PR review triage): for merged PR #331 (head `7089a16`, merge commit `3a142df`), the beta deployments attach to the PR head SHA (`deployments?sha=7089a16…&environment=beta` returns two successful deployments; the merge commit returns none), and the deployment statuses' log URLs resolve to the `api-deploy`/`web-deploy` runs whose `head_sha` is the PR head SHA.

## Verified (post-merge, human-authorized application)

- Task 5.1: the `RULESETS_READ_TOKEN` Actions secret exists (`gh secret list`, created 2026-10-23; value never printed), and the drift workflow authenticated with it successfully (workflow_dispatch run [39887074845](https://github.com/slax-lab/slax-reader/actions/runs/39887074845), conclusion success).
- Task 5.2: `node tooling/rulesets.mjs apply` with admin `gh` auth created `release-beta` and `release-main` and updated `release-branches` (3 changed, 0 unchanged); `node tooling/rulesets.mjs check` then reported "No ruleset drift: 3 codified rulesets match slax-lab/slax-reader."
- Task 5.3:
  - Direct push probe to `beta` with the administrator's credentials: rejected (`GH013: Repository rule violations found for refs/heads/beta` — "Changes must be made through a pull request", "7 of 7 required status checks are expected"), confirming the admin bypass is `pull_request`-mode only. The probe was an empty commit (no tree change) and never landed.
  - Merge-method restriction: verified at the API level — the live `release-beta`/`release-main` pull_request rules carry `allowed_merge_methods: ["merge"]` while `release-branches` (dev) keeps all three. The human administrator's merge-UI observation on promotion PR #355 (dropdown offers merge-commit only) is recorded by them at merge time.
  - Promotion gating: promotion PR [#355](https://github.com/slax-lab/slax-reader/pull/355) (`dev` → `beta`) fired the promotion-gate workflow from the default branch on a base branch that has no copy of it — the bootstrap path the design identified — and the `promotion integrity` context reported and passed.
  - Found during this exercise: the automated review of #355 caught that the gate's workflow-runs lookup used the repo-relative workflow path, which the endpoint 404s (it accepts only a workflow id or file name); every `beta` → `main` promotion would have failed closed once deploy evidence was required. Confirmed against the live API (path → 404, file name → 47 runs), fixed in PR [#357](https://github.com/slax-lab/slax-reader/pull/357) with a fixture that rejects repo-path requests. The gate script runs from the default branch, so the fix took effect for all promotion pull requests the moment #357 merged to `dev`.
  - Drift detection: the post-application `ruleset-drift` run (dispatch above) reported no drift and opened no tracking issue; the daily scheduled run continues from there.

## Not verified (declared gaps, with reasons)

- The merge-UI observation for task 5.3 (the merge dropdown on promotion PR #355 offers merge-commit only) is made by the human administrator at merge time; the restriction itself is API-verified above.
- The hotfix path (review adjudication on a `hotfix/*` head, propagation requirement) is fixture-tested but has not been exercised live; exercising it requires a real hotfix, which is not worth simulating against production-adjacent branches.

## Superseded pre-merge gaps

The two entries below were the declared gaps at merge time; both are now closed by the post-merge evidence above.
