# Tasks

## 1. Approval and regressions

- [x] 1.1 Record approval of the revised proposal before implementation; verify the approved scope preserves splitting/hashes and uses the human-selected 7-day target with non-blocking historical warnings and mandatory current-resource validation.
- [x] 1.2 Add failing tag regressions for adapter-present/null-writer list/detail cases, REST identity preservation, and failed REST removal; demonstrate failures against the current implementation.
- [x] 1.3 Add release fixtures for paginated history, boundary predecessors, old canonical runtimes, missing/HTML resources, and legacy assets; demonstrate current deployment loses old dependencies and applies immutable caching to the mutable entry.

## 2. Worker asset inventory and cache policy

- [x] 2.1 Generate the current-only PowerSync dependency index from real Worker output without changing splitting, hashes, SDK versions, or generation constants; verify complete static/dynamic JS and WASM references, exclusion of unrelated Workers, and blocking validation for a missing/invalid current file or index.
- [x] 2.2 Implement boundary validation and the known legacy v4 inventory extraction, including nested WASM URLs; verify original bytes are used, JS is never executed, unsupported historical dependency expressions warn and continue, and no-index snapshots are not silently treated as empty.
- [x] 2.3 Generate revalidation headers for mutable PowerSync entries/index while preserving hashed-asset caching; verify actual Pages-compatible responses detach conflicting immutable values and retained paths remain statically served.

## 3. Retention and publication

- [x] 3.1 Select successful production snapshots within 7 days plus their boundary predecessor and canonical deployment, following all required API pages; verify old-but-active, repeated-runtime, failed-upload, and purge-failure cases with controlled timestamps, plus non-blocking historical listing/pagination failures with unknown coverage reported.
- [x] 3.2 Download and merge eligible original runtime dependencies at their original paths before publication; verify digests/types, deduplication/conflicts, current-file precedence, environment isolation, and continued publication with warnings when historical resources cannot be recovered; confirm invalid candidates never enter staging.
- [x] 3.3 Integrate the current index and merger with config-free staging, freshness checks, deployment confirmation, and existing purge; verify no old server/config files or private release metadata enter the publication, carry-forward files never enter the current-only index, and post-merge current-resource defects still block upload even after historical warnings.
- [x] 3.4 Verify that an approved revert/recovery revision uses the existing publication process and retention helper; demonstrate that it preserves the repaired index/header generation, recovers available newer dependencies, warns on historical gaps, and blocks current rollback-build defects without a separate rollback command or freshness bypass, and document that direct pointer rollback bypasses retention preparation.
- [x] 3.5 Emit CI warning annotations and a release-summary section with current/retained/expired counts/bytes, known gaps, unknown coverage, affected historical runtime/path when known, and safe failure categories; verify warnings alone do not fail publication, expiry follows replacement, and copying never renews eligibility.

## 4. Tags and startup diagnostics

- [x] 4.1 Fix BookmarkCell identity props using actual capability/data origin; verify a REST row keeps its valid identifier even with an injected adapter.
- [x] 4.2 Fix compact and article-detail tag transport selection; verify REST add/create/remove with null writers, REST-backed detail UUIDs, both supported REST identity forms, normal local writes, and rejection of local-only REST identities.
- [x] 4.3 Await REST removal success and preserve pending additions on failure; verify unsuccessful/no-result responses, retry, loading release, read-only restrictions, and no automatic REST replay after local writer failure.
- [x] 4.4 Correct terminal fallback diagnostics while preserving existing recovery decisions; verify attempted-mode/stop-reason evidence and unchanged timeout, cleanup, platform, database, and pending-write behavior.

## 5. Running verification and documentation

- [x] 5.1 Run A/B/C releases on one controlled origin with deferred old dependency loading, multiple tabs, suspend/resume, and pending mutations; record original-path byte verification and successful local operations in validation.md.
- [x] 5.2 Exercise retention expiry and managed rollback with controlled timestamps; record that recoverable old-but-active/boundary dependencies survive, expired carried files are not renewed, historical failures warn and continue (including no recoverable history), and current-resource defects prevent upload.
- [x] 5.3 Exercise startup failure with actual REST tag add/create/remove and failed HTTP responses; record correct identities and preserved UI state, plus normal local sync, Safari/mobile selection, Extension bridge, PDF, and anonymous startup smoke results or explicit agent-verification gaps.
- [ ] 5.4 Verify final entry/index/old/new dependency responses on an authorized non-production Pages deployment; record bootstrap coverage, effective headers after purge, payload/file-count growth, and cold/warm startup smoke evidence without increasing timeouts.
- [x] 5.5 Update docs/web/deployment.md with the best-effort 7-day target, snapshot access, legacy bootstrap, cache ownership, historical warning/current-error distinction, release-summary interpretation, managed rollback, and limits for old caches; verify instructions match the implemented release helper.

## 6. Acceptance and review

- [x] 6.1 Run focused tests, affected Web lint/typecheck/build and release-tooling checks, and openspec validate --all --strict; record commands and results in validation.md.
- [x] 6.2 Prepare the running tag-fallback scenario and required before/after evidence; obtain and record human hands-on acceptance before opening the task PR.
- [x] 6.3 Resolve and record the hosted Extension bridge version-impact decision before implementation commit/push/handoff; verify any approved metadata changes follow repository versioning rules.
- [x] 6.4 Complete the local Bugs/Security/Compliance review, resolve Important findings, and prepare one task PR to dev with OpenSpec: powersync-release-recovery and the verification trail; verify proposal approval and hands-on acceptance precede the PR.
- [ ] 6.5 After the task PR merges, classify every unchecked task and archive through a separate documentation PR; verify both living specs reflect the accepted deltas and strict OpenSpec validation passes.
