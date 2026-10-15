# Local verification

Date: 2026-10-14. Change: minimize-ci-scope. Branch: ci/minimize-ci-scope.

## Baseline and ownership

The worktree was fast-forwarded to dev commit 4ac85a3 before implementation. PR #231 was confirmed merged and its removal of native Mobile CI builds is preserved. This change does not edit Mobile source or that change's capability deltas. At the end of the initial implementation checkpoint, there were no task commits, staged implementation changes, pushes, or real publication operations.

## Executed checks

| Check | Result |
| --- | --- |
| pnpm install --frozen-lockfile --offline | Passed from the local dependency cache |
| pnpm test:ci | 13 tests passed; includes workflow conditions, complete diff selection, renames/deletions, more than 300 files, alternate PR bases, invalid revisions, and shallow-history rejection |
| pnpm test:preflight | 104 passed, 2 existing opt-in Web runtime tests skipped, 0 failed |
| pnpm test:cli-tooling | 28 passed in the full suite, including actual dev/beta/stable archive installation and execution |
| Final focused CLI notes/process tests | 10 passed after adding source/version guards and stronger notes-tampering fixtures; includes rehashed tampering rejection before HTTP writes |
| Mobile source-replay, native-evidence, adoption-profile tests | 24 passed |
| pnpm design:check | 33 design reference files validated |
| pnpm icons:test; pnpm icons:check | 17 tests passed; 54 registry entries validated |
| pnpm exec openspec validate --all --strict | 43 items passed, 0 failed |
| pnpm exec rulesync doctor --strict; pnpm exec rulesync generate --check | No problems; generated files up to date |
| gh aw compile --strict --purge --no-check-update | Pinned v0.88.7 compiled both workflows successfully; generated locks/actions metadata unchanged |
| git diff --check | Passed |

The complete CLI tooling run preceded the final extra notes test and source/version guard. The final focused notes/process run covers that changed logic and all three distribution channels. Commands ran locally on Node 22.22.3; the workflow retains CLI application compatibility jobs for Node 22.22.2/24.15.0 and runs CLI release-tooling checks on the release runtime, Node 24.15.0.

## Local review under REVIEW.md

Selected OpenSpec change: minimize-ci-scope. The uncommitted workflow, scope policy, release implementation, tests, and documentation implement this approved change.

- Bugs: Checked complete PR coverage, shared consumers, conservative unknown shared packages, evidence/prose routing, no-op and failure conditions of the required configuration job, removed post-merge application runs, retained release builds, baseline ancestry/channel selection, candidate-tag exclusion, first-release input globs, and release retries. No unresolved Important findings.
- Security: Checked argument-array Git execution with validated revisions, NUL-delimited file handling, read-only CI permissions, lack of new secrets, description escaping, immutable artifact/source identity, and notes checksums plus recomputation before publication writes. Controlled fixtures verify tampering fails before HTTP operations. No unresolved Important findings.
- Compliance: Verified both new capability deltas and every completed task against implementation and executed evidence. Existing review policy/gate, CLI channel eligibility, immutable tag/archive behavior, deployment serialization, and Web icon prerequisites remain enforced. No unresolved Important findings.

## Practical boundaries

Application suites are conditional; lightweight detector jobs still appear for unrelated PRs and fetch complete Git history. Root manifests, workspace configuration, the shared lockfile, and unknown shared packages retain conservative application coverage. This does not claim test-level or lockfile dependency-graph impact analysis.

GitHub-hosted job execution and actual publication were not invoked during local implementation verification. Historical Release descriptions are not rewritten; automatic source ZIP/TAR downloads still represent the tagged monorepo. The implementation was initially left uncommitted for inspection.

## Pre-push checkpoint

Date: 2026-10-15. The human subsequently authorized committing, pushing the task branch, and opening a PR against dev. A fresh fetch confirmed origin/dev still points to the implementation baseline, with no integration changes required. The Bugs, Security, and Compliance review passes were repeated for the final diff under REVIEW.md, using OpenSpec change minimize-ci-scope; no unresolved Important findings were found.

The final full CLI tooling suite passed all 29 tests, including the additional notes guards and real dev/beta/stable archive consumers. The CI policy/workflow suite passed all 13 tests again. The earlier preflight, Mobile, design, icon, rulesync, and gh-aw results remain applicable because those implementation inputs have not changed since their recorded checks.
