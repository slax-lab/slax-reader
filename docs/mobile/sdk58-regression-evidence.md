# SDK 58 stage 7 regression evidence

This evidence covers only checks run on 2026-10-20 in the originally named `mobile-sdk58-native-experiences` task worktree, now tracked by OpenSpec `update-expo-58`. It does not complete OpenSpec task 7.

## Passed

- `pnpm mobile -- test:native-resources` passed for production Kotlin resource code on the host JVM and production Swift resource code on macOS. These are host checks, not app/device acceptance. Public Kotlin 2.2.21, annotations 13.0, OkHttp 4.12.0 and Okio 3.6.0 jars were used. The missing public Kotlin reflection jar was downloaded to the ignored task-local `.local/native-resource-runtime/` directory; no project dependency or lockfile was changed.
- The task-owned Android API 34 ARM64 AVD booted on emulator port 5584. The existing signed validation APK at `.local/sdk58-runtime-validation.apk` installed with package `com.slax.reader`, version `1.0.25` / code `772`.
- Android package resolution for `ACTION_SEND` with `text/plain` includes `com.slax.reader/.extension.ShareActivity`. An explicit synthetic `ACTION_SEND` intent started that activity and the app process remained alive; the captured logcat window contained no `AndroidRuntime`, `ReactNativeJS`, or fatal exception entries.

## Still unverified

- The headless AVD screenshot after opening `ShareActivity` showed the launcher backdrop/black surface. A follow-up state check showed the emulator awake, its display on, keyguard unrestricted, and `ShareActivity` resumed. The activity uses a translucent window, so the screenshot alone does not establish an app rendering failure. Back input left `ShareActivity` resumed. Device Hub and the CUA app inventory expose only iOS simulators on this host, with no Android emulator window available for direct visual inspection; therefore the share UI, received URL/title/account, signed-out result, and cancellation outcome remain unverified. This is inconclusive, not a pass or an app-failure finding.
- No authenticated provider account was used. Google/Apple callbacks, configured Firebase, IAP purchase/cancel/restore, Reader navigation/scrolling, cached-content offline relaunch, sync replacement, image actions, and baseline performance regressions remain unverified here. No credentials, agreements, purchases, or mock provider callbacks were used.
- The pre-existing signed-out base screenshot `/tmp/slax-sdk58-android-base.png` is prior evidence only; startup was not repeated as a standalone regression.
- No Android predictive-back commit/cancel gesture or HTML/PDF fixture was exercised. The installed APK is the normal signed Release validation artifact and contains no separately prepared authenticated Reader fixture state.
- The task AVD was shut down after evidence collection to release memory.

## Reproduction notes

The task AVD definition is `slax-sdk58-native-experiences-api34` at `.local/sdk58-api34-avd`; use only emulator port 5584. The native-resource script consumes `SLAX_KOTLIN_COMPILER_CLASSPATH`, `SLAX_KOTLIN_STDLIB`, and `SLAX_OKHTTP_CLASSPATH`; set them to the existing public toolchain jars and the task-local Kotlin reflection jar before running the command above. Keep `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1` set.
