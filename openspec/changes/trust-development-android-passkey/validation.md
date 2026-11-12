# Validation

## Scope and authorization

OpenSpec: `trust-development-android-passkey`. Isolated branch `fix/trust-development-android-passkey` starts at origin/dev `070e8e35`, after human merge of association PR #590. On 2026-11-12 the requester explicitly chose development-only debug-certificate association to continue Android native testing. The final selection is preview (`r.slax.dev`) only; local development, beta and production retain Play-only trust. No UI, authentication endpoint, account data, API deployment, or Mobile version changes are included; the requester already retained Mobile 1.0.29 (804) for phase two.

## Certificate evidence

The new local debug APK was built successfully from the separate phase-two worktree using the installed Android SDK (`ANDROID_HOME=/Users/yjc/Library/Android/sdk SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- build:android --max-workers=2`). The first attempt lacked the SDK path; setting that path resolved the configuration failure without a code workaround. Artifact: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` in that worktree. Build log: `/tmp/slax-passkey-native-test/android-device-build-sdk.log` (1,175 tasks, build successful).

`apksigner verify --print-certs` verified the actual signed APK. Its public development certificate SHA-256 is `A5:4F:11:51:CF:EE:B3:DE:4E:91:C7:03:33:42:52:92:7E:79:5E:F8:EA:21:AA:86:FB:F0:49:84:18:51:53:40`. The digest derives the origin `android:apk-key-hash:pU8RUc_us95OkccDM0JSkn55XvjqIaqG-_BJhBhRU0A`. The artifact package is `com.slax.reader`, version 1.0.29 (804). The task generated a dedicated local, gitignored signing identity rather than trusting a publicly shared template key. Only the certificate fingerprint appears in the diff; no private signing material or existing secret configuration was read or committed.

## Initial verification (superseded environment assumption)

A temporary black-box runner calls actual `loadNuxtConfig({dotenv: false})`, passes its public asset directories into the installed Nitro `createNitro`/`copyPublicAssets`, then parses the generated documents. Before the change, development failed the assertion that the debug certificate was present. The first implementation used an incorrect deployment assumption: it associated `r.slax.dev` with the local `development` profile. The following initial results passed against that incorrect expectation and do not establish the corrected deployment behavior:

| Profile | Android certificates in copied output | Apple association |
| --- | --- | --- |
| development | Play plus the approved local debug certificate | Existing main application only |
| preview | Play only | Existing main application only |
| beta | Play only | Existing main application only |
| production | Play only | Existing main application only |

All profiles also checked the package, credential-sharing-only permission, and absence of extra association entries. The runner uses actual configuration loading and Nitro copying, not a replacement asset-selection implementation. Reports: `/tmp/slax-passkey-native-test/profile-{development,preview,beta,production}.json`; red evidence: `/tmp/slax-passkey-native-test/profile-red.log`; runner: `/tmp/slax-passkey-native-test/check-association-profiles.mjs`. Initial runner setup errors came from CommonJS resolution of an import-only package and loading Nuxt config into standalone Nitro; the runner then used the installed ESM entry with an isolated Nitro root. Those errors were not application test failures.

## Initial checks and review

Strict OpenSpec validation passed: 140 items, zero failures (`/tmp/slax-passkey-native-test/dev-trust-openspec-validation.log`). The complete Web development-profile build passed (`/tmp/slax-passkey-native-test/dev-trust-web-build.log`). It used explicit synthetic public build inputs, with no existing secret files, and the final output contains both approved certificate fingerprints. That build is for local evidence only and is not manually deployed. The actual Pages runtime (`wrangler pages dev dist --ip 127.0.0.1 --port 4299 --inspector-port 9399 --persist-to /tmp/slax-passkey-native-test/dev-trust-pages-state`) served both well-known paths anonymously as HTTP 200 `application/json` with no redirect. Parsed HTTP responses verified unchanged AASA and the exact two-certificate Android credential-only association. Evidence: `/tmp/slax-passkey-native-test/dev-trust-http-evidence.json`; runtime log: `/tmp/slax-passkey-native-test/dev-trust-pages.log`.

`pnpm --filter @apps/slax-reader-dweb exec eslint nuxt.config.ts` passed with no output. The initial complete Web test run overlapped the full build and had one 10-second auto-import timeout in `tests/unit/composables/useSlaxRoutes.spec.ts`; 2,827 tests passed, three were skipped. Once the build finished, that file passed all six tests without any source change (`/tmp/slax-passkey-native-test/dev-trust-routes-rerun.log`). The complete rerun (`pnpm --filter @apps/slax-reader-dweb exec vitest run --maxWorkers=4`) then passed: 235 files passed, one existing skipped file; 2,828 tests passed, three existing skipped tests, zero failures, in 128.63 seconds. No source or timeout setting was changed. Final log: `/tmp/slax-passkey-native-test/dev-trust-web-tests-final.log`.

A read-only independent Codex review checked Bugs, Security and Compliance, including the installed Nitro copy order and all four profile reports. No code Important finding or Nit was found; it requested this verification record before push; that evidence gap is now closed by the completed checks above. A bounded Claude Code follow-up using exactly `claude-opus-5.5` also reported no Important finding or Nit for this change and the small phase-two Metro correction. The latter reviewed supplied code/context with tools disabled, not an independent runtime execution. Its report is `/tmp/slax-passkey-native-test/claude-native-followup.md`, and JSON model usage confirms the requested model.

## Publication and acceptance limits

Local output serving does not establish live `r.slax.dev` publication or native Android acceptance. The operator must merge/deploy this supporting Draft PR; then the matching APK and local test API origin can complete the native proof. The existing public dev assets from #590 still contain Play-only trust until this change deploys. No beta/production deployment or remote Worker change has been performed. The phase-two feature PR remains unopened until Android hands-on acceptance. This supporting diff has no visible UI or accessibility change, so the UI hands-on checkpoint does not apply to this PR.


## Corrected public-test environment mapping

The requester clarified that `r.slax.dev` corresponds to Web `preview`; `development` is local-only. Non-Play Android packages are test packages using `r.slax.dev`. The existing release source confirms `dev` → `preview` / `r.slax.dev`, `beta` → `beta` / `r-beta.slax.com`, and `main` → `production` / `r.slax.com`; `buildWeb` injects that profile as `SLAX_ENV`. The agent had misread this mapping in the original implementation/review. PR #592 remains open; this correction does not require a new PR or change any deployment script.

The corrected runner first reproduced the defect using actual `releaseInputs(TARGET_BRANCH=dev)` and failed because the preview output lacked the test certificate. The source now selects `public-preview` only when the existing Web profile is `preview`. It does not change certificate contents, Apple association, Mobile binaries/version, backend auth, or client feature visibility. Subsequent actual release-input/config/Nitro-copy checks passed:

| Invocation | Selected Web profile | Android certificates |
| --- | --- | --- |
| `TARGET_BRANCH=dev` | preview (`r.slax.dev`) | Play plus approved local test certificate |
| Local `SLAX_ENV=development` | development | Play only |
| `TARGET_BRANCH=beta` | beta | Play only |
| `TARGET_BRANCH=main` | production | Play only |

All four retained the original AASA and credential-only Android permission. Reports: `/tmp/slax-passkey-native-test/corrected-profile-{preview,development,beta,production}.json`; runner: `/tmp/slax-passkey-native-test/check-association-profiles-preview.mjs`; red log: `/tmp/slax-passkey-native-test/preview-correction-red.log`.

`node --test tooling/web-pages-deploy.test.mjs` passed 33 tests with two existing skips, including actual branch/profile mapping and the build environment contract (`/tmp/slax-passkey-native-test/preview-correction-deploy-tests.log`). Targeted config ESLint passed (`/tmp/slax-passkey-native-test/preview-correction-eslint.log`). The full Web build using the actual `tooling/web-pages-deploy.mjs build` entry with `TARGET_BRANCH=dev` and explicit synthetic public inputs passed (`/tmp/slax-passkey-native-test/preview-correction-web-build.log`, ending `Web Pages build passed`). A fresh Pages runtime on port 4300 anonymously returned HTTP 200 `application/json` without redirects for both well-known documents; parsed responses verified the unchanged AASA and exact two-certificate preview document (`/tmp/slax-passkey-native-test/preview-correction-http-evidence.json`). The earlier Pages process watched build output while it was being regenerated and exited after watcher errors; the fresh runtime started only after the final build completed. This required no source workaround. Existing full Web unit results above preceded this profile correction and are not relabeled as a fresh rerun.

The test certificate can stay while the matching signed non-Play package is used for testing. An explicit later cleanup can remove that fingerprint; neither automatic rollback nor reverting the entire association PR is needed. Android native acceptance still waits for corrected public deployment.

A focused independent Codex follow-up checked the complete branch/profile/env-loader/Nuxt selection chain and corrected output files, acknowledging the earlier mistaken assumption. It found no remaining Important finding or Nit. The GitHub automated review independently identified the same wrong-profile Important issue; this correction addresses it with branch-derived runtime evidence. Non-blocking suggestions to generate shared JSON or add a broader asset abstraction are not adopted for this one-document static override.

Strict validation after the mapping correction passed all 140 items (`/tmp/slax-passkey-native-test/preview-correction-openspec.log`). A bounded Claude Code review with exactly `claude-opus-5.5` found no Important defect; its wording nit was corrected. The pre-existing change/capability identifiers are retained to avoid renaming this in-flight PR, while their requirements now explicitly state preview/test-domain semantics. Its initially pending Pages/OpenSpec evidence is completed above. Report: `/tmp/slax-passkey-native-test/claude-preview-correction.md`.
