# Tasks

## 1. Recovery implementation

- [x] 1.1 Add regressions for serialized pre-splitting, editing/translation truncation, nested splitting, ordered references, overlap, singleton exhaustion and cached recovery; demonstrate missing behavior before the fix.
- [x] 1.2 Implement input-proportional output limits capped at 65,536 and deterministic request pre-splitting; retain existing top-level cache reuse and reserve each request's actual limit.
- [x] 1.3 Implement binary recovery and three bounded singleton tries with retryable exhaustion, successful-part reuse, lease/deadline guards and safe accounting; preserve terminal resource-boundary errors.
- [x] 1.4 Keep the integer-free polish schema, temperature 1.0, 120-second timeout and count-only diagnostics; verify schema recursion and output-cap scaling regressions.
- [x] 1.5 Verify rolling workers start later chunks despite a slow sibling, never exceed ten calls, stop new scheduling after failure and await in-flight work.
- [x] 1.6 Verify podcast short-repeat handling below 40 characters, same-cue and long-repeat rejection, shared-cue paragraph acceptance and unchanged YouTube defaults.
- [x] 1.7 Reconcile proposal, design and delta scenarios with the live diagnosis, including the five-to-ten concurrency update and chunk-stability contracts.
- [x] 1.8 Verify mixed-paragraph overlap-ID stripping, part-local quality gates, small-sample exemptions, hallucinated-cue rejection and isolated bad-part retry with sibling cache reuse.
- [x] 1.9 Verify one-pass targeted/fallback polish repair and all-chunk translation repair, distinct repair step names with cached workflow results, and persistent-failure cleanup.
- [x] 1.10 Verify podcast 万/亿 numeric equivalence and unchanged YouTube defaults.

- [x] 1.11 Reject within-section paragraph reversals, retain shared starts, and retry an empty first-part introduction locally, including targeted repair of legacy cached introductions.

## 2. Automated verification

- [x] 2.1 Regenerate backend artifacts through pnpm api -- gen:all and inspect generated drift.
  - Generation passed with no tracked drift; the later changes add no router, consumer, cron or DI registration.
- [x] 2.2 Run API tests, typecheck, lint, build, OpenSpec strict validation and diff checks on the chunk-stability revision; resolve the remaining runtime-source formatting lint errors and rerun lint.
  - Evidence (2026-11-03): full API tests 2,807 passed, 113 skipped (199 passed / 14 skipped files); typecheck, lint (0 errors, 344 existing warnings) and build exited 0; strict OpenSpec validation and git diff checks passed.
  - Two test-only timing assumptions surfaced under full-suite load: an unblocked rolling pool need not peak at exactly ten, and siblings must remain gated until the failing chunk exhausts its retries. Both tests were corrected; final focused and full runs passed without changing runtime sources.
  - Earlier passing evidence remains in `.local/podcast-final-*.log` and `.local/podcast-truncation-*.log`.
- [x] 2.3 Perform Bugs, Security and Compliance review and resolve Important findings before delivery.

- [x] 2.4 Rerun the full API suite and Worker type generation with the pinned toolchain and local socket access. The resumed 2026-11-04 checks supersede the earlier environment failures; see validation.md.

## 3. Real local acceptance

- [x] 3.1 Start the repaired local frontend and backend with supported operator-managed configuration and verify their health and local API routing.
- [x] 3.2 Save https://pca.st/8ueht2r9 through the real local application and observe actual capture, provider/model generation and article publication, without response fixtures.
- [x] 3.3 Verify readable full article content, ordered timing references and requested translation in the browser; record bookmark identity, status transitions, logs and any unverified parts in validation.md.

- [x] 3.4 Repeat real provider performance verification after the review fixes and record measured timings and quality. Original ready in 112.8 seconds and Chinese translation in 152.4 seconds; 22 normal model calls, no quality failures or backward references. Submit the verified revision in the task PR.

## 4. Post-merge archival

- [ ] 4.1 After the task PR merges, archive through a reviewed documentation PR in dependency order with the preceding podcast capability changes.
