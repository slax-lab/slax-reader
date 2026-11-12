# Validation

## Scope and Provenance

- Date: 2026-11-12. Branch: `fix/android-share-task-isolation`, based on `origin/dev` at `8efef440`.
- Worktree: `.local/android-share-task-isolation`. Existing changes in the original checkout were not modified.
- The user confirmed the established interaction: both platforms retain their standalone collection popup. Only Android task isolation is corrected; popup rendering, transport, main navigation, and iOS sharing behavior are unchanged.
- No production data or content-provider integration was changed. The approved release metadata is `1.0.30` (805), previous source build 804.

## Automated Evidence

- `node --test apps/mobile/native/share/tests/plugin.test.cjs`: **10 tests passed**. Fresh, existing, and stale share manifests; restored attributes; retained translucent theme and text/plain filter; unchanged application/MainActivity configuration; idempotence; existing iOS generator coverage.
- `pnpm mobile -- prebuild` with local operator configuration disabled: **passed**. Android and iOS main/share/runtime metadata were generated from the approved package fields. The APK verification build's local Firebase Gradle wiring and unrelated iOS Podfile drift were removed from the proposed diff; no generated version values were hand-edited.
- Explicit metadata checks: package `1.0.30` / 805 / previous 804; Android Gradle version and share metadata; iOS main/share plist versions; Android/iOS runtime `1.0.30(805)`; and all three share-activity attributes: **passed**.
- Before the version-only increment, `pnpm mobile -- check`: type checking and **1,236 tests passed**, zero failed or skipped. A filtered-install missing `abort-controller` was resolved by full offline frozen-lockfile installation without dependency changes.
- Before the version-only increment, `pnpm mobile -- bundle`: **passed for Android and iOS**. This alone is not native evidence.
- Original versioned PR source at `b28a586a`, `1.0.30` (805), before the lifecycle review follow-up: `pnpm mobile -- check` **passed, 1,236 tests, 0 failures/skips**; Android/iOS bundles passed; strict OpenSpec validation passed **139/139**. After the new-intent regression test was added in `e6744edf`, the corrected versioned source passed **1,237 tests, 0 failures/skips**; see the follow-up section below. These are separate historical runs, not contradictory counts.
- `pnpm mobile -- test:native-resources`: **passed**, using already cached Kotlin 2.2.10 compiler/runtime, OkHttp 4.9.2, and Okio 2.8.0 through the runner's supported environment variables. Kotlin checks ran on the host JVM and Swift checks on macOS; they do not prove Android task routing.
- `pnpm exec openspec validate --all --strict`: **139 passed, 0 failed** on the initial repair. Existing advisory messages for unrelated archived deltas are outside scope.
- Focused strict change validation and `git diff --check`: **passed**.

## Native Build and Installation

- Initial missing SDK prerequisite was resolved with official Google tools in ignored `.local/android-sdk`: platform 37.0, NDK 27.1.12297006, CMake 3.22.1, build/platform tools; Java 21 was already available.
- The first full compile hit a tool time limit. The resumed standard `pnpm mobile -- build:android --release -PreactNativeArchitectures=arm64-v8a --max-workers=4 --console=plain` completed **BUILD SUCCESSFUL**, with 1,467 actionable tasks. Existing operator signing/Firebase configuration was consumed by repository tooling without printing credentials.
- Inspected acceptance APK: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`; package `com.slax.reader`, version `1.0.29` (804), ARM64, embedded Hermes JS, existing Slax publisher certificate. SHA-256: `0e3feb470390fd77027a091830760d2bd76a5e589023451bccd3af52a65705a7`.
- `apksigner verify --print-certs` passed. The APK's binary manifest contained empty `taskAffinity`, `excludeFromRecents=true`, and launchMode value 2 (`singleTask`) for ShareActivity. Production API origin and disabled local-build production OTA were checked.
- Device: requesting user's Pixel 9 Pro Fold, Android 17 / API 37. Existing Google Play build 803 used a different signing identity. After explicit user authorization, `adb uninstall com.slax.reader` and `adb install <verified APK>` both returned **Success**, at 2026-11-12 12:39 Asia/Shanghai. Local data removal was explicitly authorized.
- Post-install `dumpsys package` confirmed version 804 / 1.0.29. Cold launch returned **Status: ok**; MainActivity was resumed and the process remained alive. Package-manager query resolved `text/plain` ACTION_SEND to the standalone ShareActivity. A device screenshot showed the real welcome/login screen; it is local-only evidence, not committed media.

## Human Hands-on Acceptance

- **Status: COMPLETE — explicitly confirmed by the requesting user.**
- **Accepted by / date / device:** the requesting user, 2026-11-12, Pixel 9 Pro Fold. The user initially confirmed acceptance before PR creation and approved `1.0.30 (805)`. After the final 805 patch was installed, the user explicitly reaffirmed that human acceptance had already been completed and directed the assistant to correct the PR description.
- **Accepted scope:** this PR's Android independent collection popup repair, including the repeated-intent correction delivered in the final 805 patch, while preserving the existing popup and iOS behavior. No further UI adjustment was requested in the user's confirmation.
- **Artifact provenance:** the initial accepted installation was 1.0.29 (804). The final 1.0.30 (805) APK, SHA-256 `49446b3c50bc83e883d4110ccf67737edbc70ab35bd1f1cbcf525977b7c73d39`, was installed on the same phone at 13:38 Asia/Shanghai before the user's latest acceptance reaffirmation. The earlier assistant-written pending-acceptance statements are superseded by this explicit confirmation; this is recorded acceptance, not a waiver.
- The user did not provide a per-scenario test transcript, so no independently observed full authenticated WeChat test matrix is invented. That limit on agent-recorded detail is separate from the user's completed human acceptance. Controlled emulator evidence is described below.

## PR Review Follow-up: Still-active Intent Delivery

- PR #586 at b28a586a passed every CI gate except the review gate. Comment 4546502720 correctly identified that a second ACTION_SEND could be discarded by a still-alive singleTask activity without onNewIntent handling.
- On the original phone, Android reported that the second invalid intent was delivered to the existing top-most ShareActivity. The phone then disconnected; no further physical-device changes were attempted.
- A read-only, no-snapshot Android 15 / API 35 arm64 emulator session reproduced the actual failure with the original signed APK (SHA-256 above). First ACTION_SEND had no EXTRA_TEXT and displayed `Not have share content`. The next ACTION_SEND had the text `review-no-url`, but the same first error remained. No valid URL, authentication data, or production request was used.
- The fix calls the existing cancellation method, removes main-handler callbacks, finishes the old activity, and explicitly starts the same ShareActivity with a copy of the incoming Intent. A new instance owns its diagnostics/executor/UI, preserving task isolation and the original popup appearance.
- `node --test apps/mobile/tests/share-native/android-intent.test.cjs`: passed. The host compiles the actual production handoff and cancellation method bodies with controlled Android boundary doubles. Twelve replacements cover collecting, success, failed, and dismissing state; assert request cancellation, callback cleanup, fresh ownership, intent copy, URL/subject preservation, launch target, and finish-before-start ordering. This is method-level host evidence, not a replacement for framework testing.
- Corrected version 1.0.30 (805) Release arm64 APK: standard native build **BUILD SUCCESSFUL in 5m 41s**; apksigner verification passed with the existing Slax certificate. APK SHA-256: `49446b3c50bc83e883d4110ccf67737edbc70ab35bd1f1cbcf525977b7c73d39`.
- The corrected APK was installed with `adb install -r` in the disposable emulator. Four actual launches passed: first missing-text error; second no-URL error while the first popup remains alive; third missing-text error while the second remains alive; fourth no-URL share after dismissal. UI hierarchy checks confirmed each distinct result. ShareActivity task 32 and MainActivity task 29 were separate; Back returned to Settings task 27. No valid URL or production request was sent.
- Matched 12-second before/after recordings use the same 1080x2400, light-theme emulator and Date & time settings backdrop. They show the second invalid share retaining the old result before the fix and receiving its own result after the fix, followed by returning to the source. Recordings are local ignored artifacts and will be attached to the PR, never committed. They do not establish authenticated WeChat success behavior or physical-phone layout parity.
- Full `pnpm mobile -- check` on the corrected versioned source: **1,237 tests passed, zero failures or skips**. The Release build includes the current Android JS bundle; prior iOS bundle evidence remains applicable because the follow-up modifies Android lifecycle handling and its tests only.

## Local Review

- Bugs: confirmed intent loss is fixed through fresh Activity ownership rather than mutating an in-flight Activity. Stale callbacks stay with the inactive old owner; framework tests verify repeated delivery and source return. No queue or speculative lifecycle mechanism was added. Cancellation retains existing semantics and does not undo a server-accepted save.
- Security: no new dependency, network destination, permission, secret, or production-data mutation. The copied Intent targets ShareActivity explicitly, not a sender-supplied component. Existing signing identity is retained and operator files stay outside the commit.
- Compliance: the original interaction and version were approved; the follow-up resolves an Important review finding within the same Android popup repair. Specs/design describe the concrete lifecycle case, and its additional evidence and remaining physical-device limits are explicit.

## Delivery Status

PR #586 targets dev. The review follow-up retains the approved version 1.0.30 (805), previous source build 804. No merge, store upload, or public release is authorized or claimed. The standard Release build performed its configured Crashlytics mapping upload; that is not app-store publication. Review/check completion is recorded in the PR discussion.


## Final Patch Acceptance Handoff

- The second automated review of e6744edf confirmed the intent handoff is sound and found no Bugs or Security blockers. Its sole Important finding is renewed human acceptance of the final lifecycle correction; all CI build/test gates passed. This gate is not waived.
- On 2026-11-12 at 13:38 Asia/Shanghai, the physical Pixel 9 Pro Fold reconnected. The signed corrected APK with SHA-256 `49446b3c50bc83e883d4110ccf67737edbc70ab35bd1f1cbcf525977b7c73d39` passed signature verification and was installed using `adb install -r`: **Success**. No uninstall, clear-data, or account mutation was performed. Installed metadata confirms **1.0.30 (805)**; MainActivity launch returned **Status: ok**.
- **Human acceptance is complete.** On 2026-11-12, after the final 805 installation, the requesting user explicitly reaffirmed that they had already completed human acceptance and instructed the assistant to update the PR description. The earlier pending label was an assistant documentation error and is withdrawn. This confirmation supplies the human acceptance evidence requested in review comment 4546716161; it does not authorize merging or claim any unrecorded scenario details.
- The test-count Nit is corrected by distinguishing the original b28a586a run (1,236) from the e6744edf follow-up (1,237). Intent flag preservation is an explicit scoped compatibility decision documented in design.md; unusual flag/OEM combinations remain unverified.
