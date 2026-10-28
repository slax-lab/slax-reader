# Validation

Branch `feat/mobile-native-smoothness`. From 2026-10-23 to 2026-10-26 the work stayed local, and each round went to the owner as a TestFlight build. On 2026-10-27 the owner instructed: build TestFlight 790, push the branch and open the pull request against `dev`. The branch merges `origin/dev` at `79491af2`. The checks below were re-run on that merged commit.

## Automated checks (agent-run)

| Command | Result |
|---|---|
| `pnpm exec openspec validate --all --strict` | 79 passed, 0 failed (after the `origin/dev` merge) |
| `pnpm exec rulesync generate --check` (after `pnpm agent:sync`) | up to date |
| `pnpm mobile -- typecheck` | pass |
| `node apps/mobile/tooling/architecture-check.mjs` | 0 violations, 3 existing exceptions |
| `pnpm mobile -- check` (architecture, assets, fixtures, RSS verify, typecheck, unit/mounted/native-host suites) | Merged commit: 1144 tests, 1144 pass, 0 fail, 0 skipped. Earlier rounds: 1112, 1118, 1120, 1129, 1130, 1146 |
| `pnpm mobile -- bundle` | Android and iOS JS export succeeded |
| `pnpm mobile -- test:native-resources` (Kotlin + Swift host resources) | pass, using local Kotlin/OkHttp jars supplied through `SLAX_KOTLIN_COMPILER_CLASSPATH`, `SLAX_KOTLIN_STDLIB`, `SLAX_OKHTTP_CLASSPATH` |
| `pnpm mobile -- build:android` (assembleDebug) | BUILD SUCCESSFUL |
| `pnpm mobile -- pods`, then `xcodebuild … -sdk iphonesimulator … CODE_SIGNING_ALLOWED=NO build` | BUILD SUCCEEDED |
| `git diff --check` | clean |

New or rewritten suites cover these areas:
- the offline coordinator: plan diffs, one-transaction batches, at most two download-state writes, eviction, migration acknowledgement, generation-scoped 401, suspend/resume, stale owners;
- golden HTML image-URL extraction parity, shared by JS, Swift and Kotlin (25 cases);
- iOS and Android engine hosts against a loopback HTTP server: migration, 401 recovery, retry, denied, image paths identical to the Reader's, PDF windows/full/metadata/404, usage/evict/clear, status coalescing, no token in events, owner change mid-download;
- primary-key Spotlight identifiers with legacy resolution;
- the single-pan drawer (edge vs full hit areas, no list relations, scrim released on resolved close, interrupted close);
- row swipe (haptic once, velocity settle, taps never swallowed);
- FeedList sampling and constant list settings;
- Reader transition gating, direct HTML presentation, once-only restore, template byte parity, inset dedupe and Android UI-thread height;
- context split identity, background-only pause and system-surface deferral.

## Runtime hashing

`grep` across `apps/mobile/src` and `apps/mobile/modules` finds no SHA on startup, catalog, offline, avatar or reading paths. What remains is allowed by the delta spec:
- one-time legacy KMP adoption and legacy-preference import checksums in `modules/slax-legacy`, which never run on a normal launch;
- static reviewed-evidence constants in `adoption-profile.ts` and `controlled-upgrade-visibility.ts`.

The KMP-compatible MD5 image filename helper is a path function, not a content hash, and is unchanged.

## Not verified in a running environment

- The agent drove no simulator, emulator or physical device. The owner said not to run them after an earlier device session froze the test phone.
- Device acceptance comes from the owner's hands-on reviews, recorded under "Owner acceptance" below. On 2026-10-27 the owner confirmed acceptance of every item.

## Delivery

TestFlight preview **1.0.25 (785)**: build bumped from 784, previous bound 784. iOS prebuild and pods were regenerated, then the guarded archive, export and Xcode upload all succeeded. Apple reported the uploaded package as processing at 2026-10-23 11:01:30 UTC. App Store Connect processing and tester availability are not independently confirmed. Later builds are recorded under Owner acceptance.

## Owner acceptance

- 2026-10-23, owner, TestFlight 785: Library list scrolling still jittered and dropped frames. The adjustments under task 5.5 went into build 786. They are fixed separator-inclusive `getItemLayout`, a plain `FlatList`, rows that are cheap at rest, Library row updates held while scrolling, and a memoized header. `pnpm mobile -- check` passes 1120/1120. TestFlight **1.0.25 (786)** was uploaded at 2026-10-23 14:59:19 UTC and Apple reported it processing.
- 2026-10-24, owner, TestFlight 786: confirmed the Library list no longer jitters or drops frames while scrolling. No further adjustments were requested.
- 2026-10-24, owner, TestFlight 786: two further Reader issues.
  - The back button jumped when the Reader opened.
  - Cached articles were slow to appear.

  Task 7.5 fixes both: a static Reader navigation bar, a foreground native read queue running concurrently with the record lookup, immediate iOS host mounting, Reader/WebKit prewarm, and a 120 ms cover fade. `pnpm mobile -- check` passes 1129/1129, and the Android assemble and iOS simulator build succeed. TestFlight **1.0.25 (787)** was uploaded at 2026-10-24T08:53:44.087Z and Apple reported it processing.
- 2026-10-24, owner, TestFlight 787: switching RSS sources forced a scroll-to-top animation.
  - **Cause:** the shared `FeedList` kept `maintainVisibleContentPosition` with `autoscrollToTopThreshold: 1` constant, so a swapped source looked like a prepend.
  - **Fix (task 5.6):** a `contentScope` suspends visible-position adjustment until the replacement renders.
  - **Checks:** `pnpm mobile -- check` passes 1130/1130, including a new FeedList scope test and an updated RSS switch test.
  - **Delivery:** TestFlight **1.0.25 (788)** was uploaded at 2026-10-24T12:23:20.936Z and Apple reported it processing.
- 2026-10-26, owner, TestFlight 788: four Reader issues.
  1. The outline and overview animations were missing.
  2. Outline Markdown rendered incorrectly.
  3. The back button should hide with More.
  4. A transparent strip appeared at the top on iOS Liquid Glass.

  Task 7.6 covers them:
  - **Root cause of (1):** the Markdown WebView was mounted mid-transition, and KMP's loaders and overview grow animation were never ported. This branch did not cause it.
  - **Fix:** settle-gated Markdown mounting, the ported loaders and the overview grow.
  - markdown-it rendering.
  - A KMP-style navigator bar, with the matching spec exception in `mobile-native-navigation` and `mobile-visual-parity`.
  - Hidden iOS 26 scroll-edge effects.

  Verification:
  - `pnpm mobile -- check` passes 1146/1146.
  - Bundle, Android assemble and iOS simulator builds succeed.
  - The `pnpm install --frozen-lockfile` check passes.

  TestFlight **1.0.25 (789)** was uploaded at 2026-10-26T08:19:46.049Z and Apple reported processing.
- 2026-10-26, owner: did not approve item (3), the custom navigator bar that replaced the native header. It is reverted to the build-788 native header (transparent, fixed More slot, native back). Items 1, 2 and 4 are kept: scroll-edge effects stay hidden. The spec exception for a custom back control is withdrawn. `pnpm mobile -- check` passes 1144/1144, the bundle builds and the iOS simulator build succeeds. TestFlight 789 still contains the reverted bar and is superseded.
- 2026-10-27, owner: instructed the agent to build TestFlight, push the branch and open the pull request. This is the owner's decision to open the pull request before the remaining hands-on acceptance listed under "Not verified". It is not itself an acceptance record. TestFlight **1.0.25 (790)**, the merged and reverted state, was uploaded at 2026-10-27T02:34:49.518Z.
- 2026-10-27, owner: articles with external resources waited for those resources before showing. **Cause:** the initial restore, which lifts the cover, was gated on the WebView load event, so it waited on every subresource. **Fix (task 7.8):** the restore is gated on DOM readiness plus the first height, with a one-time re-apply for late growth and a 1.5 s cover timeout. `pnpm mobile -- check` passes 1154/1154 and the bundle exports. TestFlight **1.0.25 (791)** carries the fix and supersedes 790. It was uploaded at 2026-10-27T03:13:41.892Z and Apple reported it processing.
- 2026-10-27, owner, review of 791:
  - Remove the automatic position re-apply and keep the position fixed until the user scrolls.
  - Drop the back-button/More hiding requirement.
  - Show the HTML as soon as it is ready, with no loading cover and no timeout.

  The cover, re-apply and timeout are removed; the saved position is restored once at DOM readiness. `pnpm mobile -- check` passes 1146/1146 and the bundle exports. TestFlight **1.0.25 (792)** carries this; it was uploaded at 2026-10-27T04:49:41.160Z and Apple reported it processing.
- 2026-10-27, owner, review of 792: already-downloaded articles flashed on open, and PDFs loaded slowly whether downloaded or not. The owner approved fixing the flash and moving PDF bytes off the JS bridge. Downloaded PDFs must not refresh metadata over the network. Task 7.9:
  - **Article flash.** Cause: the skeleton was removed as soon as the host mounted, which showed the blank transparent WebView and then the jump from the top. Fix: the skeleton stays over the host until DOM readiness, the once-only restore and one painted frame. There is no load-event wait and no timeout.
  - **PDF slowness, cause 1:** every open fetched metadata over the network first. Fix: a complete local PDF opens from its cached descriptor with no network request.
  - **PDF slowness, cause 2:** every byte passed through the RN bridge with base64. Fix: ranges are served natively and same-origin, via `slaxpdf://` on iOS and the intercepted https origin on Android.
  - **PDF slowness, cause 3:** foreground reads shared the background PDF queue. Fix: dedicated foreground queues and transfer slots.
  - **Checks:** `pnpm mobile -- check` passes 1156/1156. The bundle exports, and `test:native-resources` and the Swift/Kotlin engine host tests pass. These cover range semantics, owner rejection, cancellation, no metadata request for complete PDFs, and foreground service under a saturated background. `pnpm mobile -- build:android` and the iOS simulator build succeed.
  - **Extra check:** a real macOS WKWebView loaded the composed iOS PDF document at `slaxpdf://pdf/` with the real handler and engine. It rendered pages and text with no byte messages to React Native.
  - **Consequence recorded:** Dev UI fixtures can no longer render PDFs on a device.
  - **Packaged:** after the push, the owner asked for a TestFlight build. Build `1.0.25 (793)` was archived, exported and uploaded at 2026-10-27T09:37:54.066Z.
  - **Pre-push review fixes:**
    - Android `servePdfRange` now settles its reply when its queued lane job is cancelled. Before, a session shutdown between queueing and running left the reply unanswered, and the WebView request thread waited 150 s. A Kotlin host case queues a remote range behind the control thread, then closes the session; it fails without the fix and passes with it.
    - The Reader skeleton tracks the presented page by its page identity, not only the host key. A forced reload that publishes new HTML under the same host key stays covered until its own page is presentable. The host test fails without the fix and passes with it.
    - A failed status-persistence transaction re-queues its batch, and newer pending states win. It retries with backoff from 250 ms to 5 s, and a revoked owner drops it. Two coordinator tests cover this.
    - Re-run: `pnpm mobile -- check` passes 1158/1158. `pnpm mobile -- bundle` exports, `pnpm mobile -- build:android` succeeds, and the iOS simulator `xcodebuild` succeeds.
- 2026-10-27T09:54Z, owner (DGuang21), hands-on review of TestFlight 1.0.25 (793) on iOS: "现在不闪了，打开也很快" (it no longer flashes, and it opens quickly). The owner accepted the Reader open flash fix and the opening speed, and asked to update the pull request. No adjustment was requested.
- 2026-10-27, owner (DGuang21): "验收我已经全部都看过了的" (I have already checked all of the acceptance items). Every item of this change is accepted. The owner also said that per-build TestFlight receipts and `docs/mobile/release.md` updates are not needed, so this change adds none.

## 2026-10-28 approved regression repairs

The owner requested three repairs after the read-only review: restore automatic cache pause/resume semantics with reference to the previous KMP client, recover from generic native HTML load failures instead of leaving a skeleton, and keep list publication protection throughout a held drag. These restore the existing lifecycle, native-failure and interaction contracts; no layout or architecture redesign is introduced. The separate branch `fix/mobile-lifecycle-recovery` starts at `origin/dev` commit `870d9bb6`. After fetching the latest dev reference, its Mobile source was identical to the previously reviewed `c9b814d4` Mobile source.

The previous KMP `BackgroundDomain.startup()` is idempotent and `cleanup()` cancels its worker scope. Its current `Navigation.kt` invokes these for authenticated entry/account replacement/sign-out; `LifeCycleHelper.kt` publishes lifecycle events. This repair does not claim that those files wire every foreground/background cache transition. The Expo app keeps its existing background-only native suspend/resume and retained plan, and re-arms idempotent warmup after foreground return so initial presentation interruption or admission in the background cannot leave the cache watches unstarted.

Implemented and exercised in the existing mounted-host/in-memory environment:
- Initial warmup survives backgrounding before Library presentation and admission completed in the background. Account/database/cache identities remain stable; real coordinator repeated start does not register watches again or reopen native state.
- Native HTML load errors are distinct from ordinary operation failures. They invalidate the failed host, cancel a pending presentable frame, uncover the retry surface and allow an explicit same-content remount at the saved position. Generic load failure does not automatically retry on foreground; existing bounded process-crash recovery is retained.
- A held drag never uses the 250 ms released-scroll idle fallback. A stale momentum-end/idle callback cannot release a new held drag. Covering/backgrounding or unmounting the feed releases interrupted activity. Existing native FlatList, UI-thread gesture/animation ownership, list batching and scroll sampling remain unchanged.

Final verification:
- `pnpm mobile -- check`: 1163 passed, 0 failed, 0 skipped; typecheck, architecture, assets and RSS checks passed.
- `pnpm mobile -- bundle`: iOS and Android exports passed.
- `pnpm mobile -- test:native-resources`: initially required missing classpath variables; rerun with existing public Gradle-cache Kotlin/OkHttp/Okio jars passed both JVM and macOS Swift resource hosts. No dependency was installed and no application secrets were accessed.
- `pnpm exec openspec validate --all --strict`: 81 passed, 0 failed.
- `git diff --check`: passed.
- Local Bugs/Security/Compliance review: no additional Important finding in this repair diff. Native workers, network endpoints, permissions, dependencies and generated native projects are unchanged. The remaining release conditions below are explicit, not recorded as completed acceptance.

Limitations and release conditions:
- No simulator/emulator/device was driven, following the recorded owner restriction. Mounted-host execution and resource-host tests are not native device acceptance or Release performance measurements. Fresh hands-on acceptance of these repairs remains pending; the TestFlight 793 acceptance above does not cover them.
- Full iOS/Android app compilation was not rerun because no native source, native build configuration or dependency changed; both platform JS bundles and native resource hosts were verified.
- Version/build-number choice was requested from the owner and remains pending. The working copy remains 1.0.25 (793); nothing was committed, pushed, uploaded or released.
- `apps/mobile/dist` from validation is retained for inspection; no shared cache or pre-existing build output was deleted.
- Other review findings (foreground cache durability, eviction protection races, Markdown reference invalidation and deep-position restoration) are outside the three approved repairs and remain unchanged.

## 2026-10-28 Login artwork follow-up

The owner then reported that the Login background present in `../slax-reader-client` was missing in Mobile. Byte comparison confirmed that both projects contain the identical 1500 x 1260 `bg_login.png`; the Metro registry and final bundle include it. The source KMP Login uses full width with a 375:314 layout ratio. The Expo Login supplied width and aspectRatio but did not override the static asset's intrinsic height. Both installed RN 0.88 Image implementations prepend the resolved asset width/height before the component style.

A standalone layout reproduction compiled from this checkout's RN Yoga C++ source confirmed the defect: at screen widths 375, 390 and 430, the old style lays the image out at approximately 1505 x 1260 logical units, pushing the wave artwork outside the visible region. Explicit width and `height = width / loginArtworkAspectRatio` produce 375 x 314, 390 x 326 and 430 x 360 after pixel rounding. This one-line repair retains the original image, source ratio, contain scaling, text, controls and colors. Blame traces the old sizing expression to the initial mobile migration commit `11b1e5060`, not the recent native offline-engine changes.

Verification:
- Existing mounted Login tests now read actual PNG dimensions and cover explicit image sizing at widths 320, 375, 390, 430 and 844 on both platform branches; protocol acceptance and provider cancellation behavior remain covered. Login/general-parity suites: 32 passed.
- Final `pnpm mobile -- check`: 1165 passed, 0 failed, 0 skipped, including typecheck and architecture checks.
- Final `pnpm mobile -- bundle`: Android and iOS exports passed; `git diff --check` passed.
- The Yoga reproduction ran on the macOS host, not in an app/device. Its temporary compiler output was removed. No dependency or generated asset was changed.
- Native screenshot/visual acceptance remains pending under the recorded no-device-driving instruction; neither the layout reproduction nor mounted tests establish full native visual parity. At this verification checkpoint, version/build number, commit, push and release were unchanged; the later authorized delivery is recorded below.

## 2026-10-28 build 794 delivery

After the repairs, the owner explicitly authorized a build-number increment, TestFlight upload, Git push and cleanup of this task's build caches/artifacts, simulators and worktrees. Marketing version remains `1.0.25`; `buildNumber` is `794` and `previousBuildNumber` is `793`. Both platform projects were regenerated through Expo and iOS CocoaPods integration completed. Android regeneration used the existing public configuration without local service overrides to avoid introducing unrelated Firebase changes; its only semantic changes are the build metadata. Main and Share plist semantic diffs are limited to `CFBundleVersion`.

Delivery verification and results:
- Final versioned `pnpm mobile -- check`: 1165 passed, 0 failed, 0 skipped. An initial executor was limited to 60 seconds and stopped during tests, before archive started; the complete rerun passed before the signed archive.
- `pnpm mobile -- bundle`: Android and iOS exports passed for build 794.
- `pnpm exec openspec validate --all --strict`: passed (81 items); `pnpm agent:check` and `git diff --check`: passed.
- Guarded `archive:ios`: completed at `2026-10-28T08:38:47.089Z`. Main `app.slax.reader` and Share `app.slax.reader.share` passed iPhoneOS signing, matching 1.0.25/794 versions, App Group, production-environment, framework-closure and main Firebase admission checks.
- Guarded `export:ios`: completed; the exported App Store IPA passed signature and metadata verification.
- Guarded `upload:ios`: succeeded. Xcode reported upload complete at `2026-10-28 16:44:05 +0800`, then `Uploaded package is processing` and `Upload succeeded` at `16:44:06 +0800`. TestFlight tester availability and completed processing were not independently confirmed.
- Non-blocking symbol-upload warnings remain for prebuilt React, ReactNativeDependencies, SDWebImage and its AVIF/SVG/WebP coders, Hermes and libavif frameworks. These did not reject the upload; no claim of full symbol ingestion is made.
- Pre-push Bugs/Security/Compliance review found no new Important code finding in the scoped repairs. The existing `mobile-native-smoothness` requirements cover the restored lifecycle, native-failure and interaction behavior. The owner authorized this preview and branch push; this is not a fabricated hands-on acceptance of the new UI. No pull request is opened or merged before fresh acceptance.

The release workspace is `.local/mobile-lifecycle-794-20261028`; archive, export and upload reports/logs identify each stage. After Git push, cleanup is limited to this task's archive/IPA/DerivedData, its regenerated iOS build products and `apps/mobile/dist`; compact reports and diagnostic logs are retained. No simulator or additional worktree was created by this task. Other worktrees, older build outputs, dependency caches, operator signing/service files and user data are outside cleanup scope. No Android store upload, backend deployment or public App Store release was performed.
