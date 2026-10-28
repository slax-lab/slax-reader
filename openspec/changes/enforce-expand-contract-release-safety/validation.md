# Validation

Date: 2026-10-28. Branch: `feat/minimize-contract-release-checks`. Change: `enforce-expand-contract-release-safety`. Base: `dev` at `f217f465`.

## Scope and approval status

This revision contains **planning artifacts only**: `proposal.md`, `design.md`, the three delta specs, `tasks.md`, and this record. No implementation file, workflow, migration, or database was changed. The revised architecture has not been approved for implementation; every task in `tasks.md`, including the approval task and every implementation task, is unchecked pending the user's confirmation.

This revision replaces the multi-surface plan that pull request #421 carried. That plan added a pull-request evidence gate, `CODEOWNERS` and review-API lookups, introducing-pull-request inference, a generic serving resolver, a pinned `dev` adoption tree, and an `adjudicated` declaration class. This revision keeps the declaration header and the immutability rule, and reduces the evidence chain to the two checkpoints and the existing promotion-gate deployment model.

| Concern | Previous revision (PR #421) | This revision |
| --- | --- | --- |
| Checkpoints | Pull-request CI, `promotion integrity`, deploy preflight | `dev` → `beta` promotion and deploy preflight |
| Ordinary migration approval | Review-API lookup with `CODEOWNERS` resolution and introducing-PR inference | Existing code-owner review; no machine lookup |
| Contract semantic confirmation | Machine-checked named-owner `APPROVED` review | `confirmed-by` field in the header; verified by the reviewer |
| Deployment evidence | Generic resolver listing deployments by environment, deduplicating, filtering by run path and migration step | Known head from the environment branch's merge history; deployment record for that exact commit |
| Immutability baseline | Live `main`/`beta` trees plus a pinned `dev` adoption commit | Existing files are never edited; no adoption commit |
| Emergency path | `adjudicated` declaration class in the pipeline | Manual adjudication runbook; no fourth class |

## Commands and results

| Command | Result |
| --- | --- |
| `openspec validate enforce-expand-contract-release-safety --strict` | valid |
| `openspec validate --all --strict` | 79 passed, 0 failed |
| `git diff --cached --check` | no whitespace errors |

## Evidence grounded before writing

The deployment-evidence design was checked against live repository data, read-only, before it was written:

| Observation | Source |
| --- | --- |
| A release records its deployment against the merged pull request's head commit, which is the merge commit's second parent. `beta` tip `a605355f` (PR #419 from `dev`) has second parent `db8f456c`, and the `beta` environment records a deployment for `db8f456c`. `main` tip `3c2536d2` (PR #391 from `beta`) has second parent `888a0a8a`, and the `main` environment records a deployment for `888a0a8a`. | `git rev-list --parents`, `GET /repos/slax-lab/slax-reader/deployments?sha=<commit>&environment=<beta\|main>` |
| One merged release records both an `api-deploy` and a `web-deploy` deployment for the same commit, so the rule filters by the linked run path. | For `db8f456c`: deployment `7378276506` links to run `40640597301` (`api-deploy.yml`), deployment `7378276538` links to run `40640597430` (`web-deploy.yml`) |
| The linked run carries the candidate commit and the workflow path, so a record can be tied to a successful API deployment. | `GET /repos/slax-lab/slax-reader/actions/runs/40289138123` returned `path=.github/workflows/api-deploy.yml`, `head_sha=888a0a8a…`, `conclusion=success` |
| Both current environment branches resolve on their newest merge, well inside the 50-merge bound. | The first-parent walk returned a successful `api-deploy` record after one merge commit on `beta` and on `main` |

## Declared gaps

- **No implementation exists.** This is a proposal revision; there is no code, workflow, or migration to exercise, and no runtime verification is possible or claimed. `docs/DEFINITION-OF-DONE.md` exempts documentation-scale work when the change states the exemption; this record states it.
- **No live release was executed.** No database, Cloudflare resource, GitHub deployment, or private configuration was touched. All live reads above were read-only GitHub API and local git reads.
- **The deployment walk has not been exercised in code.** The live check confirms the shape and the first-candidate case; the bounded walk, the failed-candidate rule, the paths-filtered skip, and the fixture behavior remain implementation tasks (tasks 2.4 and 5.2).
- **The runbooks do not exist yet.** The rollback and adjudication procedures are specified in the delta and are documentation tasks (task 4.1).
- **Branch suffix.** The repository requires a task branch suffix equal to the change-id. This worktree branch is `feat/minimize-contract-release-checks`; the delivery pull request must be cut from current `origin/dev` as `feat/enforce-expand-contract-release-safety`, or the branch renamed before the pull request opens (task 5.7).
- **The long-tail bound is unverified.** The 50-merge bound was chosen as a comfortable ceiling and is satisfied trivially by current history; a branch with many API-inert merges would fail closed by design and has no live example.

## Review status

Awaiting the user's confirmation of this revised architecture. No implementation approval is recorded in `proposal.md` or `design.md`, and `tasks.md` has no completed item.
