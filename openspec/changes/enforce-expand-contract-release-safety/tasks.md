# Tasks

## 1. Approval

- [x] 1.1 Obtain explicit human approval of this revised two-checkpoint release-evidence architecture; record the approval date and this revision in `proposal.md` and `design.md`. Verify by the recorded approval naming this revision and by no implementation task starting before it.

## 2. Evidence checker (`tooling/migration-release-evidence.mjs`)

- [x] 2.1 Implement the leading-header parser: one class line, required fields per class, documented shapes, duplicate/unknown/class-inapplicable fields rejected. Verify with unit tests over synthetic headers, and verify the module contains no SQL statement parsing and no `CODEOWNERS` or review lookup.
- [x] 2.2 Enumerate a release diff from a local git range and classify each migration path as added, deleted, renamed, or modified; implement the declaration rule for added paths and immutability for everything else, including `migration_lock.toml`. Verify with fixtures for an added, deleted, renamed, and modified path, and a lagging branch that lacks a file without a deletion.
- [x] 2.3 Implement contract prerequisite provenance: merged prerequisite, its merge commit as an ancestor of `prerequisite-merge`, the `OpenSpec:` trailer with the `n/a` case, and `prerequisite-merge` as an ancestor of the release head. Verify each failure and a valid contract with fixtures.
- [x] 2.4 Implement the direct deployment-record lookup: one `deployments?sha=<prerequisite-merge>` read, filter `api-deploy.yml` records for `beta` and `main`, group by environment with newest-wins, and require the deployment status, run conclusion, and `Migrate databases and deploy Workers` step conclusion to be successful. Verify fixtures for a successful record, a `web-deploy`-only record, a `dev`-only record, a failed step, an in-progress status, conflicting newest records, and a missing record with the human-review message.
- [x] 2.5 Implement the hotfix rule and fixed stage output (`declaration`, `immutability`, `hotfix`, `prerequisite`, `evidence`) with public paths, pull-request numbers, and commit SHAs only. Verify a fixture API error response never leaks into output.

## 3. Checkpoints

- [x] 3.1 Add the migration stage to `tooling/promotion-gate.mjs` for pull requests whose base is `beta`: fetch the base and the head, evaluate the promotion diff, and leave the `main` promotion path unchanged. Verify step order, read scopes, the ancestry check, and the unchanged `main` contract with the workflow tests.
- [x] 3.2 Add the deploy preflight before the firewall step, after the superseded-release check, with `fetch-depth: 2`, `deployments`, `actions`, and `pull-requests` read permission, and the `pull_request.head.ref` used for the hotfix rule; keep `dev` free of prerequisite and deployment evidence. Verify the preflight leaves no firewall rule, Tunnel, database contact, or publication on failure.
- [x] 3.3 Select the API scope when the checker or a migration file changes, add the local command and `test:ci` wiring, and extend `tooling/ci-scope.test.mjs` and `tooling/ci-workflow.test.mjs`. Verify `pnpm test:ci` includes the new suite and each touched path selects API.

## 4. Documentation and runbooks

- [x] 4.1 Correct `REVIEW.md`'s migration path to the four real families and add the declaration procedure, the contract `confirmed-by` confirmation, the expand-only hotfix rule, the out-of-band-rollback confirmation, and the adjudicated runbook. Verify the file names `pg_migrations`, `logs_migrations`, `d1_migrations`, and `d1_migrations/fulltext`.
- [x] 4.2 Update `docs/CI.md` and `docs/BRANCHING.md` with the two checkpoints, the direct deployment lookup and its read scopes, outage effects, the human-review path, the hotfix rule, and the delivery branch suffix. Verify each document states the same surfaces and failure behavior as the specs.
- [x] 4.3 Record the declaration procedure in the `.rulesync` source for backend agent guidance — generate, classify, annotate before the local apply, then regenerate — and run `pnpm agent:sync`; verify `pnpm agent:check` reports no drift.
- [x] 4.4 Add the same procedure and the evidence limits to `docs/api/DEVELOPMENT-DOCUMENT-EN.md`; verify the examples show each class and state that `removes`, `preserves`, `reason`, and `confirmed-by` are review claims.
- [x] 4.5 Confirm no API or Web package-version bump is required under `docs/release/VERSIONING.md`; verify the change touches release tooling, workflows, and documentation only.

## 5. Verification and delivery

- [x] 5.1 Add `tooling/migration-release-evidence.test.mjs` covering every fixture named in tasks 2.1–2.5; verify `node --test tooling/migration-release-evidence.test.mjs` passes with zero failures.
- [x] 5.2 Exercise the checker against synthetic repositories and fixture API responses for both checkpoints and each failure path, opening no database, deployment, or remote resource; verify each verdict and record it in `validation.md`.
- [x] 5.3 Run `pnpm test:ci`, `pnpm test:preflight`, `pnpm exec openspec validate --all --strict`, and `pnpm agent:check`; verify all pass and record the results in `validation.md`.
- [x] 5.4 Confirm the diff contains no SQL parser, statement whitelist, object-name cross-check, review lookup, `CODEOWNERS` read, introducing-pull-request inference, branch-history walk, deployment listing, or executed DDL; verify with a diff review and a search for parsing and review helpers in the new module.
- [x] 5.5 Run the local pre-push review from `REVIEW.md` and resolve Important findings; verify the findings and resolutions are recorded in `validation.md`.
- [x] 5.6 Commit the complete implementation for independent review; verify no push or pull request happens before the review is clean and record any declared gap.
- [ ] 5.7 Open the task pull request with `OpenSpec: enforce-expand-contract-release-safety` from a branch whose suffix matches the change-id; verify the required checks pass. After it merges, archive this change through a docs pull request and verify `openspec validate --all --strict` stays green.
