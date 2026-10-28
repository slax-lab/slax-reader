# Validation

Date: 2026-10-28. Branch: `feat/minimize-contract-release-checks`. Change: `enforce-expand-contract-release-safety`. Base: `dev` at `f217f465`.

## Scope and approval status

This revision contains **planning artifacts only**: `proposal.md`, `design.md`, the three delta specs, `tasks.md`, and this record. No implementation file, workflow, migration, or database was changed. The revised architecture has not been approved for implementation; every task in `tasks.md`, including the approval task and every implementation task, is unchecked pending the user's confirmation.

This revision replaces the multi-surface plan that pull request #421 carried and then removes the bounded first-parent history walk from the previous revision. The user's review established that the walk was unnecessary: the contract already declares `prerequisite-merge`, so the deployment record can be read directly.

## Final decision model

| Concern | Final model |
| --- | --- |
| Checkpoints | `promotion integrity` for a pull request whose base is `beta`; the API deploy preflight for every environment |
| Ordinary migrations | Existing code-owner review; no machine review lookup and no introducing-pull-request inference |
| Contract evidence | One `deployments?sha=<prerequisite-merge>` read; `api-deploy.yml` records for `beta` or `main`; deployment status, run conclusion, and `Migrate databases and deploy Workers` step must all be successful |
| Missing, failed, in-progress, ambiguous | Fail closed and name the human-review path: declare the deployed commit the pipeline recorded, or use the adjudicated runbook |
| Immutability | A release only adds migration files; no edit, delete, or rename; `migration_lock.toml` unchanged |
| Hotfix | `expand` only; `migrate` and `contract` ship through a normal release |
| Rollback and adjudication | Manual runbooks; no fourth declaration class and no pipeline bypass |

The check makes one deployments read per contract and never walks branch history, lists deployments by environment, waits for evidence to appear, or falls back to another commit.

## Commands and results

| Command | Result |
| --- | --- |
| `openspec validate enforce-expand-contract-release-safety --strict` | valid |
| `openspec validate --all --strict` | 79 passed, 0 failed |
| `git diff --cached --check` | no whitespace errors |

## Evidence grounded before writing

The direct lookup was checked against live repository data, read-only, before it was written:

| Observation | Source |
| --- | --- |
| Deployments record the merged pull request's head commit, not the merge commit. PR #416's merge commit `db8f456c` has `beta` deployment records only because it was the `dev` tip at promotion #419, while its own `dev` deployment is recorded against its head `34e14cf7`. | `git rev-list --parents`, `GET /repos/slax-lab/slax-reader/deployments?sha=<commit>` |
| One release records both an `api-deploy` and a `web-deploy` deployment for the same commit, so the rule filters by the linked run path. | For `db8f456c`: deployment `7378276506` links to run `40640597301` (`api-deploy.yml`), deployment `7378276538` links to run `40640597430` (`web-deploy.yml`) |
| The `Migrate databases and deploy Workers` step exists and can be read from the run's jobs. | `GET /repos/slax-lab/slax-reader/actions/runs/40640597301/jobs` and `.../runs/40289138123/jobs` each returned that step with `conclusion=success` |
| The declared commit can be read directly from the deployment record, so no history walk is needed. | `deployments?sha=<commit>` returns the API and web records for that exact commit |

## Declared gaps

- **No implementation exists.** This is a proposal revision; there is no code, workflow, or migration to exercise, and no runtime verification is possible or claimed. `docs/DEFINITION-OF-DONE.md` exempts documentation-scale work when the change states the exemption; this record states it.
- **No live release was executed.** No database, Cloudflare resource, GitHub deployment, or private configuration was touched. All live reads above were read-only GitHub API and local git reads.
- **The direct lookup and step check are not exercised in code.** The live reads confirm the record shape, the workflow path, and the step name; the grouping, newest-record, ambiguity, and missing-evidence behavior remain implementation tasks (tasks 2.4 and 5.2).
- **The declared-commit rule needs operator documentation.** A pull request's merge commit usually has no deployment of its own, so a contract author must declare the commit the deployment recorded. Tasks 4.1 and 4.2 add that rule to `REVIEW.md` and the release docs; until then a wrong declaration lands on the human-review path.
- **The runbooks do not exist yet.** The rollback and adjudication procedures are specified in the delta and are documentation tasks (task 4.1).
- **Branch suffix.** The repository requires a task branch suffix equal to the change-id. This worktree branch is `feat/minimize-contract-release-checks`; the delivery pull request must be cut from current `origin/dev` as `feat/enforce-expand-contract-release-safety`, or the branch renamed before the pull request opens (task 5.7).

## Review status

Awaiting the user's confirmation of this revised architecture. No implementation approval is recorded in `proposal.md` or `design.md`, and `tasks.md` has no completed item.
