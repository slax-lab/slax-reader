# Validation

## Automated (2026-10-28)

| Check | Command | Result |
|---|---|---|
| Mobile check (architecture, assets, fixtures, typecheck, all tests) | `pnpm mobile -- check` | exit 0, 1207 passed, 0 failed (one earlier run timed out in the unrelated `tests/reader/pdf-browser.test.mjs` under build load; passes alone and on rerun) |
| Bundle | `pnpm mobile -- bundle` | exit 0, iOS and Android Hermes bundles |
| iOS app + share extension | `pnpm mobile -- prebuild --platform ios`, `pnpm mobile -- pods`, `pnpm mobile -- build:ios` | `** BUILD SUCCEEDED **`; generated `ios/SlaxShare/*.swift` identical to `native/share/ios/*.swift` |
| iOS extension sources | `xcrun -sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios16.4-simulator native/share/ios/*.swift` | no diagnostics |
| iOS share host tests | `node --test native/share/tests/*.cjs tests/share-plugin.test.cjs tests/share-native/{page,sign-out}.test.mjs` | pass, incl. real loopback URLSession scenarios (401/400/429/503/redirect/timeout/disconnect/cancel), filesystem quota, concurrent append, `0600`, 3-failure disable, oversized terminal record kept |
| Android share module | `./gradlew :slax-share:compileDebugKotlin`, `:app:compileDebugKotlin :app:processDebugMainManifest` | pass; merged manifest contains `ACCESS_NETWORK_STATE` and `ShareActivity`; no new warnings |
| Android share tests | `node --test tests/share-native/android-diagnostics.test.mjs` + out-of-repo loopback harness running the verbatim request block | pass; route retry before body, no replay after body, HTTP/1.1, redirect refused, non-400 bodies not read, cancel in flight, diagnostics unavailable |
| Android assemble | `pnpm mobile -- build:android` | **not run to completion**: `:app:validateSigningDebug` needs `apps/mobile/android/app/debug.keystore`, which is absent in this worktree and was not copied (signing material) |
| Frequency | `tests/diagnostics/accounts.test.ts` | 24 h of simulated PowerSync 503 upload retries → 0 records; 24 h of refresh 503 retries → 1 record |
| OpenSpec / whitespace | `openspec validate --all --strict`, `git diff --check` | 84 passed; clean |

Independent read-only review (claude-opus-5.5): no Critical; five Important findings (Android route-retry parity, Android main-thread setup, refresh retry recording, JS sync I/O at startup, `tail4` rule) fixed and re-verified above.

## Native acceptance (pending)

- Pixel 9 Pro Fold (Android 17) was attached but locked for the whole session; no install was attempted.
- Pending on both platforms: Safari/Chrome share, text-only and "title + URL" sources, signed-out, offline, throttled network (phase durations), dismissal mid-request; records visible in the viewer and export; no token/full URL/title in output; unchanged messages, haptics and dismissal timing; unwritable diagnostic directory; Release cold-start comparison.
- Human hands-on acceptance of the diagnostic log screen (`DESIGN.md` §10.2): pending.

## Feedback attachment and About sharing follow-up (2026-10-29)

The follow-up runs in `.worktrees/mobile-diagnostic-log` on `feat/mobile-diagnostic-log`, preserving the existing uncommitted diagnostic implementation. The preceding results remain historical evidence, not verification of the new feedback and About flows.

### Current environment and initial checks

- `pnpm exec openspec validate --all --strict`: 84 passed, 0 failed after extending the change artifacts.
- `xcrun simctl list devices available --json`: the task-specific `Slax Diagnostics QA` iPhone 17 Pro simulator (`9AC6D3CD-62FB-4B84-8E47-8C29B9D7A948`, iOS 27.0) is booted. `simctl listapps` reports `app.slax.reader` installed; this alone does not identify or validate the new source revision.
- `adb devices -l`: Pixel 9 Pro Fold `4A141FDKD000AK` is connected. A filtered `dumpsys window policy` check reports `showing=true` and `inputRestricted=true`; no unlock, installation, or interaction was attempted.
- Simulator UI access is currently unavailable: both the normal `open -g -a Simulator` and explicit selected-Xcode Simulator path fail because the application is absent. Computer-use inspection reports no Simulator application; Xcode has no document window, and Device Hub provides no accessible content. A booted simulator is not proof of keyboard or native sharing behavior.
- No live notification-group message, production deployment, secret-file access, version change, human hands-on acceptance, or release approval is implied by these checks.

### Resumed native regression

- `xcrun -sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios16.4-simulator native/share/ios/*.swift` from `apps/mobile`: exit 0.
- `node --test native/share/tests/*.cjs tests/share-plugin.test.cjs tests/share-native/page.test.mjs tests/share-native/sign-out.test.mjs`: 15 passed, 0 failed before the additional Android host regression was added. All seven generated iOS share sources matched their native sources.
- `pnpm mobile -- test:native-resources`: the bare command failed because `SLAX_OKHTTP_CLASSPATH` was absent. Rerunning with the documented compiler/resource classpaths resolved from installed Gradle-cache jars passed the production Kotlin and Swift resource hosts. Dependencies used were Kotlin 2.1.20, OkHttp 4.9.2, Okio 2.8.0, and the cached compiler support jars; this is host execution, not native device acceptance.
- `pnpm mobile -- build:android`: failed at `:app:validateSigningDebug` because `apps/mobile/android/app/debug.keystore` is absent. No APK was produced, no signing material was read/copied/generated, and signing was not bypassed. `:slax-share:compileDebugKotlin`, `:app:compileDebugKotlin`, and `:app:processDebugMainManifest` passed; the merged manifest contains the share activity and network-state permission.
- Independent native Bugs/Security review found one Important issue: unbounded Android URL/referrer metadata could exceed the line cap and silently drop `share.end`. The fix validates metadata at the record boundary and preserves terminal fields through a compact fallback. The reviewer reread the fix and reported the finding resolved with no new Important issue.
- Post-fix `node --test apps/mobile/tests/share-native/*.test.mjs`: 8 passed, 0 failed, 0 skipped, including an executable Kotlin host suite with 37 persisted-writer scenarios (both referrer sources, malformed/oversized hosts, IPv4/IPv6, bounded output, privacy, deduplication, and terminal outcomes). Post-fix `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 ./gradlew :slax-share:compileDebugKotlin --console=plain` from `apps/mobile/android`: BUILD SUCCESSFUL.
- Release share scenarios, real keyboard/destination-file checks, timing under throttled networks, and human hands-on acceptance remain open. Host test success does not complete tasks 1.3, 1.4, 2.1, 2.2, 5.1, 5.2, or 5.7.

### Mobile feedback and About implementation checks

- Focused diagnostics/API-session suites: 95 passed, zero skipped. Coverage includes local-day/DST selection, fresh snapshot-only exports, historical-record sanitization, active-file cleanup leases, JSON/multipart contracts, account/origin changes, cancellation, retry without implicit fallback, and About actual-file adapter behavior.
- `pnpm mobile -- check`: 1,238 tests passed, zero failures/skips; architecture, fixture, asset and TypeScript checks passed. An intermediate Kotlin compiler timeout passed on unchanged isolated retry and the subsequent full run.
- `pnpm mobile -- bundle`: passed for both iOS and Android; output retained in `apps/mobile/dist`.
- The real loopback HTTP test `apps/mobile/tests/diagnostics/feedback-wire.test.mjs` received legacy JSON and a single consented multipart NDJSON file from the production mobile API transport. It verifies actual serialized sanitized bytes, but does not establish the complete Worker/R2/notification flow.
- Mounted tests exercise both locales/platforms and real production callbacks for keyboard dismissal, bounded form inputs, consent, failure retention, cancellation, and About sharing. They do not prove keyboard geometry on a device or a native destination receiving a file.
- `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- build:ios`: exit 0, `BUILD SUCCEEDED`, including embedded share-extension validation. Debug simulator artifact: `~/Library/Developer/Xcode/DerivedData/SlaxReader-diykvczqxvlyeccaammjkpmnrcsc/Build/Products/Debug-iphonesimulator/SlaxReader.app`. Build success alone is not native UI acceptance; no installation or launch of this artifact is claimed. The standard build includes its existing Crashlytics symbol-upload phase.
- `git diff --check -- apps/mobile`: passed. No app version metadata was changed for this follow-up.
- The user explicitly confirmed that About must retain both visible actions: open diagnostic logs and share the actual file. An erroneous review-driven removal was reversed; the navigation assertion was restored and the proposal/design/spec/task wording now preserves both actions. `node --test --test-name-pattern='About' apps/mobile/tests/diagnostics/feedback-host.test.mjs apps/mobile/tests/diagnostics/native-export.test.mjs`: 2 passed, 0 failed, 0 skipped after restoration. Strict change validation and whitespace checks passed.

### Backend implementation and running local HTTP verification

- `pnpm api -- gen:all`: passed using the public example configuration, synthetic loopback database URLs, `SLAX_API_SKIP_DOTENV=1`, and disabled dotenv loading; registration/types changed through generators only.
- `pnpm api -- typecheck`: passed. `pnpm api -- lint`: 0 errors, 344 existing warnings. `pnpm api -- build`: all four dry-run Worker bundles passed with the public example configuration.
- Focused backend/config regressions: 106 passed. Final generator regressions: 26 passed. `pnpm api -- test --maxWorkers=1`: 196 files passed, 2,605 tests passed, 112 conditional tests skipped. Default/two-worker attempts encountered subprocess/RPC timeouts under local contention; the unchanged isolated test and complete single-worker suite passed without weakening timeouts or excluding coverage.
- `pnpm api -- test:integration:local`: passed with disposable PostgreSQL migrations and integration suites.
- `pnpm api -- test:http`: passed through real local Edge/Core Workers, PostgreSQL and local R2. A captured Lark card contained the trusted capability URL; anonymous download returned the identical 149 sanitized bytes. The running fixture exercised consent/auth/forgery/expiry rejection, notification failure without duplicate reports, account deletion, report/object removal, and token-free logs. No real webhook or shared-environment storage was used.
- Backend logs remain in task-owned local files `/tmp/slax-diagnostic-http.log`, `/tmp/slax-diagnostic-integration.log`, `/tmp/slax-diagnostic-api-tests-single.log`, `/tmp/slax-diagnostic-build.log`, `/tmp/slax-diagnostic-lint.log`, and `/tmp/slax-diagnostic-gen.log`. Do not include capability tokens or actual configuration secrets in evidence.
- These results exercise mobile transport against a loopback receiver and the production backend through a separate HTTP client. A running native Mobile -> API -> R2 -> native destination end-to-end scenario is still unverified; task 5.8 remains open rather than combining separate evidence into an unsupported claim.
- Shared-environment rollout still requires an operator-created private `DIAGNOSTICS` bucket, separate `DIAGNOSTIC_DOWNLOAD_SECRET`, trusted API origin, seven-day object lifecycle, and audit of external access/tracing sinks. None was provisioned or deployed. See `docs/api/diagnostic-feedback.md`.

### Final restored-source checks and review closure

- Both visible About actions remain implemented and regression-tested. After restoration and the locale/timeout/safe-area repairs, focused diagnostics/session tests passed 99/99 with no skips; `pnpm mobile -- check` passed 1,242 tests with zero failures/skips and passed architecture/type checks; `pnpm mobile -- bundle` produced both platform bundles successfully. These final-source runs supersede the earlier interrupted verification and earlier 1,238-test result.
- Final bundle identities: iOS `index-9eba4c53294eed79e2ce4f3b993285db.hbc`; Android `index-2ed36582bbc76732aa403dd66fe7ddd4.hbc`, under `apps/mobile/dist/_expo/static/js/`. They are retained for subsequent acceptance; no final-source native UI run is claimed.
- Mobile Bugs/Security recheck found no Important issue. Locale replacement no longer aborts submissions, multipart uses the existing 120-second upload deadline, bottom safe-area padding applies on both platforms, and the Chinese owner-change message no longer falsely claims the feedback was not sent. The earlier Compliance objection to the visible About viewer was withdrawn after the user's explicit clarification.
- Independent Compliance review found no implementation-to-scope divergence. Human hands-on acceptance remains an unresolved pre-PR gate; no PR is being opened. The native scenarios, version decision, and complete native-Mobile-to-backend exercise stay unchecked.
- Final strict OpenSpec validation and `git diff --check` passed after the About requirement and completed backend task updates.

### Post-review backend correction and final verification

- Both Important backend findings were fixed and independently rechecked: bounded 4 KiB/64 KiB accumulation replaces cap-sized request/sanitizer preallocation, and account cleanup removes diagnostic R2 objects without deleting or modifying any feedback rows. The download link remains revoked through active-account checks. The trusted card link now precedes user-authored markdown.
- Focused post-fix tests: 78 passed, including exact-sized backing buffers, tiny/chunked input boundaries, preserved feedback records, and trusted-link ordering. `pnpm api -- typecheck`, `pnpm api -- lint`, safe `pnpm api -- gen:all`, public-template `pnpm api -- build`, and `git diff --check` passed.
- Final `pnpm api -- test --maxWorkers=1`: 196 files passed, 2,613 tests passed, 112 conditional tests skipped. This supersedes the earlier 2,605-test result.
- Final `pnpm api -- test:http`: passed after the deletion correction, verifying upload/download, expiry/forgery/auth rejection, notification failure, account revocation and R2 removal while all three ordinary/diagnostic report rows remained byte-for-byte unchanged. Earlier evidence saying reports were removed describes the pre-review implementation only and is superseded. Two attempts saw a Miniflare network-connection failure after an unauthorized multipart probe; moving that probe last retained its rejection coverage and added a check that it left preserved reports unchanged.
- Final backend logs: `/tmp/slax-diagnostic-review-full.log`, `/tmp/slax-diagnostic-review-http-final.log`, `/tmp/slax-diagnostic-review-lint.log`, `/tmp/slax-diagnostic-review-build.log`, and `/tmp/slax-diagnostic-review-gen.log`.
- Independent Bugs/Security recheck reported both findings resolved and no new Important code regression. Compliance review and mobile/native review are complete; no claim of human hands-on acceptance is made. The documented worker-wide invocation-log/trace suppression needs operator review before enabling the diagnostic binding.
- At the implementation handoff, remaining acceptance blockers were Android debug signing file absent and attached device locked; simulator GUI unavailable; physical keyboard/three-button navigation and native file-receiver behavior unverified; complete native Mobile-to-API exercise, Release scenarios, human acceptance and version decision pending. No commits, pushes, PR, deployment or live notification-group message had been performed at that point.

## Authorized preview delivery (2026-10-29)

- The user requested packaging, Git push, TestFlight upload, and subsequent cleanup of this task's build products/caches/worktree/simulator. The user then confirmed TestFlight's latest version as `1.0.25 (794)` and instructed continuation. Build `1.0.25 (795)` uses `previousBuildNumber: 794`; the publication bound is user-confirmed, not independently queried App Store Connect history.
- App Store Connect browser access requires normal Apple login. No attempt was made to bypass it. Existing supported Xcode account/Keychain signing and upload tooling remains the release path.
- Preview publication authorization does not establish native hands-on acceptance, authorize API deployment, send live group notifications, or authorize a PR/merge. The documented native verification gaps remain explicit.
- Non-clean prebuild initially failed because an unstaged local change omitted runtimeVersion while the generated Expo plist retained it. Restoring the existing upstream `nativeVersion` policy resolves the mismatch without enabling local OTA or patching generated files/dependencies.
- Regenerated metadata sets iOS main/share and Android build numbers to 795. The task branch is integrated with the current development baseline before archive so the confirmed build-794 lifecycle/login fixes are not regressed.
- Cleanup is restricted to task-owned outputs and the `Slax Diagnostics QA` simulator, after successful remote source preservation and upload evidence. Unrelated worktrees, shared caches, credentials, operator configuration and other simulators are preserved.
- Release source commit `b321140d75f51ddbacd62ac5af2fcb423f6911be` combines diagnostic feature commit `a67a150e` with `origin/dev@89fbf35e`. The existing 794 foreground warmup, login artwork, feed-drag and reader recovery fixes are retained.
- On that versioned source, safe API regeneration produced no drift; API typecheck passed; focused diagnostic/Pocket Casts integration regressions passed 239 tests across five files; `pnpm mobile -- check` passed 1,249 tests with zero failures; both mobile bundles passed; strict OpenSpec validation passed 84 items; `git diff --check` was clean.
- Non-clean prebuild regenerated both platforms at 795. iOS Firebase release admission version 2 passed after the standard generator used the existing operator-owned root configuration opaquely; no service-file contents were inspected or committed.
- Build-specific logs are `/tmp/slax-diagnostic-795-{gen-all,api-typecheck,api-tests,mobile-check,mobile-bundle,openspec,diffcheck}.log`. Signed archive, export and upload outcomes are recorded separately; these checks are not native UI or Apple processing acceptance.
