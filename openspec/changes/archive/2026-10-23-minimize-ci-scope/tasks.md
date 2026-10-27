# Tasks

## 1. Shared change selection

- [x] 1.1 Refresh from dev and reconcile the current state of PR #231 before editing Mobile CI; verify the task branch contains the expected baseline, preserve that PR's native-job ownership, and record the resulting job set.
- [x] 1.2 Implement the pure CI scope policy and its reasons under tooling; verify table-driven cases for every design-matrix row, shared consumers, mixed scopes, ordinary prose, evidence inputs, and conservative root manifests.
- [x] 1.3 Implement validated complete PR diff enumeration using the actual base/head; verify temporary-repository fixtures for promotion bases, earlier PR commits, additions/deletions/renames, spaces, more than 300 changed paths, unavailable revisions, and comparison failures.

## 2. Workflow routing and coverage

- [x] 2.1 Split Frontend CI into independently selected Web and Extension validation with applicable shared prerequisites; verify Web-only and Extension-only fixtures select the expected jobs and retain icon validation before accepted Web checks.
- [x] 2.2 Wire API, Mobile, and CLI workflows to the shared policy with internal gating and no PR path-filter truncation; verify Mobile deployment inputs do not select API, ordinary Mobile guides do not bundle/build, and both supported Node versions still validate CLI implementation changes.
- [x] 2.3 Add scoped root tooling validation and remove duplicated unconditional tooling execution from frontend and CLI matrix jobs; verify existing preflight, dispatcher, release, and deployment tests remain covered for their actual inputs, updating command-placement fixtures to test that coverage.
- [x] 2.4 Separate design-reference and Mobile evidence validation from unrelated application suites; verify consumed provenance/fixture inputs still fail their appropriate checks and pure prose avoids application compilation.
- [x] 2.5 Scope rulesync, OpenSpec, dependency installation, and gh-aw setup/compilation inside the existing agent-config guard; verify its exact required context always completes, no-op inputs avoid installation, detection/selected-operation failures fail, and selected gh-aw validation retains full pinned purge compilation and orphan detection.
- [x] 2.6 Remove duplicate post-merge application CI and add per-PR cancellation to read-only validation; verify workflow fixtures retain PR/promotion checks, CLI release detection, release/deployment build and artifact guards, and existing publication/review concurrency behavior.

## 3. CLI-scoped release descriptions

- [x] 3.1 Implement channel/ancestry-aware CLI baseline selection and deterministic scoped entries; verify fixture histories for same-channel precedence, first-preview stable fallback, first release, current-tag exclusion, unrelated tags, promotion merges, shared contracts, mixed commits, manifest-only changes, and incomplete history.
- [x] 3.2 Prepare release notes before publication and bind their source, baseline, and digest to transferred metadata; verify notes tampering or mismatched identities fail before writes and the Release POST uses an explicit body without generate_release_notes.
- [x] 3.3 Extend controlled release-process and retry fixtures; verify unrelated Web/Mobile work is absent, missing Releases receive prepared notes, existing descriptions remain unchanged during asset recovery, and archive bytes, npm recovery, channel permissions, and immutable tags preserve their existing checks.

## 4. Documentation and integration validation

- [x] 4.1 Document the actual CI scope matrix, lightweight detection-only runs, conservative dependency-file boundary, PR/post-merge split, and CLI notes/source-archive distinction; verify documentation matches the implemented routing and retry behavior.
- [x] 4.2 Run focused scope, workflow, tooling, and controlled CLI-release checks plus openspec validate --all --strict; verify selected coverage and negative cases pass without publishing public tags, Releases, or npm packages, and record any environment limitations explicitly.
- [x] 4.3 Run all three local REVIEW.md passes against the final diff using OpenSpec change minimize-ci-scope; resolve Important findings and record verification evidence before the authorized task-branch push.

## 5. PR integration and cancellation verification

- [x] 5.1 Integrate current dev without dropping Extension publication-fixture coverage; verify the Extension workflow, ZIP inspector, app inputs, and shared release helper select the dedicated tooling lane while publication remains non-canceling.
- [x] 5.2 Correct the API root-command contract for test:ci and validate cancellation isolation; verify the API contract and fixtures for successive heads, separate PRs, and separate workflows pass.
- [x] 5.3 Run affected validation and all three pre-push review passes; resolve integration conflicts, record the evidence, and prepare the update to PR #238 without publishing a release.

## 6. Review coverage fixes

- [x] 6.1 Restore real Mobile ledger and referenced-artifact validation in evidence-only CI; verify valid repository evidence passes and malformed ledgers, stale source identities, and tampered referenced artifacts fail without application bundling.
- [x] 6.2 Select Extension release tooling for its shared Web schema input; verify actual workflow routing, rerun affected checks and the three pre-push review passes, and prepare the update to PR #238.

## 7. Independent daily validation

- [x] 7.1 Integrate current dev and add a daily 04:23 Asia/Shanghai/manual full-validation caller on dev; reuse the six validation workflows without path selection, publication, or write permissions.
- [x] 7.2 Verify all-false/skipped-detector full coverage, configuration guards, PR detection failures, cancellation, dev-ref enforcement, and concurrency isolation under a shared caller.
- [x] 7.3 Update CI operations and verification evidence, run affected checks and strict OpenSpec validation, complete the three local review passes, and prepare the update to PR #238.
