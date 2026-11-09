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
- **iOS:** the committed project is configured for Firebase and cannot be built without the operator's `GoogleService-Info.plist`: `pnpm mobile -- build:ios --release --unsigned` compiled every target and failed only at `CopyPlistFile ... GoogleService-Info.plist`. Following `docs/mobile/README.md`, the iOS project was regenerated unconfigured (`pnpm mobile -- prebuild:clean --clean --platform ios`, which removes the plist reference and `FirebaseApp.configure`), then `pnpm mobile -- pods` and `pnpm mobile -- build:ios --release --unsigned` with `ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO`: `** BUILD SUCCEEDED **`. The `1.0.28 (802)` arm64 app was installed on an iPhone Duo simulator (iOS 27.1). Two cold launches kept the process running and reached the localized login screen with Google and Apple sign-in; the last two minutes of unified log for `SlaxReader` contain no fatal, `EXC_`, abort or termination entry, and no crash report was written. The status bar renders dark content. Afterwards the committed iOS project was restored with `git checkout` and `pnpm mobile -- pods`; the resulting iOS diff is byte-identical to the intended upgrade diff.

## Not verified

- Configured builds with operator Firebase files, release signing, EAS cloud builds and store delivery; no operator configuration was available or used.
- Physical devices, sign-in, purchases, sync, offline reading and Share on the upgraded runtime.
- The upstream fixes themselves: a truncated OTA asset in an EAS production build was not reproduced, and the iOS 27 status-bar fix was not isolated. The login screen's dark status bar matches the system default, so it shows no regression but does not prove the fix.
- ChromeOS behavior through ARM translation, and the Google Play supported-device count after removing x86.
- Whether removing x86 libraries stops the SoLoader crash reported by the emulated `OnePlus8Pro` profile; that environment was not available.

## Version decision

Pending. The change alters native code and dependencies, so `docs/mobile/release.md` rules out delivering it to installed `1.0.28 (802)` binaries as an OTA update; a store release needs a new build number.
