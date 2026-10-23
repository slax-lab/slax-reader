# Validation

## Verified (agent-executable, pre-merge)

- `pnpm test:ci` — passing on the task branch tip: ci-scope, ci-workflow contract tests (six gate jobs, exact names, `if: always()` wiring, pinned action/Node versions), rulesets normalization/drift/apply fixtures, and promotion-gate fixtures (allowed/rejected sources, suite-gate assessment, beta deployment evidence chain including paths-filtered batches, hotfix review adjudication, check-run reporting, fail-closed paths).
- `openspec validate --all --strict` — passing (also enforced by the pre-commit hook on every commit of this change).
- Independent per-mission reviews: all four implementation branches (suite CI gates, promotion integrity gate, ruleset drift detection, docs/agent rules) were reviewed by independent reviewers and merged with clean verdicts and a merge recommendation.
- The six gate contexts on a real pull request: verified on this change's own PR (#350) — all six suite gate contexts reported and passed, with unselected suites green by design.
- The beta deployment evidence chain verified end-to-end against the live repository (re-confirmed during PR review triage): for merged PR #331 (head `7089a16`, merge commit `3a142df`), the beta deployments attach to the PR head SHA (`deployments?sha=7089a16…&environment=beta` returns two successful deployments; the merge commit returns none), and the deployment statuses' log URLs resolve to the `api-deploy`/`web-deploy` runs whose `head_sha` is the PR head SHA.

## Not verified (declared gaps, with reasons)

- Live ruleset application: requires the human administrator to create `RULESETS_READ_TOKEN` and run `node tooling/rulesets.mjs apply` after merge (tasks 5.1–5.2). The `apply` path is fixture-tested; the live mutation is a human-authorized remote operation by design. The pre-application half was executed during the pre-push review: `node tooling/rulesets.mjs check` against the live repository reported exactly the expected drift — `release-beta`/`release-main` missing, `release-branches` missing the six gate contexts, nothing unexpected (task 3.2's verify clause). Only the post-apply no-drift confirmation remains.
- End-to-end gating behavior on GitHub (promotion PR shows `promotion integrity` gating, direct push to `beta` rejected, merge UI offers merge-commit only, first scheduled drift run clean): requires the workflows to exist on the default branch and the rulesets to be applied, so it is scheduled as task 5.3 immediately after merge and recorded here.
