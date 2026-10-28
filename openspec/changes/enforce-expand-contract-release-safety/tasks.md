# Tasks

## 1. Approval and adoption

- [x] 1.1 Obtain explicit human approval of this revised release-evidence architecture; record the approval date and proposal revision in `proposal.md` and `design.md`. Verify by the recorded approval text naming this revision and by no implementation task starting before it.
- [ ] 1.2 Confirm the delivery branch is `feat/enforce-expand-contract-release-safety` cut from current `origin/dev` (rename the Tower branch if needed) and that this change directory contains only this change's artifacts; verify with `git rev-parse --abbrev-ref HEAD`, `git merge-base --is-ancestor origin/dev HEAD`, and `git diff --stat origin/dev...HEAD`. The branch is cut from current `origin/dev` and the change directory holds only this change; the Tower worktree branch still carries the generated name `feat/implement-migration-release-evidence` and is renamed by the tower before the pull request opens (`validation.md`, Declared gaps).
- [x] 1.3 Add the named-user API owner list for `/apps/api/prisma/**` to `.github/CODEOWNERS` and record the `dev` adoption commit in the checker; verify a fixture migration path resolves to at least two named user owners and that the adoption tree lists the expected migration files.

## 2. Evidence checker (`tooling/migration-release-evidence.mjs`)

- [x] 2.1 Implement the leading-header parser: one class line, required fields per class, documented shapes, duplicate/unknown/class-inapplicable fields rejected. Verify with unit tests over synthetic headers, and verify the module contains no SQL statement parsing.
- [x] 2.2 Enumerate the release diff from a Git range and from the promotion's versioned trees, and classify each migration path as added, deleted, renamed, or modified. Verify with fixtures for a merge-base diff, a promotion tree diff, and a deploy `HEAD^1` diff.
- [x] 2.3 Implement the current-migration rule: added paths absent from `main`, `beta`, and the pinned `dev` adoption tree require declarations; frozen paths reject new or changed headers. Verify with a dev-only file, a file on `main`, and a beta-only file.
- [x] 2.4 Implement immutability: reject deletion and rename of any migration path, reject modification of a path present on `main` or `beta`, and reject any change to `migration_lock.toml`. Verify each case and a lagging-branch negative case with fixtures.
- [x] 2.5 Implement named-owner approval: introducing commit, exactly one merged introducing pull request, `CODEOWNERS` from the base commit, named-user owners only, latest review state, and an `APPROVED` owner. Verify named, team-only, outsider, head-`CODEOWNERS`, dismissed-review, and ambiguous-provenance fixtures.
- [x] 2.6 Implement contract prerequisite evidence: merged prerequisite, `merge_commit_sha` equality, `OpenSpec:` trailer match with the `n/a` case, and ancestry in `main`, the release head, and both serving commits. Verify each failure and a valid contract with fixtures.
- [x] 2.7 Implement the deployment resolver: per-environment deployments, dedupe by commit, latest status, `.github/workflows/api-deploy.yml` filtering, the migration/publication step check, and freeze on a failed, cancelled, or in-progress newest run. Verify with fixture responses including a superseded run and duplicate deployments.
- [x] 2.8 Implement the adjudicated overlay and the hotfix rule: two named owners with `APPROVED` reviews, incident/backup/ledger-reconciliation fields, prerequisite evidence skipped, and `migrate`/`contract`/`adjudicated` rejected in a hotfix. Verify each case with fixtures.
- [x] 2.9 Emit fixed stage names (`declaration`, `ownership`, `prerequisite`, `immutability`, `evidence`) with public paths, pull-request numbers, and commit SHAs only. Verify a fixture API error response never leaks into output.

## 3. Surface integration

- [x] 3.1 Add the check to API pull-request CI with `contents`, `deployments`, `pull-requests`, and `actions` read permissions and full history or explicit base and adoption fetches; verify the workflow test asserts step order, permissions, and the release-diff range.
- [x] 3.2 Extend `tooling/promotion-gate.mjs` with the merge-base and recursive-tree diff, the truncated-tree fail-closed limit, and the migration release evidence verdict; verify the existing `promotion integrity` contract and read scopes are unchanged.
- [x] 3.3 Add the deploy preflight before the firewall step with `fetch-depth: 2`, the target-branch and `main`/`beta` fetches, `GH_TOKEN`, and `dev` skipping prerequisite and deployment evidence; verify the workflow test asserts the step position and that a failure leaves no firewall rule, Tunnel, migration, or publication.
- [x] 3.4 Add the local command and `test:ci` wiring, and select the API scope when the checker or a migration file changes; verify `pnpm test:ci` includes the new suite and `ci-scope` selects API for each touched path.
- [x] 3.5 Extend `tooling/ci-workflow.test.mjs` and `tooling/promotion-gate.test.mjs` to assert the new step order, permissions, checkout depths, `HEAD^1` diff, compare pagination, and hotfix rejection; verify the suites pass.

## 4. Documentation and review policy

- [x] 4.1 Correct `REVIEW.md`'s migration path to the four real families and add the declaration, named-owner approval, contract evidence, immutability, expand-only-hotfix, out-of-band-rollback redeploy, and adjudicated-overlay rules; verify the file names `pg_migrations`, `logs_migrations`, `d1_migrations`, and `d1_migrations/fulltext`.
- [x] 4.2 Update `docs/CI.md` and `docs/BRANCHING.md` with the three surfaces, required permissions and checkout depths, outage effects, hotfix and rollback policy, and the delivery branch suffix; verify each document states the same surfaces and failure behavior as the specs.
- [x] 4.3 Record the declaration procedure in the `.rulesync` source for backend agent guidance — generate, classify, annotate before the local apply, then regenerate — and run `pnpm agent:sync`; verify `pnpm agent:check` reports no drift.
- [x] 4.4 Add the same declaration procedure and the evidence limits to `docs/api/DEVELOPMENT-DOCUMENT-EN.md`; verify the examples show each class and state that `removes`, `preserves`, and `reason` are review claims.
- [x] 4.5 Confirm no API or Web package-version bump is required under `docs/release/VERSIONING.md`; verify the change touches release tooling, workflows, and documentation only.

## 5. Verification and delivery

- [x] 5.1 Add `tooling/migration-release-evidence.test.mjs` covering every fixture named in tasks 2.1–2.9; verify `node --test tooling/migration-release-evidence.test.mjs` passes with zero failures.
- [x] 5.2 Exercise the CLI against synthetic repositories and fixture API responses for each surface and failure path, opening no database, deployment, or remote resource; verify each verdict and record it in `validation.md`.
- [x] 5.3 Run `pnpm test:ci`, `pnpm test:preflight`, `pnpm exec openspec validate --all --strict`, and `pnpm agent:check`; verify all pass and record the results in `validation.md`.
- [x] 5.4 Confirm the diff contains no SQL parser, statement whitelist, object-name cross-check, replacement analysis, or executed DDL; verify with a diff review and a search for parsing helpers in the new module.
- [x] 5.5 Run the local pre-push review from `REVIEW.md` and resolve Important findings; verify the findings and resolutions are recorded in `validation.md`.
- [x] 5.6 Commit the complete implementation for independent review; verify no push or pull request happens before the review is clean and record any declared gap.
- [ ] 5.7 Open the task pull request with `OpenSpec: enforce-expand-contract-release-safety` after the review is clean; verify the required checks pass. After it merges, archive this change through a docs pull request and verify `openspec validate --all --strict` stays green.
