# Validation

Date: 2026-10-28. Branch: `feat/minimize-contract-release-checks`. Change: `enforce-expand-contract-release-safety`. Base: `dev` at `870d9bb6`.

## Scope and approval

The user approved this revision for implementation on 2026-10-28, as the continuation of the M43 revision. The approval is recorded in `proposal.md` and `design.md`, and implementation tasks 1.1 through 5.6 are complete. Task 5.7 (push, pull request, archive) remains unchecked as a delivery step.

This change implements the two-checkpoint design and the direct deployment lookup. It contains no SQL parser, statement whitelist, review or `CODEOWNERS` lookup, introducing-pull-request inference, branch-history walk, deployment listing, new runtime dependency, or executed DDL. No database, deployment, or remote resource was mutated.

## Final decision model

| Concern | Implemented rule |
| --- | --- |
| Checkpoints | `promotion integrity` for a pull request whose base is `beta`; the API deploy preflight after the superseded-release check and before any remote access |
| Ordinary migrations | Existing code-owner review; no machine review lookup |
| Contract evidence | One `deployments?sha=<prerequisite-merge>` read; `api-deploy.yml` records for `beta`/`main`; deployment status, run conclusion, and `Migrate databases and deploy Workers` step must all succeed |
| `prerequisite-merge` | The commit recorded by that deployment; the prerequisite pull request's `merge_commit_sha` must be its ancestor, and it must be an ancestor of the release head |
| Missing, failed, in-progress, ambiguous | Fail closed and name the human-review path |
| Immutability | A release only adds migration files; no edit, delete, rename, or retroactive header; `migration_lock.toml` unchanged |
| Hotfix | `expand` only |
| Rollback and adjudication | Manual runbooks in `REVIEW.md`; no fourth declaration class and no pipeline bypass |

## Files changed

- `tooling/migration-release-evidence.mjs` — declaration parser, release-diff assessment, prerequisite and direct deployment evidence, CLI.
- `tooling/migration-release-evidence.test.mjs` — 26 tests over synthetic git repositories and fixture API responses.
- `tooling/promotion-gate.mjs` — runs the migration stage for base `beta` only; wraps a checker failure with its stage.
- `tooling/promotion-gate.test.mjs` — asserts the stage is called for `beta`, skipped for `main`, and reports a failing check run.
- `tooling/ci-scope.mjs` and `tooling/ci-scope.test.mjs` — select API for the checker and migration files.
- `tooling/ci-workflow.test.mjs` — asserts the deploy preflight's position, permissions, history, and path filter.
- `.github/workflows/promotion-gate.yml` — full history, base/head fetch, `MIGRATION_*` inputs.
- `.github/workflows/api-deploy.yml` — full history, read scopes, preflight before the firewall, checker in the path filter.
- `package.json` — `test:ci` includes the new suite; `test:migration-evidence` local command.
- `REVIEW.md` — four real migration families, declaration procedure, contract evidence, hotfix rule, rollback confirmation, adjudicated runbook.
- `docs/CI.md`, `docs/BRANCHING.md`, `docs/api/DEVELOPMENT-DOCUMENT-EN.md` — checkpoints, direct lookup, failure behavior, operator rules.
- `.rulesync/rules/api-commands.md` and generated `apps/api/AGENTS.md` — declaration procedure for backend agents.
- `openspec/changes/enforce-expand-contract-release-safety/` — approval record, tasks, this validation record.

## Commands and results

| Command | Result |
| --- | --- |
| `node --test tooling/migration-release-evidence.test.mjs` | 26 passed, 0 failed |
| `pnpm test:ci` | 97 passed, 0 failed |
| `pnpm test:preflight` | 104 passed, 0 failed, 2 skipped |
| `pnpm exec openspec validate --all --strict` | 82 passed, 0 failed |
| `pnpm agent:check` | rulesync doctor, generate check, strict OpenSpec, and gh-aw drift all passed |
| `git diff --check` | no whitespace errors |

## Exercised scenarios

The checker suite drives real temporary git repositories and fixture GitHub responses; no network, database, or deployment was used.

- Declaration: all three classes; ordinary comments; CRLF; missing class; missing field; duplicate; unknown; inapplicable; bad shapes; `n/a` trailer.
- Diff: added migration; missing declaration; modified; deleted; renamed; `migration_lock.toml`; three-dot promotion diff with a target-only migration.
- Hotfix: `expand` passes; `migrate` fails.
- Prerequisite: not merged; merge commit not an ancestor; declared commit not an ancestor of the release head; trailer mismatch; `n/a` pair.
- Deployment: valid record; no record with the human-review path; `web-deploy`-only; `dev`-only; failed status; in-progress; failed step; failed run; newest-wins with an older failure; newest tie disagreement; both environments; `dev` deploy skips evidence.
- CLI: missing configuration fails closed; a deploy-mode release without contracts passes; a deploy-mode contract passes end to end.
- Output: an API error keeps the status code, never the raw body.

## Live evidence used to design the lookup

Read-only checks against the live repository on 2026-10-28:

- Deployments record the merged pull request's head commit, not the merge commit: PR #416's merge commit `db8f456c` has `beta` records only because it was the `dev` tip at promotion #419, while its own `dev` deployment is recorded against `34e14cf7`.
- One release records both an `api-deploy` and a `web-deploy` deployment for the same commit (`db8f456c`: deployments `7378276506`/`7378276538`).
- The `Migrate databases and deploy Workers` step is present and concluded `success` in runs `40640597301` and `40289138123`.

## Local pre-push review

The REVIEW.md passes were run against the diff:

- **Bugs.** One finding: the promotion workflow's base/head fetch would fail the job for a fork head before the gate could report its own failing check run, leaving the required context unreported. Resolved by tolerating the fetch failure and letting the gate reject the fork or the checker fail closed with a stage and message. No other defects found; the parser, diff, ancestry, grouping, and CLI paths are covered by the suite.
- **Security.** No secrets or private values are printed; API tokens stay in request headers; no new dependency; no remote mutation. A fixture test asserts an API error body never reaches the output.
- **Compliance.** The diff matches the approved change and its delta specs; every implementation task is implemented or explicitly deferred to delivery; no UI-visible change, so no hands-on acceptance applies; `docs/release/VERSIONING.md` excludes API and Web from package-version increments, so no version bump is required.

No Important findings remain.

## Declared gaps

- **No live release was executed.** The checkpoints were exercised against synthetic repositories and fixture API responses. No database, Cloudflare resource, GitHub deployment, or private configuration was touched.
- **The GitHub Actions integration is verified by workflow contract tests, not by a real promotion.** The first real use will be the first release after this merges; an `expand`-only migration is still the right first live test, not a real contract.
- **The deployment-record shape was verified read-only on 2026-10-28.** A future change to how `pull_request_target` records deployments would make the lookup fail closed; the human-review path is the recovery.
- **Branch suffix.** The worktree branch is `feat/minimize-contract-release-checks`; the delivery pull request must be cut from current `origin/dev` as `feat/enforce-expand-contract-release-safety`, or the branch renamed before opening (task 5.7).
- **Delivery is pending.** No push, pull request, or archive was performed; independent review and the delivery step remain for the tower.
