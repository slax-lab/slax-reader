# Android bridge verification — 2026-11-03

The initial verification below is historical. The owner subsequently approved both focused repairs; their implementation and current verification status are recorded in **Approved repairs and re-verification** at the end of this document.

## Scope and environment

The owner requested Android verification of the synchronized bridge and an audit of the Library source-item width. This follow-up changes verification documentation only. Product code, dependencies, generated assets and versions are unchanged.

- Source checkout: `/Users/yjc/Documents/Company/slax-reader-v2`.
- Independent generated fixture project: `/private/var/folders/g8/xfq9xyfn5ms_mm86n450cq5c0000gn/T/slax-reader-ui-fixture-A11OAr`.
- Application: `com.slax.reader.uifixture.bridgeverify`; Metro port 8083. Production/account data and the existing main-checkout Metro server were not used for mutations.
- Device: task-owned `slax_bridge_verify` AVD, `emulator-5554`, Android 15/API 35, arm64, WebView 124.0.6367.219, 1080×2400 pixels, density 2.625, default font scale, English, light appearance.
- Build succeeded: `/tmp/slax-bridge-android-build-recovery.log` (6m20s, 1,155 tasks); final rebuild `/tmp/slax-bridge-android-build-final.log` (20s). Final APK SHA-256: `a911a424e274c45a064f18ef63e8dc796a3d9686e09b680f509272551c7f65f6`.

The first build required SDK installation and recovery of three Google Maven TLS download failures. Artifacts were fetched from their official HTTPS URLs and matched the official SHA-1 checksums. The temporary Gradle init file adds standard plugin repositories; no repository build configuration was edited.

## Test boundaries

The repository's fixture generator copied the production source and the generated bridge. Source-manifest verification after the final native rebuild found exactly two differences, both in temporary fixture adapters: `fixtures/runtime.ts` and `fixtures/FixtureApp.tsx`.

These adapters needed synchronous synthetic marker/image/context writes because SDK 58 `File.write` is asynchronous. The Android fixture also needed its observed canonical `/data/data/<fixture-package>` cache path instead of the `/data/user/0` alias rejected by native storage, and an activated resource owner shared by its seeded cache and Reader. Temporary native diagnostic logging was removed before the accepted run; the native module source again matched the main checkout. These are test-environment accommodations, not shipped fixes.

Native inputs use a task-owned adaptation of `apps/mobile/tooling/fixture-android-batch.py`, with the actual independent app ID/device/port and current native Reader/gallery guards. Inputs are bounded by fresh native hierarchy measurements, with foreground-app checks and screenshots. CDP is used separately for passive DOM observations and explicitly identified synthetic state preparation. Prepared DOM/ranges are not represented as native user selection.

The existing mixed fixture supplies persisted marks, cached images and a short table. A synthetic section appended inside this controlled WebView supplies authored 32px/oversized images, a relative URL and a wide table. It runs the actual bundled default and metadata processors. The fixture's native host intentionally blocks external navigation and network requests; those guards were retained.

## Results

| Area | Observed result | Qualification |
| --- | --- | --- |
| Images | Cached image loaded; failed image remained hidden; authored small image measured 32×32 CSS px; oversized image fitted the 372.19px content width. A measured native image tap opened the native gallery. | Synthetic cached artwork and a WeChat metadata URL exercise sizing without a live WeChat fetch. |
| Tables | Short table fitted its 372px parent. Wide table measured 371px client width and 5,421px scroll width; a native horizontal swipe changed `scrollLeft` from 0 to 230.095px. Body width/scroll width both remained 412px; the original short-table cell retained identity. | Native swipe verified; rotation and other WebView/device versions are unverified. |
| Relative links | `../next?q=1` became `https://mp.weixin.qq.com/next?q=1`. A native tap produced touchstart/touchend/click on that exact anchor and URL. | Browser handoff is unverified: `SlaxReaderView.shouldOverrideUrlLoading` deliberately rejects navigation when `resourceHandler.isFixture` is true. No guard was weakened. |
| Programmatic selection | Actual bundled `scrollToAnchor` selected the target and moved the native outer scroller without showing the annotation bar. | Invoked as controlled preparation; this is not evidence of a native outline-button tap. |
| Manual selection | Native long press selected `bold` and opened annotation controls. A later new-text selection showed native handles but no annotation bar; CDP reported `isPointerDown=false`, `hasPendingSelection=true`, `lastSelectionText=''`. Two subsequent measured long-press runs selected `stays` and did show the action bar. | Intermittent failure remains open; do not certify all native selection paths. |
| Highlighting | After an explicitly prepared range, a native Highlight-button tap created a new `stroke self-stroke` mark for `The quote`. Native tapping that new mark opened its comment panel. Computed stroke token was `#CCB69AFF`. | Button/rendering path verified independently; the intermittent native selection entry remains a limitation. |
| Comments | Native input and Send on the new mark saved synthetic text `bridgeok`; closing the panel and tapping the mark again showed the same saved comment and quote. | Local database only, no remote account upload. With the keyboard visible, the comment sheet/editor was covered; submission was verified after dismissing the keyboard. |

## Findings retained for follow-up

1. **Intermittent annotation-bar omission after native long press.** The failed frame has a visible selected word and handles without `selection_action_bar`; the monitor retained a pending selection after pointer release. The existing `handleTouchCancel` only clears `isPointerDown`, whereas `handlePointerUp` also flushes pending selection. This is a concrete candidate cause, not a fully isolated diagnosis: later attempts passed, and their captured event order differs. The upstream selection-monitor file is byte-identical to its current HEAD; this verification did not modify it. A focused regression and native reproduction are needed before fixing/certifying this path.
2. **Android comment keyboard avoidance.** In the measured Android 15 run the keyboard covered the comment sheet/editor; dismissing it exposed the draft and allowed Send. `ReaderSheet` enables `KeyboardAvoidingView` padding only on iOS and depends on native resize on Android. The observed overlap requires a focused fix and native acceptance; this follow-up does not change that behavior.

These findings mean the Android annotation experience is **not fully accepted**, despite successful isolated highlight/comment operations. Remote synchronization, a production browser handoff, additional devices/WebViews, enlarged text and alternate appearance remain outside this run. Owner hands-on acceptance remains required before a PR.

## Evidence

- Native input records, hierarchy, context and PNGs: `/tmp/slax-android-bridge-evidence/batch.json` and its numbered directories. Rejected guard captures/system-keyboard onboarding frames remain diagnostics, not passing acceptance evidence.
- Original content/DOM: `/tmp/slax-android-dom-initial.json`, `/tmp/slax-android-dom-native-selected.json`.
- Common processor preparation: `/tmp/slax-android-prepare-common.js`, `/tmp/slax-android-common-initial.json` (explicitly preparation-only).
- Native table result: `/tmp/slax-android-table-after-native.json`; frame `13-native-wide-table-horizontal-scroll/native.png`.
- Image gallery: `12-native-image-gallery/native.png`.
- Actual native relative-link events: `/tmp/slax-android-link-events.json`.
- Missing action-bar frame: `08-native-new-selection/native.png`; the pending-monitor observation was captured separately through CDP during that state.
- Passing later long-press event traces: `/tmp/slax-android-selection-native-events.json`, `/tmp/slax-android-selection-long-hold-events.json`; frames 24 and 25.
- Created mark: `/tmp/slax-android-quote-created.json`.
- Saved/reopened comment: `22-native-comment-reopen/native.png` and its hierarchy containing `bridgeok`.
- Keyboard-overlap screenshot: `/tmp/slax-android-comment-keyboard.png`.
- Temporary fixture adapter changes: `/tmp/slax-android-fixture-adapter-changes.json`; final adapter diff and final driver archived with the evidence.

## Source-item width and preservation

Both Collection (`LibraryScreen.styles.source`) and RSS (`RssFeed.styles.source`) are **72 points in HEAD and in the working tree**. Collection `SourceLine` has no added width constraint, and RSS label typography has no added width constraint. The earlier changes reduce label font size from 11 to 10 points and the avatar-to-label gap from 6 to 4 points. Smaller type explains the increased visible name length; there is no item-width change to revert. The 10/14 typography, 32-point avatars and previously restored 12-point item gaps remain intact.

Before writing this documentation, SHA-256 verification against `/tmp/mobile-android-verify-preserved.json` confirmed all 66 initially dirty files were byte-identical. Only the verification documents listed in the follow-up diff may differ afterward. Mobile remains 1.0.26/build 798 under the owner's standing decision. No commit, push or PR was created.

## Approved repairs and re-verification

The owner requested fixing both reported annotation problems while retaining all other uncommitted changes. The upstream bridge now routes `touchcancel` through its existing pointer-release handler. A pending debounced selection is delivered once; an earlier cancellation still lets the pending debounce finish normally. The Android inline Reader sheet now uses the installed RN height avoidance; iOS retains padding avoidance. Controllers, annotation paths, sheet motion and native modules are unchanged.

### Regression and build evidence

- Red/green bridge test: cancellation at 150ms passed initially, but cancellation at 350ms failed because no selection callback arrived. After the fix, both timings, duplicate-event protection and a subsequent gesture passed. Logs: `/tmp/bridge-android-fixes-red.log`, `/tmp/bridge-android-fixes-green.log`.
- Red/green mounted Reader sheet test executes the installed RN KeyboardAvoidingView implementation. Android initially retained an unadjusted viewport (`undefined` height instead of 500); after the fix, changing keyboard frames, hide/restoration, an already resized native parent and unchanged iOS padding passed. Logs: `/tmp/mobile-android-keyboard-red.log`, `/tmp/mobile-android-keyboard-green.log`.
- Two existing passive DOM-observer assertions explicitly required the old unflushed pending state; they now require one delivered selection after cancellation and still require one total after a later touchend. Existing mark-tap guards remain intact.
- Upstream: 105 tests across 12 suites passed, TypeScript passed, Rollup production build passed, and the required graphify AST refresh completed. Logs: `/tmp/bridge-android-fixes-all-tests.log`, `/tmp/bridge-android-fixes-typecheck.log`, `/tmp/bridge-android-fixes-build.log`, `/tmp/bridge-android-fixes-graph.log`.
- New bridge artifact: 43,145 bytes, SHA-256 `79e73864dc288d03e16ed2cf4968d79bed70f4d47735703f5a89d00dc0b53aab`. Copied byte-for-byte from upstream dist, updated only its manifest entry/build inputs, and regenerated Mobile embedding through `generate-assets.mjs`. Other imported assets/provenance remain unchanged.
- Full Mobile check: 1,272 passed, zero failures/skips, including native Kotlin/Swift verification. The initial run lacked the already installed Kotlin compiler on PATH; the successful rerun prepended `/tmp/mobile-polish-kotlin/kotlinc/bin`. Logs: `/tmp/mobile-android-fixes-check.log` (initial), `/tmp/mobile-android-fixes-check-2.log` (passing).
- Android and iOS bundle exports passed: `/tmp/mobile-android-fixes-bundle.log`.
- Independent requesting-code-review inspection found no Critical/Important Bugs, Security or Compliance issues, including the final passive-diagnostic assertion update; the reviewer independently reran the 14 selection-monitor, three keyboard and two relevant DOM tests.

### Android running-app evidence

The same independent Android 15/API 35 application, WebView 124, English/default scale/light profile was cold-started with the repaired main-checkout ReaderSheet and regenerated bridge. `/tmp/mobile-android-fixes-fixture-overlay.json` records exact matching hashes for the main and temporary fixture copies. The previously documented two fixture-adapter accommodations were retained; no native product source or dependency was patched. A dev-client Expo initialization error was recovered by restarting its task-owned Metro server with a cleared transform cache and cold-starting the app; the accepted run contains no such error.

1. A real 1,800ms native long press selected `stays`. The passive capture recorded `touchcancel` while `pointerDown=true` and `pending=true`; afterward the monitor had `pending=false`, `pointerDown=false`, `lastText=stays`, and native Copy/Highlight/Comment controls were visible. This exercises the formerly failing ordering on Android, independently of the fake-timer regression.
2. Native Highlight created a mark on that manually selected word; native tapping the new mark opened its quote/comment sheet. No prepared text range was used for this path.
3. Native focus and paced keyboard input entered `fixedok`. Window insets confirmed a visible IME beginning at 1517px. The focused input bounds were `[126,1374][862,1475]`; enabled Send bounds were `[904,1374][1059,1474]`. Both were above the keyboard. A native Send tap succeeded without manually dismissing the keyboard. Native close/reopen of the mark retained `fixedok` and restored the panel to the full available viewport.
4. Controlled invocation of the actual `scrollToAnchor` API selected its target without showing annotation controls. Subsequent native word selection in a different paragraph, followed by another cleared/repeated word selection, exercised real user selection again. Word positions were read from DOM Range rectangles and the measured native WebView origin; only the ADB long press creates those user selections. This is not a native outline-button acceptance claim.

Evidence lives under `/tmp/slax-android-fixes-evidence/`: native input records/hierarchy/screenshots, keyboard insets, passive selection observations, source-overlay hashes and an acceptance summary/manifest. Earlier paragraph-centre attempts produced empty ranges, and pressing the existing programmatic range did not create a new range; those diagnostic captures are retained separately and are not counted as passing new-selection cases. Passive capture microtasks can run before bubble listeners; final monitor snapshots and the actual visible controls establish the post-dispatch result.

The two initially reported defects are repaired for the exercised Android paths. Native iOS device verification, additional Android/WebView versions, enlarged text, remote comment synchronization and owner hands-on acceptance remain outside this run. No release, commit, push or PR is included. The owner-approved 1.0.26/build 798 version remains unchanged; unrelated dirty files and bridge preprocessing work remain preserved.
