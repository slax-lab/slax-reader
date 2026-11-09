# Tasks

## 1. Dependency update

- [x] 1.1 Set `expo` 58.0.23, `react-native` 0.88.1 and the SDK 58 module versions listed in proposal.md in `apps/mobile/package.json`, preserving each entry's pin style; verify `pnpm install` succeeds and the lockfile changes only Mobile-reachable packages
- [x] 1.2 Verify `expo install --check` reports no SDK mismatch and `react`/`react-dom` remain 19.3.0
- [x] 1.3 Regenerate `apps/mobile/ios/Podfile.lock` with `pnpm mobile -- pods` and verify the React Native pods report 0.88.1; compare `pnpm mobile -- prebuild` output before and after the upgrade and verify no tracked native file changes from the upgrade

## 2. Android ABIs

- [x] 2.1 Set `reactNativeArchitectures` to `armeabi-v7a,arm64-v8a` in `apps/mobile/plugins/with-native-compatibility.cjs` and verify the new native-compatibility test fails without the change and passes with it
- [x] 2.2 Regenerate `apps/mobile/android/gradle.properties` with `pnpm mobile -- prebuild` and verify the only upgrade-attributable Android change is the `reactNativeArchitectures` line
- [x] 2.3 Build an Android release bundle without an architecture override and verify its native library directories are exactly `armeabi-v7a` and `arm64-v8a`

## 3. Version

- [x] 3.1 Set `apps/mobile/package.json` to `1.0.29`, build `803`, previous `802`, regenerate native version metadata with `pnpm mobile -- prebuild`, and verify only version fields change in the Android and iOS projects

## 4. Verification

- [x] 4.1 Run `pnpm mobile -- check`, `pnpm mobile -- test`, `pnpm mobile -- bundle` and `pnpm mobile -- test:native-resources`, and verify each passes
- [x] 4.2 Build Android release without an architecture override, sign it with a throwaway local test key, install it on an ARM emulator and verify a cold start reaches the first screen without a fatal log entry
- [x] 4.3 Build the unsigned iOS simulator Release with `pnpm mobile -- build:ios --release --unsigned` (from an unconfigured regeneration when operator Firebase configuration is absent, then restore the committed project), install it on an iOS 27.1 simulator and verify a cold start reaches the first screen with the dark status bar style
- [x] 4.4 Record commands and results in `validation.md`, run `openspec validate --all --strict` and `git diff --check`, and verify both pass
