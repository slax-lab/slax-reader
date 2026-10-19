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

Selected OpenSpec change: minimize-ci-scope. The workflow, scope policy, release implementation, tests, and documentation implement this approved change.

- Bugs: Checked complete PR coverage, shared consumers, conservative unknown shared packages, evidence/prose routing, no-op and failure conditions of the required configuration job, removed post-merge application runs, retained release builds, baseline ancestry/channel selection, candidate-tag exclusion, first-release input globs, and release retries. No unresolved Important findings.
- Security: Checked argument-array Git execution with validated revisions, NUL-delimited file handling, read-only CI permissions, lack of new secrets, description escaping, immutable artifact/source identity, and notes checksums plus recomputation before publication writes. Controlled fixtures verify tampering fails before HTTP operations. No unresolved Important findings.
- Compliance: Verified both new capability deltas and every completed task against implementation and executed evidence. Existing review policy/gate, CLI channel eligibility, immutable tag/archive behavior, deployment serialization, and Web icon prerequisites remain enforced. No unresolved Important findings.

## Practical boundaries

Application suites are conditional; lightweight detector jobs still appear for unrelated PRs and fetch complete Git history. Root manifests, workspace configuration, the shared lockfile, and unknown shared packages retain conservative application coverage. This does not claim test-level or lockfile dependency-graph impact analysis.

GitHub-hosted job execution and actual publication were not invoked during local implementation verification. Historical Release descriptions are not rewritten; automatic source ZIP/TAR downloads still represent the tagged monorepo. The implementation was initially left uncommitted for inspection.

## Pre-push checkpoint

Date: 2026-10-15. The human subsequently authorized committing, pushing the task branch, and opening a PR against dev. A fresh fetch confirmed origin/dev still points to the implementation baseline, with no integration changes required. The Bugs, Security, and Compliance review passes were repeated for the final diff under REVIEW.md, using OpenSpec change minimize-ci-scope; no unresolved Important findings were found.

The final full CLI tooling suite passed all 29 tests, including the additional notes guards and real dev/beta/stable archive consumers. The CI policy/workflow suite passed all 13 tests again. The earlier preflight, Mobile, design, icon, rulesync, and gh-aw results remain applicable because those implementation inputs have not changed since their recorded checks.

## PR integration and repeated-push cancellation

Date: 2026-10-15. Integrated dev commit 0a9e801, including merged PRs #240 and #241, into the task branch without rewriting the published task commit. Resolved the frontend/package conflicts by keeping independent PR-only checks and moving the newly added Extension publication fixtures into a scoped Node 24 tooling lane. Production deployment's main GitHub Environment selection and all actual release/deployment workflows match current dev exactly.

The previous hosted API failure was the root-command allowlist missing test:ci (1909 other tests passed). Added that command to the existing contract and ran its complete file: 8 passed. No API runtime source changed. The complete Extension tooling suite passed 18 tests; preflight passed 104 with the same 2 opt-in skips; the CI scope/workflow suite passed 15 tests. Strict OpenSpec validation passed all 45 items. git diff --check passed.

Cancellation fixtures evaluate successive heads/run IDs for the same PR and assert they share a group; separate PRs and workflows have distinct groups. All six read-only CI workflows enable cancel-in-progress. CLI/Extension publication and API/Web deployment retain non-canceling execution. AI review keeps its existing independent policy. No executing hosted runs were present during the metadata check, so no live runs were canceled manually.

Repeated the Bugs, Security, and Compliance pre-push passes on the final integrated diff: no unresolved Important findings. Verified Extension inputs and shared dispatcher/release helpers retain their fixture coverage, all selection outputs are wired, and publication workflows/credentials are unchanged. Addressed the earlier review Nits by correcting the icon registry scope, documenting deliberate action pins, and updating obsolete uncommitted-session wording. Existing CLI-release test evidence remains applicable because its implementation and fixtures are unchanged by this integration.

## Review coverage fixes

Date: 2026-10-16. The human authorized fixing the two Important findings from the follow-up review and updating PR #238 on its existing branch.

- Evidence-only Mobile CI now runs `apps/mobile/assets/verify-baseline.mjs` before the Mobile unit suite. The real ledger, its source identity, and referenced artifact hashes are checked without application bundling. The workflow regression test executes that exact validator against valid repository evidence, then overlays malformed ledger JSON, a stale source identity, and tampered referenced-artifact bytes in isolated child processes; all invalid cases fail. Repository evidence files are never modified by these tests.
- `apps/web/env.schema.ts` now selects `extensionTooling` because the Extension release fallback imports its Web schema directly. Policy and actual workflow-condition fixtures verify the Extension release lane runs while unrelated application suites stay unselected.
- Before the fixes, the new regression assertions failed on the missing schema consumer and missing real-ledger workflow step. After the fixes, `pnpm test:ci` passed all 17 tests. `pnpm test:extension-tooling` passed 18, `pnpm test:preflight` passed 104 with the same 2 opt-in skips, and Mobile evidence/source-replay/adoption-profile tests passed 24. The real baseline validator also passed independently (338 coverage cases, 11 captures, 7 comparisons). Strict OpenSpec validation passed all 45 items and `git diff --check` passed. Existing CLI tooling evidence remains applicable because its implementation and fixtures did not change.

Completed the local pre-push review under `REVIEW.md` against the full PR diff and this follow-up, using OpenSpec change `minimize-ci-scope`:

- Bugs: Verified evidence-only and mixed application/evidence routing, real validator failure propagation, Web-schema release consumers, complete-diff selection, stable required-status wiring, and unchanged release/deployment serialization. Both Important findings are resolved; no unresolved Important findings remain.
- Security: Verified read-only workflow permissions, argument-array subprocess execution, child-process input overlays with JSON-escaped literals, cleanup of temporary test files, and the absence of new credentials or publication operations. No Important findings.
- Compliance: Verified the implementation against both capability deltas, including the explicit real-evidence and cross-application schema scenarios, and all 20 completed tasks. No Important findings.

## Independent daily full validation

Date: 2026-10-16. The human requested the scheduled full-coverage follow-up described in [PR comment 6211394910](https://github.com/slax-lab/slax-reader/pull/238#issuecomment-6211394910). Integrated origin/dev at fb36b40 through merge commit 0afff18, resolving the Mobile workflow conflict by preserving this PR's complete-diff selection and evidence lane. The newly extracted reader-embed package retains conservative application coverage through the existing unknown-shared-package policy. No application implementation was authored for this follow-up, and package output/version metadata is unchanged relative to current dev.

Added Full CI at 04:23 Asia/Shanghai daily, with manual dispatch on dev. The source guard fails explicitly for another ref. All six reusable validation workflows receive a typed `full_validation: true`, skip selection entirely, and run their existing suites. Full Web/Mobile validation includes icon and real evidence checks without repeating their standalone lanes. All configuration guards run regardless of changed paths. Per-suite concurrency identities prevent a shared caller from canceling sibling suites; PR and full-run groups remain independent. Deployment, publication, AI review, and their serialization are unchanged.

| Check | Result |
| --- | --- |
| pnpm install --frozen-lockfile --offline | Passed after integrating dev |
| pnpm test:ci | 21 passed; includes all-false outputs and output-access rejection in full mode, skipped detection, explicit status-function routing, PR failure/cancellation, dev-ref guard execution, all six caller edges, configuration-step coverage, and shared-caller concurrency isolation |
| pnpm test:preflight | 104 passed; 2 existing opt-in runtime checks skipped |
| pnpm test:cli-tooling | 29 passed, including actual package consumers and controlled publication recovery |
| pnpm test:extension-tooling | 18 passed |
| actionlint v1.7.12 | All seven changed/new validation workflows passed; shellcheck integration disabled |
| pnpm exec openspec validate --all --strict | 47 passed, 0 failed |
| bash tooling/check-gh-aw-drift.sh | Full pinned compilation passed; generated outputs unchanged |
| git diff --check | Passed |

The local pre-push Bugs, Security, and Compliance passes under REVIEW.md were completed against the full PR diff relative to current dev and this follow-up, using OpenSpec change minimize-ci-scope. Bugs: verified independence from selection, skipped-needs execution, failure propagation, immutable caller revision defaults, inherited configuration behavior, scope coverage, and cancellation isolation. Security: verified contents-read permissions, no inherited secrets, safe ref interpolation through an environment variable, no publication/deployment calls, and no new credential inputs. Compliance: verified both capability deltas and all 23 completed tasks, including the explicitly adopted daily-validation scope. No unresolved Important findings remain.

The new schedule cannot run until its workflow is present on the default branch, currently dev. No manual hosted full run, deployment, or publication was started during local verification. GitHub schedules are best effort and can be delayed; the operations guide documents manual execution and the default-branch assumption.
