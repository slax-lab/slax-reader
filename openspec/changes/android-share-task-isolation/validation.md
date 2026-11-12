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
- Final source at `1.0.30` (805): `pnpm mobile -- check` **passed, 1,236 tests, 0 failures/skips**; `pnpm mobile -- bundle` **passed for Android and iOS**; `pnpm exec openspec validate --all --strict` **139 passed, 0 failed**. All three commands exited 0. These checks ran on the versioned deliverable, not only the earlier acceptance source.
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

- **Accepted by:** the requesting user on their connected Pixel 9 Pro Fold, 2026-11-12, before PR creation.
- **Confirmation:** the user explicitly stated that acceptance was complete, requested the PR, and approved `1.0.30 (805)`.
- **Accepted scope:** restore the original independent Android collection popup without foregrounding the main app; retain the existing popup and leave iOS behavior unchanged. No additional UI adjustment was requested after device acceptance.
- The tested installed binary was 1.0.29 (804); the subsequent requested changes are version metadata only. Do not represent version 805 as separately installed or accepted.
- The user did not enumerate every cold/warm/error/cancel/consecutive-share scenario. No agent-recorded complete scenario matrix, task-stack trace, or before/after motion capture is claimed. These are declared agent-verification/visual-evidence gaps, not substitutes for human acceptance.

## Local Review

- Bugs: exact legacy task policy is restored only on ShareActivity; main task configuration, popup UI, and transport remain unchanged. Fresh/stale generation and idempotence are tested. Delivery to a still-active singleTask instance is not claimed independently verified; no speculative lifecycle machinery was added.
- Security: no new dependency, network destination, permission, secret, or production-data mutation. APK signing uses the existing publisher identity. Operator files and private configuration are excluded from the commit.
- Compliance: user reviewed and clarified the interaction, accepted the installed repair before PR, and explicitly approved the version increment. Generated metadata came from prebuild. Unverified scenario details and the version-only delta are disclosed.

## Delivery Status

Preparing the requested dev-targeted PR. Commit/push/PR review results will be recorded after they occur. No merge, store upload, or public release is authorized or claimed by this task. The existing Release build performed its configured Crashlytics mapping-upload task; that is not an app-store publication.
