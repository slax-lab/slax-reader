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

- No simulator, emulator or physical device was driven by the agent. The owner said not to run simulators or devices after an earlier device session froze the test phone. Smoothness, gesture feel, Reader opening, offline reading, cold/warm start and cache migration on upgrade are therefore not verified by the agent.
- Device acceptance comes from the owner's hands-on TestFlight reviews, recorded per round under "Owner acceptance" below. Accepted so far:
  - Library list scrolling (786).

  Reviewed but not yet accepted:
  - Reader open, back-button stability and cached-open time (787).
  - RSS source switching (788).
  - Outline/overview motion, markdown-it rendering and the scroll-edge band (789/790).
  - The post-revert native header (790).
- Android has had no hands-on run.
- Theme matrix (`DESIGN.md` §6, Mobile shell and embedded reader): no light/dark comparison was recorded. The new surfaces use the existing light Reader palette: loading cover `#FCFCFC`, outline shell, loaders and overview dialog. This is a declared gap.
- Android: only a debug assemble was compiled. No Android artifact was produced or distributed.

## Delivery

TestFlight preview **1.0.25 (785)**: build bumped from 784, previous bound 784. iOS prebuild and pods were regenerated, then the guarded archive, export and Xcode upload all succeeded. Apple reported the uploaded package as processing at 2026-10-23 11:01:30 UTC. The [785 receipt](../../../docs/mobile/releases/1.0.25-785-testflight.md) lists the artifacts and hashes. App Store Connect processing and tester availability are not independently confirmed. Later builds (786–790) are recorded under Owner acceptance and in their receipts.

## Owner acceptance

- 2026-10-23, owner, TestFlight 785: Library list scrolling still jittered and dropped frames. The adjustments under task 5.5 went into build 786. They are fixed separator-inclusive `getItemLayout`, a plain `FlatList`, rows that are cheap at rest, Library row updates held while scrolling, and a memoized header. `pnpm mobile -- check` passes 1120/1120. TestFlight **1.0.25 (786)** was uploaded at 2026-10-23 14:59:19 UTC and Apple reported it processing. The [786 receipt](../../../docs/mobile/releases/1.0.25-786-testflight.md) has the details.
- 2026-10-24, owner, TestFlight 786: confirmed the Library list no longer jitters or drops frames while scrolling. No further adjustments were requested.
- 2026-10-24, owner, TestFlight 786: two further Reader issues.
  - The back button jumped when the Reader opened.
  - Cached articles were slow to appear.

  Task 7.5 fixes both: a static Reader navigation bar, a foreground native read queue running concurrently with the record lookup, immediate iOS host mounting, Reader/WebKit prewarm, and a 120 ms cover fade. `pnpm mobile -- check` passes 1129/1129, and the Android assemble and iOS simulator build succeed. TestFlight **1.0.25 (787)** was uploaded at 2026-10-24T08:53:44.087Z and Apple reported it processing. The [787 receipt](../../../docs/mobile/releases/1.0.25-787-testflight.md) has the details.
- 2026-10-24, owner, TestFlight 787: switching RSS sources forced a scroll-to-top animation.
  - **Cause:** the shared `FeedList` kept `maintainVisibleContentPosition` with `autoscrollToTopThreshold: 1` constant, so a swapped source looked like a prepend.
  - **Fix (task 5.6):** a `contentScope` suspends visible-position adjustment until the replacement renders.
  - **Checks:** `pnpm mobile -- check` passes 1130/1130, including a new FeedList scope test and an updated RSS switch test.
  - **Delivery:** TestFlight **1.0.25 (788)** was uploaded at 2026-10-24T12:23:20.936Z and Apple reported it processing. See the [788 receipt](../../../docs/mobile/releases/1.0.25-788-testflight.md).
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

  TestFlight **1.0.25 (789)** was uploaded at 2026-10-26T08:19:46.049Z and Apple reported processing. See the [789 receipt](../../../docs/mobile/releases/1.0.25-789-testflight.md).
- 2026-10-26, owner: did not approve item (3), the custom navigator bar that replaced the native header. It is reverted to the build-788 native header (transparent, fixed More slot, native back). Items 1, 2 and 4 are kept: scroll-edge effects stay hidden. The spec exception for a custom back control is withdrawn. `pnpm mobile -- check` passes 1144/1144, the bundle builds and the iOS simulator build succeeds. TestFlight 789 still contains the reverted bar and is superseded.
- 2026-10-27, owner: instructed the agent to build TestFlight, push the branch and open the pull request. This is the owner's decision to open the pull request before the remaining hands-on acceptance listed under "Not verified". It is not itself an acceptance record. TestFlight **1.0.25 (790)**, the merged and reverted state, was uploaded at 2026-10-27T02:34:49.518Z. See the [790 receipt](../../../docs/mobile/releases/1.0.25-790-testflight.md).
- 2026-10-27, owner: articles with external resources waited for those resources before showing. **Cause:** the initial restore, which lifts the cover, was gated on the WebView load event, so it waited on every subresource. **Fix (task 7.8):** the restore is gated on DOM readiness plus the first height, with a one-time re-apply for late growth and a 1.5 s cover timeout. `pnpm mobile -- check` passes 1154/1154 and the bundle exports. TestFlight **1.0.25 (791)** carries the fix and supersedes 790. It was uploaded at 2026-10-27T03:13:41.892Z and Apple reported it processing. See the [791 receipt](../../../docs/mobile/releases/1.0.25-791-testflight.md).
- 2026-10-27, owner, review of 791:
  - Remove the automatic position re-apply and keep the position fixed until the user scrolls.
  - Drop the back-button/More hiding requirement.
  - Show the HTML as soon as it is ready, with no loading cover and no timeout.

  The cover, re-apply and timeout are removed; the saved position is restored once at DOM readiness. `pnpm mobile -- check` passes 1146/1146 and the bundle exports. TestFlight **1.0.25 (792)** carries this; it was uploaded at 2026-10-27T04:49:41.160Z and Apple reported it processing. See the [792 receipt](../../../docs/mobile/releases/1.0.25-792-testflight.md).
- Pending: the owner's hands-on review of TestFlight 792. Record who, when, the observations and any adjustments here before a pull request.
