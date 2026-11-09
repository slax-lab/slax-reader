# Validation

Environment: macOS on Apple M1 (8 cores, 16 GB), Xcode 27.1 (27A9275), iOS Simulator SDK 27.1, OpenJDK 17.0.19, Android SDK Platform 37.0, Build-Tools 37.0.0, NDK 27.1.12297006. Worktree `fix/mobile-sdk58-patch-sync` from `origin/dev` `98221907`. All commands ran with `SLAX_MOBILE_NO_LOCAL_CONFIG=1`; no operator configuration, Firebase service file, signing key or `.env` file was read or supplied.

## Dependency update

| Check | Result |
| --- | --- |
| `pnpm install` | Passed. The lockfile importer diff is limited to `apps/mobile`; no `react-native@0.88.0` resolution remains. Peer warnings do not involve Mobile, Expo or React Native packages. The lockfile adds no new package name and no new version with an install script; 72 package versions change. `expo-widgets` drops out: it was only an optional peer of `babel-preset-expo` 58.0.18, the app does not import it (widgets were retired by `with-retire-reading-widgets`), and neither Podfile.lock contains a widget pod. |
| `expo install --check` | `Dependencies are up to date`. Installed: Expo 58.0.23, React Native 0.88.1, React/React DOM 19.3.0, Expo Modules Core 58.0.30, expo-updates 58.0.21. |
| `pnpm mobile -- pods` | Passed. `Podfile.lock` reports React Native pods 0.88.1, Expo 58.0.23, ExpoModulesCore 58.0.30, EXUpdates 58.0.21, hermes-engine 260318099.0.5; `PODFILE CHECKSUM` unchanged. `project.pbxproj` changes only the CocoaPods-written `REACT_NATIVE_PATH`. |
| `pnpm mobile -- prebuild` before and after the upgrade | Identical drift both times (unconfigured Firebase Podfile toggle and pbxproj quoting caused by the absent operator configuration), so the upgrade itself changes no tracked native file; that drift was discarded. |

## Android ABIs

| Check | Result |
| --- | --- |
| New test `Android native libraries are limited to ARM ABIs after regeneration` | Fails with the plugin line removed (7 pass, 1 fail) and passes with it (8 pass). |
| `pnpm mobile -- prebuild --platform android` | The only Android change is `reactNativeArchitectures=armeabi-v7a,arm64-v8a` in `android/gradle.properties`. |
| `pnpm mobile -- build:android --release --unsigned bundleRelease`, no architecture override | `BUILD SUCCESSFUL in 4m 19s`. The AAB (58,515,151 bytes) and APK each contain exactly `arm64-v8a` and `armeabi-v7a`, 37 native libraries per ABI, including `libc++_shared.so` in both. The previous session's production 1.0.28 (802) AAB contained the same 37 libraries for each of four ABIs (96,847,055 bytes). |

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm mobile -- check` (after all changes) | Passed: architecture, asset baseline, fixtures, RSS verification, `tsc --noEmit`, and 1,281/1,281 tests. |
| `pnpm mobile -- test` | Passed 1,280/1,280 before the ABI test was added; the final `check` run above includes it. |
| `pnpm mobile -- bundle` | Passed: iOS (2,057 modules) and Android (2,067 modules) Hermes bundles exported. Ran before the ABI change, which alters only an Android Gradle property and no JavaScript. |
| `pnpm mobile -- test:native-resources` | Passed for production Kotlin resources (host JVM) and production Swift resources (macOS host), with locally installed Kotlin 2.3.21, JetBrains annotations 13.0, OkHttp 4.12.0 and Okio 3.6.0 supplied through the script's environment inputs; nothing was downloaded. Host checks only. |
| `openspec validate --all --strict` | 115 passed, 0 failed. |
| `git diff --check` | Clean. |

## Running environment

- **Android:** emulator `sdk_gphone64_arm64` (system image `android-36;google_apis;arm64-v8a`, ABI list `arm64-v8a`), serial `emulator-5584`. The ARM-only release APK was signed with a throwaway local test key (not the release key) and installed: `versionCode=802`, `versionName=1.0.28`, `primaryCpuAbi=arm64-v8a`. Two cold starts (`LaunchState: COLD`, 3,316 ms and 3,077 ms) reached the "Welcome to Slax Reader" login screen with Google sign-in. Logcat after each launch: 0 `FATAL EXCEPTION`, 0 `couldn't find DSO`, 0 ANR; SoLoader initialized from `base.apk`.
- **iOS:** following `docs/mobile/README.md`, the iOS project was regenerated unconfigured (`pnpm mobile -- prebuild:clean --clean --platform ios`, which removes the plist reference and `FirebaseApp.configure`), then `pnpm mobile -- pods` and `pnpm mobile -- build:ios --release --unsigned` with `ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO`: `** BUILD SUCCEEDED **`. The `1.0.28 (802)` arm64 app was installed on an iPhone Duo simulator (iOS 27.1). Two cold launches kept the process running and reached the localized login screen with Google and Apple sign-in; the last two minutes of unified log for `SlaxReader` contain no fatal, `EXC_`, abort or termination entry, and no crash report was written. The status bar renders dark content. Afterwards the committed iOS project was restored with `git checkout` and `pnpm mobile -- pods`; the resulting iOS diff is byte-identical to the intended upgrade diff.

## Version

The owner approved `1.0.29 (803)` with `previousBuildNumber: 802` on 2026-11-09. `pnpm mobile -- prebuild` regenerated the version metadata; the tracked change is limited to Android `versionCode`/`versionName`, `SlaxVersionCode`/`SlaxVersionName` and `expo_runtime_version`, and iOS `CURRENT_PROJECT_VERSION`/`MARKETING_VERSION`, the main and Share `Info.plist` versions, and `EXUpdatesRuntimeVersion` in `Expo.plist`. The native builds above ran at `1.0.28 (802)` before this metadata-only increment. The change ships in the new `1.0.29 (803)` native build, not as an OTA update to `1.0.28 (802)`.
