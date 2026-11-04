# Tasks

## 1. Failing contract

- [x] 1.1 Update `assertValidationTriggers` in `tooling/ci-workflow.test.mjs` to require `types: [opened, synchronize, reopened, ready_for_review]` while preserving `workflow_call`; run `node --test tooling/ci-workflow.test.mjs` and confirm the existing workflows fail the new assertion.

## 2. Workflow triggers

- [x] 2.1 Add the explicit four-activity pull-request trigger to `frontend-ci.yml`, `api-ci.yml`, `mobile-ci.yml`, `cli-ci.yml`, `tooling-ci.yml`, and `config-ci.yml`; rerun `node --test tooling/ci-workflow.test.mjs` and confirm it passes.
- [x] 2.2 Run `pnpm test:ci` and `pnpm agent:check`; confirm all workflow contracts, OpenSpec strict validation, and generated-file drift checks pass without changing generated outputs.

## 3. Real-event verification and delivery

- [x] 3.1 Record local commands and the #499 failure evidence in `openspec/changes/start-archive-ci-on-ready/validation.md`, then complete the Bugs, Security, and Compliance pre-push review in `REVIEW.md` with no unresolved Important findings.
- [ ] 3.2 Push the task branch and open a draft task pull request with `OpenSpec: start-archive-ci-on-ready`; confirm the initial draft state is visible before the lifecycle trial.
- [ ] 3.3 Ask the task author to click **Ready for review** once, without approving workflows or commenting `/review`; confirm that `ready_for_review` starts all six validation workflows and PR Review for the same head, record the run IDs and required gate results in `validation.md`, and deliver the verified pull request for human review and merge.
