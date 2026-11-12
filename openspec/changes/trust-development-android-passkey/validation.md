# Validation

## Scope and authorization

OpenSpec: `trust-development-android-passkey`. Isolated branch `fix/trust-development-android-passkey` starts at origin/dev `070e8e35`, after human merge of association PR #590. On 2026-11-12 the requester explicitly chose development-only debug-certificate association to continue Android native testing. Preview, beta and production retain Play-only trust. No UI, authentication endpoint, account data, API deployment, or Mobile version changes are included; the requester already retained Mobile 1.0.29 (804) for phase two.

## Certificate evidence

The new local debug APK was built successfully from the separate phase-two worktree using the installed Android SDK (`ANDROID_HOME=/Users/yjc/Library/Android/sdk SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- build:android --max-workers=2`). The first attempt lacked the SDK path; setting that path resolved the configuration failure without a code workaround. Artifact: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` in that worktree. Build log: `/tmp/slax-passkey-native-test/android-device-build-sdk.log` (1,175 tasks, build successful).

`apksigner verify --print-certs` verified the actual signed APK. Its public development certificate SHA-256 is `A5:4F:11:51:CF:EE:B3:DE:4E:91:C7:03:33:42:52:92:7E:79:5E:F8:EA:21:AA:86:FB:F0:49:84:18:51:53:40`. The digest derives the origin `android:apk-key-hash:pU8RUc_us95OkccDM0JSkn55XvjqIaqG-_BJhBhRU0A`. The artifact package is `com.slax.reader`, version 1.0.29 (804). The task generated a dedicated local, gitignored signing identity rather than trusting a publicly shared template key. Only the certificate fingerprint appears in the diff; no private signing material or existing secret configuration was read or committed.

## Environment selection exercised

A temporary black-box runner calls actual `loadNuxtConfig({dotenv: false})`, passes its public asset directories into the installed Nitro `createNitro`/`copyPublicAssets`, then parses the generated documents. Before the change, development failed the assertion that the debug certificate was present. After the change, all four profiles passed:

| Profile | Android certificates in copied output | Apple association |
| --- | --- | --- |
| development | Play plus the approved local debug certificate | Existing main application only |
| preview | Play only | Existing main application only |
| beta | Play only | Existing main application only |
| production | Play only | Existing main application only |

All profiles also checked the package, credential-sharing-only permission, and absence of extra association entries. The runner uses actual configuration loading and Nitro copying, not a replacement asset-selection implementation. Reports: `/tmp/slax-passkey-native-test/profile-{development,preview,beta,production}.json`; red evidence: `/tmp/slax-passkey-native-test/profile-red.log`; runner: `/tmp/slax-passkey-native-test/check-association-profiles.mjs`. Initial runner setup errors came from CommonJS resolution of an import-only package and loading Nuxt config into standalone Nitro; the runner then used the installed ESM entry with an isolated Nitro root. Those errors were not application test failures.

## Checks and review

Strict OpenSpec validation passed: 140 items, zero failures (`/tmp/slax-passkey-native-test/dev-trust-openspec-validation.log`). The complete Web development-profile build passed (`/tmp/slax-passkey-native-test/dev-trust-web-build.log`). It used explicit synthetic public build inputs, with no existing secret files, and the final output contains both approved certificate fingerprints. That build is for local evidence only and is not manually deployed. The actual Pages runtime (`wrangler pages dev dist --ip 127.0.0.1 --port 4299 --inspector-port 9399 --persist-to /tmp/slax-passkey-native-test/dev-trust-pages-state`) served both well-known paths anonymously as HTTP 200 `application/json` with no redirect. Parsed HTTP responses verified unchanged AASA and the exact two-certificate Android credential-only association. Evidence: `/tmp/slax-passkey-native-test/dev-trust-http-evidence.json`; runtime log: `/tmp/slax-passkey-native-test/dev-trust-pages.log`.

`pnpm --filter @apps/slax-reader-dweb exec eslint nuxt.config.ts` passed with no output. The initial complete Web test run overlapped the full build and had one 10-second auto-import timeout in `tests/unit/composables/useSlaxRoutes.spec.ts`; 2,827 tests passed, three were skipped. Once the build finished, that file passed all six tests without any source change (`/tmp/slax-passkey-native-test/dev-trust-routes-rerun.log`). The complete rerun (`pnpm --filter @apps/slax-reader-dweb exec vitest run --maxWorkers=4`) then passed: 235 files passed, one existing skipped file; 2,828 tests passed, three existing skipped tests, zero failures, in 128.63 seconds. No source or timeout setting was changed. Final log: `/tmp/slax-passkey-native-test/dev-trust-web-tests-final.log`.

A read-only independent Codex review checked Bugs, Security and Compliance, including the installed Nitro copy order and all four profile reports. No code Important finding or Nit was found; it requested this verification record before push; that evidence gap is now closed by the completed checks above. A bounded Claude Code follow-up using exactly `claude-opus-5.5` also reported no Important finding or Nit for this change and the small phase-two Metro correction. The latter reviewed supplied code/context with tools disabled, not an independent runtime execution. Its report is `/tmp/slax-passkey-native-test/claude-native-followup.md`, and JSON model usage confirms the requested model.

## Publication and acceptance limits

Local output serving does not establish live `r.slax.dev` publication or native Android acceptance. The operator must merge/deploy this supporting Draft PR; then the matching APK and local test API origin can complete the native proof. The existing public dev assets from #590 still contain Play-only trust until this change deploys. No beta/production deployment or remote Worker change has been performed. The phase-two feature PR remains unopened until Android hands-on acceptance. This supporting diff has no visible UI or accessibility change, so the UI hands-on checkpoint does not apply to this PR.
