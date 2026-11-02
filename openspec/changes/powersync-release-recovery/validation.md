# Implementation validation

## Scope and approval

The human approved implementation on 2026-11-02: retain recoverable PowerSync Worker dependencies for seven days after replacement, correct mutable-entry caching, restore tag REST fallback, use a new worktree, and review the result. Implementation is on `fix/powersync-release-recovery`, based on `cfd51f552327edfc9d23dc00e4b1d088ec955fb3`, in the new `powersync-recovery-impl` worktree. No remote application deployment has been performed. The task pull request is prepared for `dev` after the recorded human acceptance and version decision.

## Automated checks

- Full dependency installation: `pnpm install --frozen-lockfile` passed. No dependency or lockfile changes.
- Baseline production-profile Web build passed with synthetic public localhost configuration. Baseline Web suite: 224 test files passed, one skipped; 2,559 tests passed, three skipped. A pre-existing happy-dom teardown `AbortError` was printed despite exit zero.
- Tag regressions first reproduced 13 failures (adapter present without writers, discarded REST identity, premature removal); diagnostic regressions reproduced four failures. Focused tests passed after the fixes; the final full Web suite passed 2,581 tests (224 files), with three tests and one file skipped.
- Release regression first reproduced an `ENOENT` for the old dependency in the original upload input. The new preparation path passes it.
- CI selection regression first failed because changing the shared asset generator did not select the Web build; the corrected selector passes all 12 scope tests.
- Final `SLAX_TEST_PAGES_BUILD=1 pnpm test:preflight`: 137 passed, zero skipped, zero failures. This includes actual-build publication/workerd checks and the additional review regressions.
- `pnpm test:ci`: 68 passed, zero failures.
- `pnpm --filter @apps/slax-reader-dweb typecheck`: passed with synthetic public configuration.
- Full Web lint was run. After fixing touched-file ordering, the final run reports 93 errors in 93 untouched files and 436 warnings. A machine comparison against the changed/untracked file set confirms zero errors in touched/new files. The remaining errors are existing import-order debt; no unrelated formatting sweep is included.
- `openspec validate --all --strict`: 94 passed, zero failures, after refreshing the base from `origin/dev`.

## Running Worker verification

`node apps/web/tests/fixtures/powersync-release/browser-check.mjs /tmp/powersync-baseline-assets` passed using Chromium, the actual production Worker and SQLite dependency bytes, and the installed PowerSync SDK. The fixture generates disposable release variants by adding a valid WASM custom section and JS comment, assigning new hashes, and updating the Worker references. It does not alter tracked application output or use a real user's database.

The local server changed A -> B -> C on one origin. A's SharedWorker started before replacement, while its SQLite JS/WASM requests remained deferred until C. Both old URLs then returned byte-identical A resources and SQLite initialized successfully. B's original resources also survived C. Real SQLite writes were visible in a second tab; freezing/resuming the first tab and closing/reopening database connections preserved both data and the pending CRUD queue. Startup made no request for the release index.

The same running HTTP fixture verified expiry with controlled dates: A/B assets carried inside C disappeared after their window, while C, active for nine days, remained eligible. Republishing A through the retention helper preserved newer B/C dependencies. Completely unavailable history produced unknown-coverage warnings and allowed a valid current runtime; deleting the current WASM failed preparation.

The graph contained 16 files, including four WASM engines and VFS/synchronization dependencies. The fixture added 2,341,288 bytes (two files) for A during B, and 4,682,576 bytes (four files) for A/B during C. Shared unchanged resources were deduplicated. These synthetic variant sizes are evidence of the reporting/merge behavior, not a prediction of every production release.

Installed Wrangler 4.127.0 Pages serving was exercised locally: mutable Worker/index responses had exactly `no-cache, max-age=0, must-revalidate`; ETag conditional requests returned 304 with that policy. An unrelated hashed JS response retained immutable caching and 304 validation. This verifies the real Pages-compatible server's header detachment, separately from the browser fixture's HTTP server.

## Running tag verification

The local-only fixture in `apps/web/tests/fixtures/powersync-recovery/` renders the real BookmarkTags/TagChip components with the real Web request client and synthetic HTTP endpoints. Both writer factories return null. The fixture has no production route and uses no account or external API.

The browser exercise verified compact list and article-detail REST add/create/remove, correct bookmark identity despite a detail UUID, preservation of pending selections/input on HTTP 500, preservation of associations on HTTP 500/no-result/401, deliberate retry, successful deletion's actual `data: null` envelope, local-only UUID protection, and read-only behavior. It checked light/dark/e-ink at 320/768/1200 px for both surfaces (18 combinations) without page errors. Screenshots are temporary at `/tmp/powersync-tag-fallback/` and are not committed.

The before screenshot uses the component from the task's HEAD base, rendered in the same fixture state. It reproduced the generic failure with zero HTTP writes; the after state successfully added existing and new tags. The human requester exercised the supplied list and detail scenarios and explicitly accepted them on 2026-11-02 in this task conversation: "Accepted after hands-on verification" (translated). No further adjustments were requested. Acceptance preceded any task PR.

## Known verification gaps and delivery checkpoints

- No authorized remote Pages environment or deployment credentials were supplied. Real Cloudflare deployment history, snapshot access/bootstrap for the incident, effective CDN headers after purge, and a remote non-production publication have not been exercised. No remote deployment was attempted. Local fixtures exercise the API/error boundaries and installed Pages server; they do not establish the organization's actual snapshot accessibility.
- The tag fixture verifies real HTTP requests against synthetic responses. Authenticated production/backend integration and server-side authorization are not re-certified by this task.
- Chromium desktop SharedWorker/SQLite is exercised. Real Safari/iOS, the Extension offscreen iframe, PDF rendering, and real synchronization uploads were not manually exercised. Existing automated platform/public-startup tests and unchanged Worker/database/data-version constants are regression evidence, not device verification.
- Cold/warm startup is exercised for success, not benchmarked under controlled network/device conditions. No timeout changes are made.
- Expired snapshot counts are available; expired file/byte totals are explicitly unknown because expired snapshots are not downloaded solely for accounting. Current/added historical counts and bytes are exact.
- The human explicitly chose to keep Extension 1.16.3 on 2026-11-02 after clarification of the hosted-bridge scope. No Extension manifest change is needed. Human UI hands-on acceptance was completed before commit/push/PR on the same date.
- Archive remains a separate documentation PR after the task PR merges; unchecked work must be classified first.

## Final review and verification

- Final production-profile build passed. Inspecting the actual output, rather than relying on exit status, caught that Nuxt 4.5.2 no longer forwards `nitro:compiled`. The corrected `nitro:init` registration attaches directly to Nitro's `compiled` hook after Pages preset generation. The final dependency index validates 16 files / 7,782,652 bytes / four WASM files. Every Worker-graph file is byte-identical to the baseline, confirming splitting and payloads are preserved.
- `SLAX_TEST_PAGES_BUILD=1 node --test tooling/web-pages-deploy.test.mjs`: 35 passed, no skips, including staging the actual Nuxt output and rendering its precompiled modules through installed workerd.
- The Worker browser fixture was rerun against the final `apps/web/dist` output after the retention review fix; all release, expiry, rollback, data-preservation and failure-boundary cases passed.
- Independent release Bugs/Security/Compliance review found one Important issue: a historical index could include an unreferenced application chunk and report full coverage. A new regression failed before the fix. Recovery now retains only the traversed graph, warns on unreachable indexed files, and marks the snapshot partial. HTML/digest/conflict fixtures were corrected to make their roots reference the tested resources. All 16 retention tests pass, and independent re-review confirmed the finding closed, including missing-root and missing-intermediate cases. No additional Important release findings remain.
- Independent tag/recovery review found an Important REST contract issue: existing tags were sent with only `id`, while the real backend requires the original `name` for its tag upsert. The previous fixture accepted that incomplete payload. The fix uses `SetBookmarkTagsRequest` and sends catalog `id` plus raw `name`; a regression with a different `show_name` failed before the fix and passes afterward. The real HTTP fixture now rejects id-only requests with 400 and resolves tags by raw name. All 60 tag unit tests and the updated browser flow passed. Independent re-review closed the finding and found no additional Important Bugs/Security/Compliance issues.
- A receiving-boundary regression also confirms malformed historical `stages` data warns and reports unknown coverage instead of silently claiming complete coverage. Valid missing/empty/successful stage arrays still work.
- Human hands-on acceptance was requested with both running fixture URLs. The Extension version decision (currently 1.16.3; recommendation: unchanged because only the hosted Web bridge changes) was requested separately under repository policy. The human accepted UI behavior on 2026-11-02. They asked whether the bridge impact means older Extensions would break; the agent clarified that communication contracts, SDK and database identities are unchanged and recommended retaining 1.16.3. The human then explicitly chose to retain Extension 1.16.3 on 2026-11-02. No version metadata is changed.
