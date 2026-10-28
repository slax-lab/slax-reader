# Validation

Date: 2026-10-28. Branch `feat/mobile-ota-updates`, based on `origin/dev@10c46f0a` (after `feat/mobile-native-smoothness` merged; Expo SDK 58, React Native 0.88). The human approved `1.0.25 (794)` with previous bound 793 as the first OTA-capable build. Integration evidence below was taken at build 793; the version section records the re-verification at 794.

## Commands and results

| Command | Result |
| --- | --- |
| `npx expo install expo-updates`, then `pnpm install --frozen-lockfile` | `expo-updates@~58.0.18` added; the lockfile adds only its graph (`expo-structured-headers`, `expo-eas-client`, `expo-manifests` and their dependencies). |
| `npx expo config --type public` (production, `EXPO_PUBLIC_SLAX_API_URL=https://reader-api.slax.dev`, `EXPO_PUBLIC_SLAX_UI_FIXTURE=library`) | Production: `updates.enabled: true`, URL `https://u.expo.dev/f8949909-ddbf-49f8-a42d-9e70a9c77fda`, `ON_LOAD`, `fallbackToCacheTimeout: 0`, `expo-channel-name: production`, `runtimeVersion: {policy: nativeVersion}`, build 793. Test origin and fixture: `updates: {enabled: false}`. |
| `pnpm mobile -- prebuild --platform ios` (operator Firebase input) and `--platform android`, then `pnpm mobile -- pods` | Native diff limited to update metadata (enabled, runtime `1.0.25(793)`, project URL, `production` channel header), the `EXUpdates`, `EXStructuredHeaders` and `ReachabilitySwift` pods and their resource bundles, and CocoaPods quoting churn. A semantically identical one-line rewrite of `SlaxShare/Info.plist` was reverted. |
| `node --test apps/mobile/tests/release/eas-updates-config.test.mjs` | 2 tests passed. Removing the fixture condition or the origin condition from `app.config.ts` each made a test fail. |
| `pnpm mobile -- check` | Passed: 1,160 tests, 0 failures, 0 skips. |
| `pnpm mobile -- bundle` | Passed; `apps/mobile/dist` removed. |
| `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 NODE_ENV=production npx expo export --platform all` (the export `update:publish` triggers) | Both Hermes bundles contain `https://api-reader.slax.com` and not `https://reader-api.slax.dev`; `metadata.json` produced. Temporary output removed. |
| `pnpm mobile -- update:publish --help` | Reaches `eas update --channel production --environment production --platform all --help` after generating PDF assets; nothing published. |
| Local pre-push review (`REVIEW.md`, three passes) | No Important findings. Nits addressed: eligibility wording covers every commit since the installed build, production builds must not override `EXPO_PUBLIC_*`, and the manifest probe was repeated with runtime `1.0.25(793)`. Remaining nit: the configuration test mocks the local-environment loader, so exclusion of `deploy/mobile/.env` from published bundles rests on the export run above. |
| `npx openspec validate --all --strict` | 82 items passed, none failed. |
| `git diff --check` | Passed. |

## Native Release startup

`pnpm mobile -- build:ios --release --unsigned` with the documented local simulator signing (`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO ARCHS=arm64 ONLY_ACTIVE_ARCH=YES`) succeeded. The built app's `Expo.plist` contains `EXUpdatesEnabled = true`, the project `EXUpdatesURL`, `EXUpdatesRuntimeVersion = 1.0.25(793)`, `EXUpdatesCheckOnLaunch = ALWAYS`, `EXUpdatesLaunchWaitMs = 0` and the `production` channel header; `EXUpdates.bundle` is embedded. On a task-owned iPhone 18 Pro / iOS 27.0 simulator the production Release app reached the Google/Apple Login screen on two cold launches, with no App Group entitlement errors and no `expo-updates` errors. The simulator and DerivedData were deleted afterwards.

The EAS `production` channel was created by the operator and maps to branch `production`, which has no updates yet; a manifest request with the `production` channel header returned `204 No Content` (no update available) for both platforms for runtime `1.0.25(784)` on 2026-10-27 and for this build's runtime `1.0.25(793)` on 2026-10-28. The EAS `production` environment holds only the two Firebase file variables, so no `EXPO_PUBLIC_*` value reaches EAS builds or updates.

## Declared gaps

- **No update was published.** Publishing changes the shared EAS project and is an operator action, so the upload and on-device application of an update are unverified (task 2.3).
- **Offline launch and Android Release startup** were not exercised; Android was verified through its generated metadata only.
- **No automated publish guard.** By the owner's request for a minimal integration, eligibility (JavaScript-only, merged into `dev`, no `EXPO_PUBLIC_*` in the shell) is an operator rule documented in `docs/mobile/release.md`, not enforced by tooling.

## Version 1.0.25 (794)

`apps/mobile/package.json` now has `buildNumber: 794`, `previousBuildNumber: 793`. iOS and Android were regenerated with `pnpm mobile -- prebuild` and `pnpm mobile -- pods`: main and share `CFBundleVersion`, Android `versionCode` and both runtimes (`EXUpdatesRuntimeVersion`, `expo_runtime_version`) are `794` / `1.0.25(794)`. The generator's one-line rewrite of `SlaxShare/Info.plist` was replaced by the established layout with only the build number changed; both parse to identical property lists. `npx expo config` reports `1.0.25`, iOS 794, Android 794, updates enabled. `pnpm mobile -- check` (1,160 tests, 0 failures, 0 skips), `pnpm mobile -- bundle`, `openspec validate --all --strict` (82 items) and `git diff --check` passed again. The iOS Release simulator launch above used build 793; only version metadata changed for 794, which was not relaunched.
