# Verification

OpenSpec: `update-expo-58`; current branch: `feat/update-expo-58`. Historical execution records retain the original task/worktree names.

The implementation-stage results and native limitations are maintained in [the SDK 58 upgrade status](../../../docs/mobile/sdk58-upgrade.md). It distinguishes baseline failures, host checks, generated project validation and actual native acceptance.

The implementation instruction on 2026-10-19 approved the presented proposal, including its named optional integrations. Those integrations remain behind the base build gate. The human subsequently approved source metadata `1.0.25 (774)`, previous bound `773`, for this delivery. That previous value is a source prior-build bound from the latest `origin/dev`, not independently verified store publication history. Native metadata regeneration/consistency verification is tracked separately from the earlier build results and does not authorize publication.

## App Intents JavaScript implementation

Stages 8.2 and 9.1–9.4 have JavaScript/domain and mounted-host implementations. Save URL actions use a durable bounded journal, explicit claim for unknown-owner invocations, API readiness and owner fencing, retry/discard, and ack-after-receipt handling. The 2026-10-20 human decision enables system discovery and donations by default for unset/new preferences while retaining explicit opt-outs. The runtime waits for preference hydration, authenticated admission and valid credentials; default/opt-out/admission regressions are authored but unexecuted. The enabled snapshot filters successful bookmarks before its 100-row query limit, then projects at most 100 titles, source hosts and owner-scoped opaque IDs; Spotlight IDs resolve through a local owner-scoped map and are re-validated against the admitted current inbox before routing. Donations follow successful user opens and are serialized with owner revocation. Deletion, opt-out and sign-out revocation failures remain retryable.

Earlier focused verification passed: 26 tests across `tests/system-actions/{save-url-controller,save-url-host,catalog-policy,system-surfaces,entry-router}.test.mjs`; `pnpm mobile -- typecheck` passed. Those tests predate the successful-status catalog fix and did not cover unsuccessful rows. No host/browser tests were rerun after that fix under the iOS Duo-only validation instruction. These results do not establish the updated catalogue eligibility path, a Siri/Shortcuts cold-process save or native Spotlight/donation acceptance. Keep task 9.2 open; stages 8.3 and 9.5 remain open for native verification.

## Final review corrections and metadata

Metadata-only regeneration and permitted version checks cover `1.0.25 (774)` for Android and iOS main/Share/widget Info.plists and widget Debug/Release build settings. The owned widget generator refreshes existing build configurations instead of leaving the template's previous extension build value. Main-target PBX placeholders are unchanged; the explicit main Info.plist remains authoritative. The last successful exact-Duo arm64 Debug build predates this metadata change and the final donation review correction.

The donation correction persists admission before native dispatch, consumes recovered ambiguous/legacy receipts without re-donating, and retains explicit native-rejection retries. It can lose an optional donation between admission and dispatch and does not report an ambiguous outcome as confirmed success. Added crash/storage/runtime replacement and widget-generation tests remain unexecuted under the current validation restriction; earlier focused results do not establish these final changes. Task 9.4 is reopened accordingly.

Scoped cleanup retains local copies of the arm64 build log, Duo Open list-selector screenshot and validation notes under `.local/evidence/mobile-sdk58-native/`; the task simulator, Metro and DerivedData have been removed. No store publication or complete native acceptance is implied.

The read-only local Bugs, Security and Compliance review is complete. Its donation-replay Important finding was resolved by the admission correction and statically rechecked; no Important findings remain. The current validation restriction leaves the added regression tests unexecuted. Final OpenSpec/diff checks and remote draft PR delivery remain separate steps.
