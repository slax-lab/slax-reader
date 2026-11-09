# Proposal

## Why

Mobile pins Expo `58.0.16` and React Native `0.88.0`, while the newest Expo SDK 58 patch, `58.0.23`, recommends React Native `0.88.1` and updated SDK modules. The patch set fixes upstream defects that reach existing Mobile behavior: an Android startup crash when an OTA update asset is truncated (`expo-updates` 58.0.21), and status-bar style or visibility changes having no effect in apps built with the iOS 27 SDK (`expo` 58.0.23). Expo SDK 59 and React Native 0.89 are not released, so this is the newest supported runtime available now.

The Android build also packages `x86` and `x86_64` native libraries. No current Android phone uses an x86 CPU; recent Crashlytics fatal events with x86 libraries came from one emulated device profile reporting itself as `OnePlus8Pro` with x86_64 hardware, where the loader then searched the ARM directory. x86 libraries double native build work and bundle size while serving only x86 ChromeOS devices and emulators, which can run ARM builds through translation.

## What Changes

- Upgrade `expo` to `58.0.23` and `react-native` to `0.88.1`.
- Align each Expo SDK 58 module the project declares with the `58.0.23` bundled native module versions: `@expo/ui`, `expo-app-intents`, `expo-clipboard`, `expo-constants`, `expo-dev-client`, `expo-file-system`, `expo-hinge`, `expo-image`, `expo-media-library`, `expo-network`, `expo-observe`, `expo-sharing`, `expo-updates`, `react-native-safe-area-context` and `react-native-screens`. Keep each manifest entry's existing exact or tilde style.
- Keep `react` and `react-dom` at `19.3.0`, the renderer version that Expo SDK 58 and React Native 0.88 require. Keep every package whose SDK 58 recommendation is unchanged.
- Regenerate `pnpm-lock.yaml` and the tracked CocoaPods lock through their generators.
- Stop packaging Android `x86` and `x86_64` native libraries; keep `armeabi-v7a` and `arm64-v8a`. Set the ABI list in the app-owned `with-native-compatibility` config plugin and regenerate `android/gradle.properties` from it. **BREAKING** for distribution: x86 ChromeOS devices run the application through ARM translation instead of native x86 libraries, and x86 Android emulators need an explicit local architecture override.
- Out of scope: React Native 0.89 or Expo SDK 59, the SoLoader 0.13.0 loader fix (React Native 0.88.1 and 0.89.0-rc.0 still use SoLoader 0.12.1), and optional upgrades outside the SDK recommendation (React Native Firebase 27, op-sqlite 19, PowerSync, `expo-iap`, `pdfjs-dist`, TypeScript 7).

## Capabilities

### New Capabilities

- `mobile-android-native-abis`: Android builds package native libraries for the two ARM ABIs only, and the ABI list survives native project regeneration.

### Modified Capabilities

None. The SDK patch set brings the implementation in line with existing requirements and changes no requirement: `mobile-ota-updates` already requires a failed update check to start with the newest bundle on the device, and `mobile-sdk58-upgrade` (from the merged, unarchived `update-expo-58` change) already owns the SDK 58 runtime and its native acceptance gates. This change does not add a delta to `mobile-expo-runtime`, `mobile-upgrade-compatibility` or `mobile-sdk58-upgrade`, which other active changes carry.

## Impact

- `apps/mobile/package.json`, `pnpm-lock.yaml`, and the generator-owned `apps/mobile/ios/Podfile.lock`. The Android project resolves the SDK versions from `node_modules`; its only tracked change is the regenerated `reactNativeArchitectures` line in `android/gradle.properties`.
- `apps/mobile/plugins/with-native-compatibility.cjs` and its test own the Android ABI list. Google Play may report fewer supported devices for the next upload; that reduction covers x86-only device configurations and is the intended effect.
- Both native platforms rebuild against React Native 0.88.1 and Expo Modules Core 58.0.30, so both need native build and cold-start verification. Web, Extension, CLI, API contracts and database formats are not affected.
- The baseline is `origin/dev` at `98221907`, Mobile `1.0.28 (802)`. Any version or build increment requires the human decision in `docs/release/VERSIONING.md`.

## Review Status

The owner reviewed this scope in conversation on 2026-11-09. After the patch notes and the recommended module set above were presented, the owner asked to adopt the core Expo/React Native update and instructed "新开Worktree提PR上去吧" (open a new worktree and raise the pull request). After reviewing the ChromeOS translation trade-off and the recommendation to keep both ARM ABIs, the owner approved removing x86 in this same pull request: "去掉吧，就跟当前的升级PR worktree一起做好了" (remove it, together with the current upgrade PR worktree). Implementation is authorized in this worktree as one draft pull request targeting `dev`. The version decision is pending.
