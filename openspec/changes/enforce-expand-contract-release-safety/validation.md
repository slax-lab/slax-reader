# Validation

Date: 2026-10-28. Branch: `feat/minimize-contract-release-checks`. Change: `enforce-expand-contract-release-safety`. Base: `dev` at `870d9bb6`.

## Scope and approval

The user approved this revision for implementation on 2026-10-28, as the continuation of the M43 revision. The approval is recorded in `proposal.md` and `design.md`, and implementation tasks 1.1 through 5.6 are complete. Task 5.7 (push, pull request, archive) remains unchecked as a delivery step.

This change implements the two-checkpoint design and the direct deployment lookup. It contains no SQL parser, statement whitelist, review or `CODEOWNERS` lookup, introducing-pull-request inference, branch-history walk, deployment listing, new runtime dependency, or executed DDL. No database, deployment, or remote resource was mutated.

## Final decision model

| Concern | Implemented rule |
| --- | --- |
| Checkpoints | `promotion integrity` for a pull request whose base is `beta`; the API deploy preflight after the superseded-release check and before the Cloudflared download, private configuration access, firewall, or Tunnel |
| Ordinary migrations | Existing code-owner review; no machine review lookup |
| Contract evidence | One `deployments?sha=<prerequisite-merge>` read; records classified by linked workflow before grouping; only `api-deploy.yml` records for `beta`/`main`; deployment status, run conclusion, and exactly one successfully completed `Migrate databases and deploy Workers` step |
| `prerequisite-merge` | The commit recorded by that deployment; the prerequisite pull request's `merge_commit_sha` must be its ancestor, and it must be an ancestor of the release head |
| Missing, failed, in-progress, ambiguous | Fail closed and name the human-review path |
| Immutability | A release only adds migration files; no edit, delete, rename, or retroactive header; `migration_lock.toml` unchanged |
| Hotfix | `expand` only |
| Rollback and adjudication | Manual runbooks in `REVIEW.md`; no fourth declaration class and no pipeline bypass |

## Files changed

- `tooling/migration-release-evidence.mjs` — declaration parser, release-diff assessment, prerequisite evidence, workflow classification before newest selection, direct deployment evidence, CLI.
- `tooling/migration-release-evidence.test.mjs` — 31 tests over synthetic git repositories and fixture API responses.
- `tooling/promotion-gate.mjs` — runs the migration stage for base `beta` only; wraps a checker failure with its stage.
- `tooling/promotion-gate.test.mjs` — asserts the stage is called for `beta`, skipped for `main`, and reports a failing check run.
- `tooling/ci-scope.mjs` and `tooling/ci-scope.test.mjs` — select API for the checker and migration files.
- `tooling/ci-workflow.test.mjs` — asserts the deploy preflight's position before Cloudflared and private configuration, permissions, history, and path filter.
- `.github/workflows/promotion-gate.yml` — full history, base/head fetch, `MIGRATION_*` inputs.
- `.github/workflows/api-deploy.yml` — the superseded and migration checks immediately after checkout/setup-node, before `pnpm install`, Cloudflared, private configuration, firewall, or Tunnel; full history; read scopes; checker in the path filter.
- `package.json` — `test:ci` includes the new suite; `test:migration-evidence` local command.
- `REVIEW.md` — four real migration families, declaration procedure, contract evidence, hotfix rule, rollback confirmation, adjudicated runbook.
- `docs/CI.md`, `docs/BRANCHING.md`, `docs/api/DEVELOPMENT-DOCUMENT-EN.md` — checkpoints, direct lookup, failure behavior, operator rules, examples for all three classes.
- `.rulesync/rules/api-commands.md` and generated `apps/api/AGENTS.md` — declaration procedure for backend agents.
- `openspec/changes/enforce-expand-contract-release-safety/` — approval record, tasks, this validation record.

## Commands and results

| Command | Result |
| --- | --- |
| `node --test tooling/migration-release-evidence.test.mjs` | 31 passed, 0 failed |
| `pnpm test:ci` | 103 passed, 0 failed |
| `pnpm test:preflight` | 104 passed, 0 failed, 2 skipped |
| `pnpm exec openspec validate --all --strict` | 82 passed, 0 failed |
| `pnpm agent:check` | rulesync doctor, generate check, strict OpenSpec, and gh-aw drift all passed (exit 0) |
| `git diff --check` | no whitespace errors |

## Exercised scenarios

The checker suite drives real temporary git repositories and fixture GitHub responses; no network, database, or deployment was used.

- Declaration: all three classes; ordinary comments; CRLF; missing class; missing field; duplicate; unknown; inapplicable; bad shapes; `n/a` trailer.
- Diff: added migration; missing declaration; modified; deleted; renamed; `migration_lock.toml`; three-dot promotion diff with a target-only migration.
- Hotfix: `expand` passes; `migrate` fails.
- Prerequisite: not merged; merge commit not an ancestor; declared commit not an ancestor of the release head; trailer mismatch; `n/a` pair.
- Deployment: valid record; no record; `web-deploy`-only; `dev`-only; a newer Web record beside an older valid API record; a same-timestamp Web record; a newer failed API record over an older success; failed status; in-progress; failed run; failed step; duplicate migration steps (success+failure and success+success); newest-wins with an older failure; newest tie disagreement; both environments; `dev` deploy skips evidence.
- Guidance and output: every evidence-stage failure includes the human-review path; API errors keep the status code and never the raw body.
- CLI: missing configuration fails closed; a deploy-mode release without contracts passes; a deploy-mode contract passes end to end.

## Live evidence used to design the lookup

Read-only checks against the live repository on 2026-10-28:

- Deployments record the merged pull request's head commit, not the merge commit: PR #416's merge commit `db8f456c` has `beta` records only because it was the `dev` tip at promotion #419, while its own `dev` deployment is recorded against `34e14cf7`.
- One release records both an `api-deploy` and a `web-deploy` deployment for the same commit (`db8f456c`: deployments `7378276506`/`7378276538`).
- The `Migrate databases and deploy Workers` step is present and concluded `success` in runs `40640597301` and `40289138123`.

## Review round 1 findings and resolutions

The independent review of `4413f6ee` returned `p1-4items` / fix-then-merge. The updated commit addresses every item:

1. **Filter before newest selection.** Deployment records are now classified by their linked workflow before grouping; a `web-deploy` record is not evidence and cannot reject an older valid `api-deploy` record. Fixtures cover a newer Web record, a same-timestamp Web record, and a newer failed API record over an older success.
2. **Duplicate migration steps.** The checker collects every step named `Migrate databases and deploy Workers`, requires exactly one, and requires it to be `completed` with conclusion `success`. Adversarial fixtures cover success+failure and success+success duplicates.
3. **Remote-access ordering.** The superseded-release check and the migration preflight now run immediately after checkout and setup-node, before `pnpm install`, the Cloudflared download, and the private configuration/`CONFIG_REPO_TOKEN` access. The workflow contract test asserts that ordering and the later firewall/Tunnel ordering.
4. **Human-review path everywhere.** Every evidence-stage failure — failed/in-progress status, failed run, failed step, ambiguous newest records, unexpected API shape, API error, and missing records — appends the fixed human-review path and keeps the `evidence` stage without printing a raw body. Tests assert the guidance across those fixtures.
5. **Class examples.** `docs/api/DEVELOPMENT-DOCUMENT-EN.md` now shows `expand`, `migrate`, and `contract` examples.
6. **Full history documented.** `proposal.md`, `design.md`, and `tasks.md` now describe `fetch-depth: 0`, matching the delivered workflows and tests.
7. **Stale approval text removed.** `proposal.md` no longer says the diff is planning-only or that approval is missing.

## Local pre-push review

The REVIEW.md passes were re-run against the updated diff:

- **Bugs.** The round-1 mixed-record and duplicate-step defects are covered by new fixtures; no further defect found in the parser, diff, ancestry, classification, grouping, or CLI paths.
- **Security.** No secrets or private values are printed; API tokens stay in request headers; no new dependency; no remote mutation. Evidence-stage API errors are asserted not to leak the response body.
- **Compliance.** The diff matches the approved change and its delta specs; the workflow now performs the approved checkpoint before remote release access; verification evidence is recorded here. No UI-visible change, so no hands-on acceptance applies; `docs/release/VERSIONING.md` excludes API and Web from package-version increments, so no version bump is required.

No Important findings remain.

## Declared gaps

- **No live release was executed.** The checkpoints were exercised against synthetic repositories and fixture API responses. No database, Cloudflare resource, GitHub deployment, or private configuration was touched.
- **The GitHub Actions integration is verified by workflow contract tests, not by a real promotion.** The first real use will be the first release after this merges; an `expand`-only migration is still the right first live test, not a real contract.
- **The deployment-record shape was verified read-only on 2026-10-28.** A future change to how `pull_request_target` records deployments would make the lookup fail closed; the human-review path is the recovery.
- **Branch suffix.** The worktree branch is `feat/minimize-contract-release-checks`; the delivery pull request must be cut from current `origin/dev` as `feat/enforce-expand-contract-release-safety`, or the branch renamed before opening (task 5.7).
- **Delivery is pending.** No push, pull request, or archive was performed; independent re-review and the delivery step remain for the tower.
