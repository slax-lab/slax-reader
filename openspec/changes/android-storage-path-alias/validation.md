# Validation

## Scope and Authorization

On 2026-11-02 the user authorized local repair and phone installation. After a certificate mismatch prevented an in-place update, the user explicitly authorized uninstalling the old application; local-data and unsynchronized-content loss was disclosed before execution. The user subsequently confirmed the installed repair worked and requested build +1 and a pull request. Source version is now 1.0.26 (798), previousBuildNumber 797. Commit, branch push, and a PR targeting dev are authorized; merge and store publication are not. Only the main worktree remains.

## Baseline

- Repository base: `6deae73c`, task branch `fix/android-storage-path-alias`.
- Affected device: Pixel 9 Pro Fold, Android 17 / API 37, package `com.slax.reader`.
- Original installed build 1.0.26 (797) showed `SlaxLegacy.beginDataOwnership` rejected with `java.lang.IllegalStateException: Database directory requires recovery`.
- The failing check preceded SQLite opening. The exact original raw/canonical app-process path pair was not dumped; the production helper regression demonstrates the old condition rejects an equivalent ancestor alias.

## Automated Checks

- Initial check/bundle attempts found the already-declared `react-native-logs` dependency missing locally. `pnpm install --frozen-lockfile` restored one cached package without changing the lockfile or adding dependencies.
- `pnpm mobile -- check` passed on the repair: architecture, fixtures, TypeScript and 1,262 tests, zero failures or skips. It was rerun successfully after the approved build-798 metadata increment.
- `pnpm mobile -- bundle` passed Android/iOS export for the tested build-797 source; no JavaScript logic changed in the subsequent version-only increment.
- `SLAX_JSON_CLASSPATH=<cached org.json 20180813 jar> node apps/mobile/tests/data/installation-native-host.mjs` passed on the final source. It compiles the actual production resolver and identity helper and exercises missing/existing slots, canonical/alias/mixed spellings, user roots 0/10, native/adopted bindings and journals, invalid records, missing databases, linked files, redirected child directories, mismatched files directories, and synthetic-content preservation. The old guard fails the accepted alias cases.
- `pnpm mobile -- test:native-resources` passed Kotlin and Swift host suites using existing cached Kotlin 2.2.10, OkHttp 4.12.0, Okio 3.6.0 and supporting jars with JDK 17. Initial missing-classpath failure was resolved with those existing public artifacts. This is JVM/macOS host evidence, not native device acceptance.
- `JAVA_HOME=<Homebrew JDK 17> pnpm mobile -- build:android --release -PreactNativeArchitectures=arm64-v8a --max-workers=2 --no-parallel --no-daemon` passed for the repaired build 797. The build-798 rerun also passed (`BUILD SUCCESSFUL`, 1,463 actionable tasks). `apksigner verify` passed; inspected package identity is `com.slax.reader`, 1.0.26 (798), ARM64, SHA-256 `d4157b63ca2d5f6262920a0fe4f410d73b98e862b77921e42385d586f6abcbd0`. This final package was built and inspected, not installed over the accepted test build.
- Native metadata was regenerated through Expo prebuild. Final package, Android, iOS main and iOS share versions agree on 1.0.26 (798), previous build 797. Local Android Firebase plugin drift introduced by configured prebuild was discarded and Android metadata regenerated with `SLAX_MOBILE_NO_LOCAL_CONFIG=1`, retaining only intended version changes.
- Strict change/repository validation and `git diff --check` passed after source changes; final evidence/task edits are validated again before commit.

## Signed Package and Installation

- Original installed public certificate SHA-256: `a105fb8c2e1545c7b8a5c473e52915ef26216517d2951462d47e0f661da911aa`.
- Local repaired release certificate SHA-256: `e5380c48b64c3df69d806299444f042c0b8051e0bcaee66fb8aaf5d58f680563`.
- Tested repaired build-797 APK SHA-256: `6d1754b8af9f496ac9af0ae2bd0a849391d788d88af1b51fa1f0d84f1ef2791c`; 53,410,155 bytes; `com.slax.reader`, 1.0.26 (797), ARM64. `apksigner verify` passed before uninstall.
- Following explicit user authorization, `adb uninstall com.slax.reader` and `adb install <verified repaired APK>` both returned `Success`. A cold `am start -W -n com.slax.reader/.MainActivity` returned `Status: ok`, 264 ms.
- After user acceptance, another force-stop/cold launch returned `Status: ok`, 142 ms. The captured screen showed the authenticated Inbox populated with article rows instead of the recovery error. These timings identify successful launches only, not performance claims.
- This was a fresh installation due to signing mismatch, not a data-preserving upgrade. No claim is made that the old installation's local-only changes survived. No credentials, keys, or preferences were printed or committed.

## Human Hands-on Acceptance

The requesting human tested the repaired build 797 on the affected phone on 2026-11-02 and confirmed it was satisfactory, then requested build +1 and a PR. The accepted change restores the normal saved-data startup flow; no UI redesign was made. The agent independently observed the populated Inbox after a subsequent cold launch. Build 798 changes only the approved version metadata relative to that accepted behavior.

## Review

A focused independent Bugs, Security, and Compliance review of the four production/test files found no Important findings. Both entry points use the fixed resolver; lease semantics and installation identity checks remain unchanged. A second independent review of the entire final diff, new resolver, generated versions, and all six OpenSpec files also found no Important Bugs, Security, or Compliance issues. Build 798 evidence was then finalized. Strict repository validation and `git diff --check` passed again before commit.

## Declared Verification Gaps

- A real data-preserving legacy upgrade, native old queued-write retention/reconnect, and a separately triggered recovery retry were not exercised during this phone test. The authorized reinstall prevents claiming those upgrade outcomes; host regression covers the directory and identity decisions only.
- No iOS device acceptance or iOS native build is claimed; iOS changes are generated version metadata only.
- No store upload, publication, or merge was performed. Archive remains a separate docs PR after merge.
