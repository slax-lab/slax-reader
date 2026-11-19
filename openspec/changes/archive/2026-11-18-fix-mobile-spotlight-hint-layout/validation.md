# Validation

## Scope and approval

- Change: `fix-mobile-spotlight-hint-layout`.
- The requesting human approved the proposal in conversation on 2026-11-17 and explicitly requested narrow-screen and enlarged-text coverage, screenshots, and a PR.
- Implementation branch: `fix/fix-mobile-spotlight-hint-layout`, based on `origin/dev` at `155f91352233987170899353f4c7ea8565b1e5e4`.
- The original checkout and its unrelated changes remain untouched. The task implementation lives in the dedicated managed worktree.
- The optional design document was omitted for this single-view layout correction, as documented in `tasks.md`.

## Implementation

- Unsupported Spotlight guidance is a separate full-width text block below the system-search title, with no line limit or fixed text height.
- System-search and donation titles take the available row width so the native switches retain space while text wraps.
- Existing translations, capability gates, switch labels and handlers, and preference persistence are unchanged.
- Only the Mobile source light profile is affected; no new color, typography, or spacing token is introduced.

## Automated verification

- `pnpm mobile -- typecheck`: passed.
- `EXPO_NO_DOTENV=1 pnpm mobile -- bundle`: passed; both iOS and Android bundles exported. Dotenv reading was explicitly disabled.
- Settings/account host suite: 40 passed, 0 failed. Command: `NODE_PATH="$PWD/node_modules/.pnpm/happy-dom@20.14.5/node_modules:$PWD/node_modules/.pnpm/abort-controller@3.0.0/node_modules" node --experimental-strip-types --test apps/mobile/tests/ui/settings-account.test.mjs`.
- `pnpm exec openspec validate --all --strict`: 137 passed, 0 failed.
- `git diff --check`: passed.
- Plain `pnpm mobile -- check` stops in the existing RSS controller verifier because its React Native-relative `abort-controller` lookup is unavailable in the filtered dependency installation. The installed lockfile package is available; an explicit `NODE_PATH` lets the verifier run successfully, without changing source or dependency manifests.
- Initial unmodified-environment full suite: 754 passed, 36 failed, 320 skipped. Failures include missing test-host dependency resolution, absent Kotlin tools, unavailable native/runtime context, and loopback network permission denials. The complete check was rerun with both installed host dependency paths: 1,270 passed, 14 failed, 7 skipped (1,291 tests). The remaining 14 failures are listed below; each is blocked by missing `kotlinc` or loopback `EPERM`, not by an assertion against Settings layout.

## Running-environment and screenshot status

The requesting human reported on 2026-11-17 that they had tested the implemented change and confirmed it meets expectations, then explicitly requested the PR. This is post-implementation hands-on acceptance; no further layout adjustment was requested. Device model, iOS version, locales, widths, text sizes and appearance modes were not supplied, so no specific matrix coverage is inferred.

Screenshots are omitted by explicit human direction because this is a simple text-layout adaptation. The following are the limitations of the earlier agent screenshot attempt, not outstanding approval gates. This record does not claim that host tests or bundle compilation prove native geometry or font scaling.

- `xcrun simctl list devices booted` fails with an invalid CoreSimulatorService connection, including when requested with elevated execution.
- `/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app` is absent on this host.
- A temporary preview was prepared from the actual `SettingsView.tsx`, translations, and theme with browser adapters for native components. It is not a native rendering.
- Local HTTP binding is denied (`EPERM`); the headless browser cannot register its required Mach service under the current execution restrictions.
- Browser Use rejected the local-file preview URL: only HTTP and HTTPS protocols are allowed. No workaround was attempted after this explicit rejection.
- No screenshot was produced, attached, or claimed as acceptance evidence.

Agent-unverified native matrix (not claimed by the general human acceptance): Chinese and English on 320/375-point narrow viewports, enlarged system text, full requirement-message visibility, supported iOS switch operation, independent donation controls, and comparison under light/dark system appearance while preserving the source light profile.

## Local review and delivery gates

- Bugs pass: the scoped diff keeps the unavailable message exclusive to the existing unavailable branch and retains capability gates and switch callbacks. Text has content-driven height. No code-level Important finding identified by inspection.
- Security pass: no new I/O, native API, dependency, data publication, credential access, or permission change.
- Compliance pass: proposal approval and the requesting human's post-implementation acceptance are recorded. The human explicitly overrides screenshot delivery for this simple change. Agent-native matrix gaps remain declared.
- Mobile version decision: the requesting human explicitly approved `1.0.32`, build `807`, previous build `806`, on 2026-11-17. Matching native metadata is regenerated through Expo; this PR does not itself sign or upload a release.
- Human hands-on acceptance: the requesting human, 2026-11-17, tested the implemented UI and confirmed it meets expectations. No adjustment requested; detailed native matrix coverage was not supplied.
- Delivery: task PR authorized; no signing, upload, publication, or archive is performed by this task.

## Full-check failures after resolving host dependencies

Command: `NODE_PATH="$PWD/node_modules/.pnpm/happy-dom@20.14.5/node_modules:$PWD/node_modules/.pnpm/abort-controller@3.0.0/node_modules" pnpm mobile -- check`. Architecture, fixture verification, RSS verification, and typecheck completed; the test stage exited 1.

- `tests/data/file-store.test.mjs:19:1` — actual Kotlin file storage enforces atomic writes, bounded reads, paths and account replacement: missing `kotlinc` (`ENOENT`).
- `tests/data/image-registry-native.test.mjs:23:1` — actual Kotlin shared image registry deduplicates policy-scoped HTTP, cancellation and streaming atomic retention: missing `kotlinc` (`ENOENT`).
- `tests/data/image-registry-native.test.mjs:37:1` — actual Swift shared image registry deduplicates policy-scoped HTTP, cancellation and streaming atomic retention: loopback server binding denied (`EPERM`).
- `tests/data/offline-engine-android.test.mjs:91:1` — actual Kotlin offline engine matches HTML extraction fixtures and acquires, revokes and evicts native caches: loopback server binding denied (`EPERM`).
- `tests/data/offline-engine-native.test.mjs:79:1` — actual Swift offline engine matches HTML extraction fixtures and acquires, revokes and evicts native caches: loopback server binding denied (`EPERM`).
- `tests/data/pdf-transfer-native.test.mjs:59:1` — actual Kotlin pull transport bounds chunks, rejects redirects and drains cancellation under real HTTP: loopback server binding denied (`EPERM`).
- `tests/data/pdf-transfer-native.test.mjs:70:1` — actual Swift pull transport bounds chunks, rejects redirects and drains cancellation under real HTTP: loopback server binding denied (`EPERM`).
- `tests/diagnostics/feedback-wire.test.mjs:9:1` — real loopback HTTP receives legacy JSON then one consented sanitized NDJSON attachment: loopback server binding denied (`EPERM`).
- `native/share/tests/android-diagnostics.test.cjs:17:1` — actual Kotlin diagnostic records and writer retain bounded private terminals with hostile sender metadata: missing `kotlinc` (`ENOENT`).
- `tests/share-native/android-intent.test.cjs:22:1` — production Android share completion closes without animation and preserves replacement ownership: missing `kotlinc` (`ENOENT`).
- `native/share/tests/android-transport.test.cjs:22:1` — actual Kotlin share HTTP transport enforces deadlines, exists recovery and cancellation: missing `kotlinc` (`ENOENT`).
- `tests/ui/pdf-http-fixture.test.mjs:27:1` — actual loopback HTTP enforces authorization, ranges and metadata 404 versus offline cache fallback: loopback server binding denied (`EPERM`).
- `tests/ui/pdf-http-fixture.test.mjs:61:1` — slow HTTP range is truly pending and aborts without claiming completion: loopback server binding denied (`EPERM`).
- `tests/ui/pdf-import-runtime.test.mjs:153:1` — HTTP fixture composes real HTTP with the production offline coordinator and requires native PDF owner context: loopback server binding denied (`EPERM`).

## Final version and pre-push review

- The requesting human explicitly approved Mobile `1.0.32 (807)` after the implementation was prepared; `previousBuildNumber` is `806`.
- Ran `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- prebuild --no-install`. Version/runtime outputs were generated by Expo. Unrelated Podfile configuration and associated-domain ordering changes caused by the configuration-free prebuild were restored to HEAD.
- Verified package version/bounds, Android Gradle/manifest/runtime, iOS main/share Info.plist, share project build settings, and Expo runtime metadata agree with `1.0.32 (807)`.
- Read-only reviewer completed Bugs, Security and Compliance passes: no Important findings and no Nits. The reviewer did not claim static review proves native geometry or repeat the ongoing test run.
- The user-directed screenshot omission and human-reported testing supersede the original screenshot delivery task; specific agent-unverified native matrix coverage remains a declared gap.

## Final checks on version 1.0.32 (807)

- Full `pnpm mobile -- check` with the same `NODE_PATH` completed architecture/fixture/RSS verification and typecheck, then reported **1,272 passed, 12 failed, 7 skipped** (1,291 tests). Remaining failures report missing `kotlinc` or native temporary-directory cleanup `EPERM`; this is not an all-green suite. The earlier failures above are retained as historical attempt evidence.
- The ordinary bundle output path could not remove an existing `dist/assets` directory (`EPERM`). `EXPO_NO_DOTENV=1 pnpm mobile -- bundle --output-dir /private/tmp/slax-spotlight-layout/bundle-807` then passed for **both iOS and Android** using a fresh task-owned output directory.
- `pnpm exec openspec validate --all --strict` and scoped `git diff --check` passed after version regeneration.

### Final failed tests

- `tests/data/file-store.test.mjs:19:1` — actual Kotlin file storage enforces atomic writes, bounded reads, paths and account replacement: native temporary-directory cleanup denied (`EPERM`).
- `tests/data/file-store.test.mjs:27:1` — actual Swift file storage enforces atomic writes, bounded reads, paths and account replacement: native temporary-directory cleanup denied (`EPERM`).
- `tests/data/image-registry-native.test.mjs:23:1` — actual Kotlin shared image registry deduplicates policy-scoped HTTP, cancellation and streaming atomic retention: native temporary-directory cleanup denied (`EPERM`).
- `tests/data/image-registry-native.test.mjs:37:1` — actual Swift shared image registry deduplicates policy-scoped HTTP, cancellation and streaming atomic retention: native temporary-directory cleanup denied (`EPERM`).
- `tests/data/offline-engine-android.test.mjs:91:1` — actual Kotlin offline engine matches HTML extraction fixtures and acquires, revokes and evicts native caches: native temporary-directory cleanup denied (`EPERM`).
- `tests/data/offline-engine-native.test.mjs:79:1` — actual Swift offline engine matches HTML extraction fixtures and acquires, revokes and evicts native caches: native temporary-directory cleanup denied (`EPERM`).
- `tests/data/pdf-transfer-native.test.mjs:59:1` — actual Kotlin pull transport bounds chunks, rejects redirects and drains cancellation under real HTTP: missing `kotlinc` (`ENOENT`).
- `tests/data/pdf-transfer-native.test.mjs:70:1` — actual Swift pull transport bounds chunks, rejects redirects and drains cancellation under real HTTP: native temporary-directory cleanup denied (`EPERM`).
- `tests/data/storage-lifecycle.test.mjs:9:1` — production Swift ownership, bounded activities and accepted schema execute with synthetic UIKit boundary: native temporary-directory cleanup denied (`EPERM`).
- `native/share/tests/android-diagnostics.test.cjs:17:1` — actual Kotlin diagnostic records and writer retain bounded private terminals with hostile sender metadata: missing `kotlinc` (`ENOENT`).
- `tests/share-native/android-intent.test.cjs:22:1` — production Android share completion closes without animation and preserves replacement ownership: missing `kotlinc` (`ENOENT`).
- `native/share/tests/android-transport.test.cjs:22:1` — actual Kotlin share HTTP transport enforces deadlines, exists recovery and cancellation: missing `kotlinc` (`ENOENT`).

## Archive

Archived on 2026-11-18 in a separate documentation PR after task PR #630 merged into `dev`. All tasks were complete before archiving.

- Spec sync: created `openspec/specs/mobile-system-search-settings/spec.md` from 1 added requirement.
- Archive verification: `openspec validate --all --strict` passed (150 passed, 0 failed) and the staged whitespace check (`git diff --cached --check`) passed.
