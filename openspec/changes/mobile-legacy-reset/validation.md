# Validation

## Scope and authorization

The owner approved fixed-path legacy reset on 2026-11-09, explicitly accepted loss of old local/unsynchronized data, required Android and iOS simulator testing, prohibited any physical-phone interaction (including read-only), and conditionally requested a PR after successful checks. They subsequently approved 1.0.29 (804), previous build 803. No store release or production data changes are authorized. Work is isolated on `fix/mobile-legacy-reset` under `.local/mobile-legacy-reset-worktree`.

Only Android `emulator-5586` and task-created iOS simulator `2E426083-8135-4796-AF54-69A5AA85AAF9` (Slax Legacy Reset 20261109, iOS 27.0) were targeted in this acceptance round. No physical device was inspected, installed, cleared or operated. Private environment/signing/configuration files were not read; builds used `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1` and test-only public-debug/ad-hoc signing.

## Human hands-on acceptance — completed

- **Who:** the requesting project owner, directly in the task conversation.
- **Date confirmed:** 2026-11-09.
- **What was accepted:** the implemented application running in the simulator. The owner inspected the interface, confirmed it was normal, and explicitly clarified that this inspection was their completed acceptance.
- **Requested adjustments:** no visual adjustment. The owner requested accurate documentation of the storage-only scope and correction of the reset preflight ordering defect identified during review.
- **Result:** human hands-on acceptance is complete. The previous statements denying human acceptance or describing it as a waiver were incorrect assistant-authored records and are removed.

This is exceptional local-database upgrade/recovery handling, not a UI redesign. Layout, styles, icons, navigation structure and normal Library/Reader/Login presentation are unchanged. `LibraryDataStatus.tsx` only drops the obsolete migration-verification error branch with its retired database admission mechanism. Automated database fault injection and external-provider test boundaries are documented separately below.

## Test boundaries

Old database/preferences came from the real pinned PowerSync Kotlin 1.14.1 producers: four operations in two transactions, old cache and AndroidX preference data. These are synthetic fixtures, not the original Play-signed 1.0.24 package or an affected user's database. The iOS wrapper needed UIKit scene lifecycle to launch under the installed Xcode SDK; the old Kotlin data writer and dependencies are unchanged.

Normal-screen acceptance renders the production App, MobileProvider, Library, Reader and LoginScreen; it is not the earlier JSON-result fixture. Only external Google/Apple provider authorization is replaced by the explicit development-only loopback provider. Login requests still pass through the real app API/session path to a local HTTP adapter. PostgreSQL and PowerSync are real isolated labelled containers pinned to the repository fixture images. This demonstrates app-side login acceptance, reset and refill, not Google/Apple account authorization, App Store/Play signing or production-network behavior. No production cloud records were modified.

## Verified results

- Production Kotlin and Swift fixed-path helpers pass: malformed old file, SQLite sidecars, cache cleanup, pending-reset resume, no repeated reset after completion, native-created storage and retained preference-only negative controls, redirected-path containment.
- Shared runtime/preference tests pass, including pending legacy logout followed by new login, valid-session retention, corrupt legacy preference fallback, reset completion before SDK initialization and new pending-write retention across runtime stop/start.
- Standard `pnpm mobile -- check` on build 804 passed 1,203 tests with zero failures/skips. Two additional acceptance-resolver isolation tests were then added and passed independently; they assert normal runtime/screens are not substituted and non-fixture/non-loopback configurations are rejected.
- `pnpm mobile -- bundle` passed Android/iOS export on build 804.
- `pnpm mobile -- test:native-resources` passed Kotlin and Swift suites using installed public toolchain jars.
- Android native build 804 passed with ARM64, JDK 17 and the task SDK (`BUILD SUCCESSFUL`, 1,155 actionable tasks).
- iOS native code and clean credential-free generated simulator project built successfully. The original generated worktree project retained a missing `GoogleService-Info.plist` reference; it was not satisfied by reading or fabricating credentials. A clean allowlisted-source test project was generated with the same application/App Group identities and current production native code. Final 804 re-generation/build status is recorded separately below when complete.

### Android actual app UI

1. Installed the real old SDK synthetic producer, observed four pending operations, force-stopped it, then replaced it with the new app via `adb -s emulator-5586 install -r`; no uninstall or clear occurred between old production and replacement. The reset removed the old database and initialized the fixed new slot.
2. With network disabled, the ordinary library showed an empty state, not saved-data recovery. Enabling emulator networking established an actual PowerSync stream and populated two server-seeded articles. The server had records not present in the old cache.
3. Tapped `Cloud article after reset`: the production reader rendered newly downloaded HTML explicitly stating it was not the old cached article.
4. Tapped the production drawer Logout; observed the normal Login screen. Checked the agreement and tapped Google Login (synthetic external-provider result, actual HTTP/API/session processing). Server login count increased and the production library repopulated.
5. Force-stopped and cold-launched the app. After dismissing the development-client overlay, both rows remained; the old database path and reset marker were absent.
6. Earlier native acceptance additionally injected an unreadable legacy file plus stale sign-out/adoption/cleanup state. It reached ready storage and authenticated relogin, and retained one newly queued operation across runtime restart. This is distinct from the normal-screen UI run.

Reviewed screenshots: `.local/android-cloud-refill.png`, `.local/android-normal-reader.png`, `.local/android-normal-logout.png`, `.local/android-normal-relogin.png`.

### iOS actual app UI

1. Installed the scene-compatible old SDK producer on the dedicated simulator and observed four operations/two transactions. Replaced it with the new app without clearing the data container/App Group.
2. The production library displayed two records delivered through the real local PowerSync service. The production reader rendered newly downloaded HTML.
3. XCTest tapped actual navigation, Logout, the agreement checkbox/sheet and Google Login. The real session/API flow accepted the controlled provider response and the library repopulated.
4. XCTest terminated and relaunched the app and asserted the articles remained. The complete clean run passed with zero failures in 46.993 seconds. Result: `.local/ios-ui-clean.xcresult`. All five exported screenshots were opened and visually reviewed: refill, reader, logged-out login page, relogin library and cold-restart library.
5. Injected a synthetic unreadable file at the old path plus pending sign-out, failed adoption and cleanup markers into this same task-only installation. The complete UI test passed again with zero failures in 54.758 seconds. Result: `.local/ios-ui-corrupt.xcresult`.

Successful screenshot manifest: `.local/ios-ui-clean-screens/manifest.json`. Local service receipts recorded real stream traffic, content downloads and accepted login requests. External provider authorization is still a test boundary.

## Failed attempts and corrections

- The initial native result fixture used a bare path with Expo FileSystemFile and failed with `URI is not absolute` before testing reset. It was corrected to `file://`; that failure screenshot is not passing evidence.
- Early XCTest runs used StaticText for iOS library rows (actual Button), Button for the checkbox (actual Other), and failed to dismiss localized development menus. Locator and timing errors were corrected using actual accessibility trees; these failed runs are not counted as product acceptance.
- A timed-out local synchronization service caused development LogBox connection errors. Services were relaunched without timeout and the whole old-producer-to-new-app scenario was rerun cleanly. The final passing run contains no error overlay.
- Missing Android test keystore was resolved with a new task-only debug identity, not operator credentials.
- iOS build initially exceeded captured output limits, then encountered the missing public Firebase config reference. Output was redirected and clean native project generation used as described above; generated unrelated Firebase-mode drift in the delivery tree was restored.
- One concurrent full-suite run hit unrelated timing-sensitive share transport/PDF tests; focused reruns and the final full standard check passed. A test port collision with Metro was removed by moving the test server.
- Old iOS producer wrapper hash pins were deliberately updated after reviewing its scene-only change; historical result files were not rewritten.

## Final build 804 verification

- Android `versionCode=804`, `versionName=1.0.29` was inspected from the installed package. A fresh genuine old SDK producer was replaced with that exact APK without clearing between versions; the normal library displayed both freshly synchronized server articles. Screenshot `.local/android804-cloud-refill.png` was opened and reviewed.
- The clean generated iOS simulator project was regenerated from approved 1.0.29 (804) metadata and rebuilt successfully. Its built Info.plist was checked for build 804. After in-place installation, the complete normal-screen XCTest passed with zero failures in 51.096 seconds: `.local/ios-ui-804.xcresult` and `.local/ios-ui-804.log`.
- Final pre-commit standard mobile check: **1,205 passing tests, zero failures/skips**, including the development-resolver boundary tests (`.local/pr-final-mobile-check.log`). Android/iOS bundle export, native resource and fixed-path Kotlin/Swift helper suites pass.
- `pnpm agent:check` passes generated guidance, 117 strict OpenSpec items, and workflow drift checks. `git diff --check` passes.

## Review

- **Bugs:** reviewed marker-before-deletion/finish-before-new-writes ordering, fixed old/new slot separation, pending sign-out precedence, malformed preference fallback and normal Expo negative controls. No unresolved Important implementation finding remains in these reviewed paths; the native interruption matrix below remains an explicit verification gap.
- **Security:** reviewed fixed app-owned paths, canonical/symlink guards, native ownership, no cloud deletion and no production credential access. The test provider requires development mode plus the exact loopback origin; resolver tests prove production App/runtime/screens are unchanged. Unrelated generated Firebase-mode drift was removed. No unresolved Important security finding identified.
- **Compliance:** fixed-path simplification and build 804 match explicit owner decisions. Human hands-on acceptance is complete and recorded above: the owner inspected the running simulator app, confirmed the interface was normal, and explicitly confirmed acceptance. No visual redesign is included. Automated synchronization/authentication tests retain their separately stated boundaries.

## Delivery decision and limitations

On 2026-11-09 the owner confirmed human acceptance, approved build 804 and authorized PR submission. Production Google/Apple/store validation and native crash-at-every-deletion-boundary are not claimed: production Kotlin/Swift interruption tests, genuine old SDK producers, actual native app UI, local HTTP login acceptance, real isolated PowerSync refill and cold-start flows are the automated evidence obtained. The remaining exhaustive interruption matrix is tracked in tasks.md and is not marked complete. The PR does not authorize merge, deployment or publication.


## Pull request delivery

On 2026-11-09 implementation commit `412294c42bc76f13773877e22a40ceecb42b4893` was committed with normal hooks and pushed to `fix/mobile-legacy-reset`. PR **#547** targets `dev`: https://github.com/slax-lab/slax-reader/pull/547. Its body includes five reviewed Android/iOS screenshots and explicit synthetic-provider/remaining-interruption boundaries. Initial inspection confirmed OPEN, non-draft, MERGEABLE and REVIEW_REQUIRED; CI and remote review were still running. No merge, deployment or store publication occurred. The delivery worktree was clean after the implementation push; this follow-up records the PR receipt.


## PR review correction: validate before mutation

On 2026-11-09 the owner requested correction of the reviewed reset-order defect. Previously `prepare()` created the marker and deleted cache/new storage before checking a redirected legacy database path. The original tests only protected the external sentinel and missed this internal data loss.

- Added Kotlin and Swift regression assertions for redirected old database, WAL, bookmark cache root, PDF cache root, new database directory, legacy preference file, and nested cache child. Repeated rejection must preserve old/new databases, cache, both preference files and the external sentinel, and must not create a reset marker. After correcting the path, normal reset must succeed.
- Confirmed the unfixed production Kotlin helper fails the strengthened test with `Rejected reset left a marker` (`.local/reset-order-before.log`).
- Both production helpers now preflight every cleanup path and directory descendant before creating the marker or deleting any target. There is no new schema migration, recovery framework or speculative race mechanism.
- Corrected Kotlin and Swift helpers pass all preservation/retry/idempotence cases (`.local/reset-order-after.log`).
- Full `pnpm mobile -- check` passes **1,205 tests, zero failures/skips** after the fix. `pnpm agent:check` passes generated guidance, 117 strict OpenSpec items and workflow drift.
- Android native build and clean generated iOS simulator build both pass with the corrected helper (`.local/reset-order-android-build.log`, `.local/reset-order-ios-build.log`). This correction was tested through production filesystem helpers, runtime regression and native compilation; the earlier simulator UI evidence remains separately identified rather than falsely claimed rerun.
- Human acceptance is complete as recorded above. The owner's simulator acceptance was previously misstated by the assistant; contradictory denial/waiver wording is corrected in all current change artifacts, release notes and PR text.
