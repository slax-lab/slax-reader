# Validation

Date: 2026-10-28. Branch: `feat/simplify-migration-release-evidence`. Change: `enforce-expand-contract-release-safety`. Base: `dev` at `f217f465`.

## Scope and approval status

This revision contains **planning artifacts only**: `proposal.md`, `design.md`, the three delta specs, `tasks.md`, and this record. No implementation file, workflow, migration, or database was changed. The revised architecture has not been approved for implementation; every task in `tasks.md`, including the approval task and every implementation task, is unchecked pending the user's confirmation.

The previous revision on `feat/enforce-expand-contract-release-safety` (M38, abandoned) implemented a 2,341-line SQL-semantic verifier. That route is rejected and removed from this plan: no SQL parser, no statement whitelist, no object-name cross-check, no replacement-equivalence analysis, and no executed DDL. This change directory on this branch therefore contains only the simplified evidence model.

| Concern | Abandoned plan | This plan |
| --- | --- | --- |
| Class correctness | Inferred from parsed statements and an add-only whitelist | Claimed by the author and approved by a named API owner |
| `removes` / `preserves` | Machine-compared with parsed object names | Review context; presence and shape checked only |
| Immutability | Union of pinned `main`/`beta` adoption trees with per-ref blob maps | Live `main`/`beta` path checks plus one pinned `dev` adoption commit |
| Contract evidence | Prerequisite binding plus an elaborate superseded-run, partial-publish, and cleanup analysis | Prerequisite binding plus the latest successful `api-deploy.yml` deployment whose migration step ran |
| Verifier size | 2,341 lines plus 2,135 test lines | Header parsing, diff enumeration, and documented API reads |

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec openspec validate enforce-expand-contract-release-safety --strict` | valid |
| `pnpm exec openspec validate --all --strict` | 79 passed, 0 failed |
| `git diff --cached --check` | no whitespace errors |

## Evidence grounded before writing

The deployment resolver was designed against live repository data, not assumption:

| Observation | Source |
| --- | --- |
| Environment deployments carry `sha` = the deployed merge commit and `ref` = the pull request head branch | `GET /repos/slax-lab/slax-reader/deployments?environment=main` returned `sha=888a0a8a…`, `ref=beta` |
| The same run can create duplicate deployments for one commit | Two `main` deployments share `created_at=2026-10-26T07:58:45Z` |
| The deployment job exposes the migration and publication step, so a superseded run can be excluded | `GET /repos/slax-lab/slax-reader/actions/jobs/121459811064` returned `Migrate databases and deploy Workers` with `conclusion=success` |

## Declared gaps

- **No implementation exists.** This is a proposal revision; there is no code, workflow, or migration to exercise, and no runtime verification is possible or claimed. `docs/DEFINITION-OF-DONE.md` exempts documentation-scale work when the change states the exemption; this record states it.
- **No live release was executed.** No database, Cloudflare resource, GitHub deployment, or private configuration was touched.
- **The `dev` adoption commit is not recorded.** It is an implementation task (`tasks.md` 1.3); until then the checker has no adoption tree.
- **The named-user API owner list does not exist yet.** `/apps/api/**` currently names `@DGuang21` plus the `@slax-lab/reader-core` team; the ownership check and the two-owner adjudicated overlay require the small `/apps/api/prisma/**` list (`tasks.md` 1.3).
- **Branch suffix.** The repository requires a task branch suffix equal to the change-id. The current branch is `feat/simplify-migration-release-evidence`; the delivery pull request must use `feat/enforce-expand-contract-release-safety` (rename before the pull request opens).
- **Rollback visibility.** An out-of-band `wrangler rollback` cannot be observed by the checker. The policy is recorded in the design and belongs in `REVIEW.md`; it is human-enforced by design.

## Review status

Awaiting the user's confirmation of the revised architecture. No implementation approval is recorded in `proposal.md` or `design.md`, and `tasks.md` has no completed item.
