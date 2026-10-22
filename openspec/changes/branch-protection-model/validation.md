# Validation

## Verified (agent-executable, pre-merge)

- `pnpm test:ci` — 67/67 passing on the task branch tip: ci-scope, ci-workflow contract tests (six gate jobs, exact names, `if: always()` wiring), rulesets normalization/drift/apply fixtures, and promotion-gate fixtures (allowed/rejected sources, suite-gate assessment, beta deployment evidence chain, hotfix review adjudication, check-run reporting, fail-closed paths).
- `openspec validate --all --strict` — passing (also enforced by the pre-commit hook on every commit of this change).
- Independent per-mission reviews: all four implementation branches (suite CI gates, promotion integrity gate, ruleset drift detection, docs/agent rules) were reviewed by independent reviewers and merged with clean verdicts and a merge recommendation.
- The beta deployment evidence chain was verified against the live repository during implementation: the beta tip's deployments attach to the merged promotion pull request's head SHA, not to the merge commit, and the api-deploy/web-deploy runs behind them conclude successfully.

## Not verified (declared gaps, with reasons)

- The six gate contexts reporting on a real pull request: verifiable only once this change's own PR is open; confirmed there before merge.
- Live ruleset application and drift-check against GitHub: requires the human administrator to create `RULESETS_READ_TOKEN` and run `node tooling/rulesets.mjs apply` after merge (tasks 5.1–5.2). The `apply` path is fixture-tested; the live call is a human-authorized remote mutation by design.
- End-to-end gating behavior on GitHub (promotion PR shows `promotion integrity` gating, direct push to `beta` rejected, merge UI offers merge-commit only, first scheduled drift run clean): requires the workflows to exist on the default branch and the rulesets to be applied, so it is scheduled as task 5.3 immediately after merge and recorded here.
