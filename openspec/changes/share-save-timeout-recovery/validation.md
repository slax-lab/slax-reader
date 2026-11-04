# Validation

## Scope and acceptance

- Change: `share-save-timeout-recovery`, branch `fix/share-save-timeout-recovery`, isolated worktree `/Users/daguang/project/slax-reader-share-recovery`, based on `origin/dev@999dc2e5`. Other working trees are excluded.
- The owner approved implementation, version `1.0.28`, build `800`, and previous source-build bound `799`. This is source metadata, not store publication history.
- Final owner decision on 2026-11-04: this is request/recovery logic with no UI layout, asset, string, animation, or accessibility presentation change. Relevant automated unit/host tests plus bundle validation are the acceptance gate; no native build, device matrix, or manual UI acceptance is required. Commit, push, and a PR targeting dev are explicitly authorized after those checks pass. No merge or publication is authorized.

## Final-state verification

### API unit tests and types

`pnpm api -- test test/flow/addUrl/1-inputValidation.test.ts test/flow/addUrl/2-shortLinkResolve.test.ts test/domain/bookmarkReaderLookup.test.ts test/domain/bookmarkFork.test.ts --maxWorkers=2 --minWorkers=1`

- **124 tests passed across four files**, zero failed; 7.54 seconds.
- Includes authenticated controller routing, empty 204/404/no-store contract, unchanged legacy existence semantics, API-key scope exclusion, active-owner save predicates, URL normalization, Reader/PDF pending destinations, and optional Twitter resolution deadlines.
- Three real loopback provider fixtures stalled at headers, successful body, and error body; each aborted around the two-second receipt resolution budget.
- `pnpm api -- typecheck`: **passed**, including shared contracts.

### Swift and Kotlin share host tests

`node --test --test-concurrency=1 apps/mobile/native/share/tests/collector.test.cjs apps/mobile/native/share/tests/diagnostics.test.cjs apps/mobile/native/share/tests/writer.test.cjs apps/mobile/native/share/tests/preferences.test.cjs apps/mobile/native/share/tests/plugin.test.cjs apps/mobile/tests/share-native/sign-out.test.mjs apps/mobile/tests/share-native/page.test.mjs apps/mobile/tests/share-native/android-diagnostics.test.mjs apps/mobile/tests/share-native/android-transport.test.mjs apps/mobile/tests/build-version.test.cjs`

- **53 tests passed, zero failures/skips**, 122.60 seconds, on the final source after the Android route-fallback/cancellation corrections and removal of unused probe scaffolding.
- Swift exercises 29 controlled request scenarios. Kotlin executes 27 real OkHttp HTTP scenarios inside its host test and 37 persisted diagnostic scenarios inside its diagnostic host test. These nested scenarios are not added to the Node test count.
- Covered: 200/204 headers with stalled body, five-second total deadline despite partial traffic, one three-second receipt, 204-only recovered success, absent/invalid/rejected/stalled receipt, no create resubmission, same captured origin/auth, definitive HTTP errors with stalled error bodies, and cancellation before/during either phase or phase transition.
- Diagnostics retain the original create timeout/timing evidence, one terminal record, and redaction. Plugin source parity, sign-out refusal, Safari extraction, and version parsing passed.
- These are automated native-language host tests, not native UI/device acceptance.

### Bundle and generated metadata

- Final `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- bundle`: **passed**, iOS 2,063 modules and Android 2,059 modules; output `apps/mobile/dist`, 17.75 seconds. No JavaScript production source changed after this run.
- Manifest and generated iOS main/share, Android, and runtime metadata agree on `1.0.28 (800)`, previous source bound `799`. Generated share copies equal authoritative Swift source.
- Native metadata was produced through Expo and the existing share plugin. Unrelated CocoaPods/Firebase configuration changes were restored. No generated source was hand-edited.

## Earlier supporting checks

- Frozen-lockfile dependency installation passed; no dependency version changes.
- Full Mobile check passed **1,275 tests, zero failures/skips** before the final small Android corrections; the final focused 53-test run above covers those corrections.
- API generator completed through `pnpm api -- gen:all` using documented example configuration and synthetic generation-only DB values. Only the intended receipt registration changed. API lint passed with zero errors and 344 existing warnings.
- Earlier API focused run passed **172 tests**, including **48 real PostgreSQL integration tests** in disposable storage after applying existing migrations. The final 124-test run replaces the changed controller/domain unit evidence; database predicates did not change afterward.
- Existing native resource harness passed Kotlin and Swift checks using installed public toolchain/jar paths.

## Review

The independent Bugs, Security, and Compliance review and its final follow-up found **no unresolved Important issues**. Corrections verified in the final diff:

- Create retains OkHttp pre-send route fallback with a one-shot body and a total five-second deadline; receipt connection retries are disabled. No application-level create retry is added.
- Android sets `active = false` before cancelling to retain dismissal ownership.
- The unnecessary CLI API-key permission expansion was removed; final unit tests assert receipt access remains outside that API-key scope.
- Temporary probe files, incomplete runtime/UI fixture expansion, and unrelated Podfile/project churn were removed.

## Disclosed non-gating limitations

- Native Android/iOS builds and device exercises were stopped at the owner's direction. No personal device was targeted. No claim of native UI, all-OS, signing, or publication acceptance is made.
- iOS modern loader is enabled through a public availability-guarded API on iOS 18.4+; older systems retain deadline/receipt fallback, but header delivery behavior on iOS 16.4–18.3 was not device-tested. Temporary classic-loader probes on newer systems are not proof about unavailable older OS versions.
- The earlier full API run reported 2,941 passed / 74 skipped but exited 1 because Vitest's worker `onTaskUpdate` timed out. It is not claimed as a passing full suite. The earlier API build was interrupted (143).
- An unfinished expanded runtime fixture asserted 500 instead of 204. The retained log has no matching receipt-route server 500 stack; later owner/other-user/unauthenticated calls returned 204/404/401. The precise failing request cannot be established after fixture removal, so its cause remains unknown and it is not passing end-to-end evidence. This separate experiment is excluded from the owner-approved unit/bundle gate, not represented as resolved.
- Extra dual-address and simulator experiment harnesses were removed after unsuccessful/interrupted runs. The final retained suites were rerun successfully; no unsuccessful experiment is counted as a pass.

## Delivery boundary

Make the additive API receipt route available before distributed clients depend on it. A missing route gives bounded timeout feedback, not false success or an automatic create retry. The version/build increment can trigger the repository's existing EAS build/auto-submit workflow after a qualifying dev merge. Opening this PR does not merge, deploy, sign, upload, or publish the app.
