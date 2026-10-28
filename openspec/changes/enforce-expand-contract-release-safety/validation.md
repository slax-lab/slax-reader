# Validation

Date: 2026-10-28. Branch: `feat/implement-migration-release-evidence` (delivery branch to be renamed `feat/enforce-expand-contract-release-safety`). Change: `enforce-expand-contract-release-safety`. Base: `dev` at `f217f465`.

## Approval and scope

Alex Lee approved the revised release-evidence architecture on 2026-10-28, and implementation started from revision `4445d30b`, imported unchanged by cherry-pick. This record covers the implementation. The SQL-semantic route stays withdrawn: the verifier has no SQL parser, statement whitelist, object-name cross-check, or replacement analysis, and it executes no DDL. An automated test asserts the module contains no SQL statement keywords.

## What was implemented

| Area | Files |
| --- | --- |
| Verifier and its fixtures | `tooling/migration-release-evidence.mjs`, `tooling/migration-release-evidence.test.mjs` |
| Checking surfaces | `.github/workflows/api-ci.yml`, `.github/workflows/api-deploy.yml`, `tooling/promotion-gate.mjs` |
| Scoping and local command | `tooling/ci-scope.mjs`, `package.json` |
| Ownership | `.github/CODEOWNERS` |
| Policy and documentation | `REVIEW.md`, `docs/CI.md`, `docs/BRANCHING.md`, `.rulesync/rules/api-commands.md`, `apps/api/AGENTS.md` (generated), `docs/api/DEVELOPMENT-DOCUMENT-EN.md` |
| Change artifacts | `proposal.md`, `design.md`, the three delta specs, `tasks.md`, this record |

The `dev` adoption commit is pinned to `f217f465c736a6b80621f78111e80ef6e833f27a`, the `dev` tip the branch was cut from; `origin/dev` still equalled it at commit time and the range contains no migration change.

Four decisions were made during implementation and recorded in the artifacts:

- The promotion surface enumerates the diff from the merge base and two recursive tree listings, because the compare API's `files` array is capped at 300 entries without pagination. Live evidence below.
- A migration present only in the adoption tree is frozen rather than current, so its first promotion to `beta` or `main` is not blocked and needs no declaration. The `migration-release-safety` delta gained a scenario for it.
- A migration propagated from a hotfix back to `dev` is not a re-add failure; the re-add rule applies only when the target is `beta` or `main`.
- The dev deploy re-checks declarations and immutability but not ownership, matching `design.md` §6 and the `api-release-deployment` delta. The `migration-release-safety` dev-deploy scenario said ownership runs; it was corrected to the design's reading, since the introducing pull request already required it.

## Commands and results

| Command | Result |
| --- | --- |
| `node --test tooling/migration-release-evidence.test.mjs` | 39 passed, 0 failed |
| `pnpm test:ci` | 116 passed, 0 failed |
| `pnpm test:preflight` | 104 passed, 0 failed, 2 skipped (win32-only cases) |
| `pnpm exec openspec validate --all --strict` | 79 passed, 0 failed |
| `pnpm agent:check` | `rulesync doctor --strict` and `generate --check` clean; OpenSpec 79/79; compiled agentic workflows match their sources |

## CLI verdicts exercised

Synthetic repositories (temporary Git repositories, no network):

| Case | Verdict |
| --- | --- |
| `--surface deploy`, `dev`, declared `expand` migration | pass, 1 migration path, 1 current |
| `--surface deploy`, `dev`, undeclared migration | fail, `declaration` naming the path |
| `--surface deploy`, `dev`, deleted migration | fail, `immutability` |
| `--surface deploy`, `dev`, `origin/main` not fetched | fail, `evidence`: the main branch tree is not fetched |

Live repository (read-only GitHub API; no database, deployment, or private configuration touched):

| Case | Verdict |
| --- | --- |
| `--surface promotion --base beta --head <dev tip>` on the real 300+ file batch | pass, 3 migration paths, 0 current (all adoption-era, frozen) |
| `--surface deploy` for the merge that added `20261027040000_collection_owner_hard_delete` | pass, 1 migration path, 0 current (frozen adoption-era file) |

The first case is the one that rejected the compare-file design: the same batch returns 300 files from the compare API and would have failed a literal 300-file gate.

## Live evidence that changed the design

| Observation | Source |
| --- | --- |
| The compare API caps `files` at 300 entries and does not paginate; `page=2` returns a body without `files` | `GET /repos/slax-lab/slax-reader/compare/beta...dev?per_page=100&page=1` returned 300 files and 64 commits; `page=2` returned the same comparison without a `files` array |
| The recursive tree endpoint accepts a commit SHA and lists the tree completely | `GET /repos/slax-lab/slax-reader/git/trees/<dev>?recursive=1` returned 4,656 entries, `truncated: false`, 130 migration files |

`design.md` §6 records the consequence: one compare call for `merge_base_commit`, two recursive tree listings for path and blob identity, and a fail-closed truncated listing.

## Pre-push review (`REVIEW.md`)

Passes run: Bugs, Security, Compliance.

Important findings and resolutions:

1. The deploy preflight called the GitHub API with only `contents: read`, so a `contract` in a `beta` or `main` release would have failed on HTTP 403. Granted the four read scopes in `api-deploy.yml`.
2. The promotion diff relied on compare `files` pagination that does not exist, and the cap would have blocked every promotion larger than 300 files. Replaced with the merge-base tree diff.
3. An adoption-era migration still on its way to `beta` was treated as a re-added frozen file, which would have blocked the next real promotion. Added paths that exist only in the adoption tree are now frozen, not current.
4. A hotfix migration propagated from `main` to `dev` was a re-add immutability failure. The re-add rule now applies only to `beta` and `main` targets.
5. `git diff --name-status -z` rename parsing read the old and new paths in reverse order. Fixed and covered by a real-repository fixture.

No security finding: no secret is read, printed, or copied; every failure reports a fixed stage plus a public path, pull-request number, commit SHA, or branch name; the check mutates nothing remote and only performs read-only Git fetches.

## Machine facts versus owner judgment

| Checked by the machine | Left to the approving owner and reviewer |
| --- | --- |
| Declaration presence, class, and field shapes | Whether the class is honest |
| Named-user owner `APPROVED` on the introducing pull request | Whether the approver read the SQL |
| Added/deleted/renamed/modified migration paths | Whether the migration is safe for the data |
| Prerequisite merge SHA, trailer, and ancestry | Whether the prerequisite removed the last dependency |
| Latest successful `api-deploy` deployment per environment | Whether serving code matches that deployment |
| Hotfix class, adjudicated field set | Whether the incident justifies adjudication |
| Nothing about SQL semantics | `removes`, `preserves`, `reason`, rollback confirmation |

## Declared gaps

- **Branch name.** The Tower worktree branch is `feat/implement-migration-release-evidence`; it must become `feat/enforce-expand-contract-release-safety` before the pull request opens, which is why `tasks.md` 1.2 stays unchecked. The mission records the rename as a tower-side action.
- **No live release was executed.** No database, Cloudflare resource, or GitHub deployment was touched. The three surfaces are covered by workflow-shape tests and by the CLI over real Git data; their first real execution is the first release after merge.
- **Ownership, reviews, and the deployment resolver are fixture-tested only.** The live run exercised the tree diff and the adoption-tree lookup. Reviews, `CODEOWNERS` at the base commit, prerequisite ancestry, and the deployment resolver were exercised against synthetic API responses because no test pull request was opened.
- **The adoption commit can go stale** if a migration merges to `dev` between this branch's cut and its merge; such a file would be treated as current and need a declaration. Re-run `git rev-list --count f217f465..origin/dev -- apps/api/prisma` before merging and bump `adoptionCommit` to the then-current `dev` tip if it is nonzero.
- **Rollback visibility.** An out-of-band `wrangler rollback` is invisible to the check by design; `REVIEW.md` carries the reviewer's redeploy confirmation.
- **No package-version bump.** API and Web deployment do not use package-version increments (`docs/release/VERSIONING.md`).

## Review status

Committed for independent review. No push and no pull request until that review is clean.
