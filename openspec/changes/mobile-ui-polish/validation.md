# Validation

## Scope and status

- Date: 2026-10-30 (Asia/Shanghai).
- Main checkout branch: `fix/mobile-ui-polish`, based on `origin/dev`.
- Implemented: header Submit with existing validation/pending/ownership guards; reordered localized consent rows and divider; concise diagnostic label that does not expand when selected; 12-point circular checkbox icons alongside 14-point labels; first-tap consent toggling that preserves editing and keyboard state; an available-height editor above bottom-anchored options, with background/context and Submit taps dismissing the keyboard.
- Reader follow-up: verified the existing 56 by 56 logical-point icon tile; reduced every action icon from 28 to 24 points; centered the Pro badge at its top using a 24 by 9.6-point image frame matching its 100:40 source ratio. The complete action includes the label and is approximately 80.5 points high at the default single-line size; this is a source-layout calculation, not a native measurement.
- Annotation follow-up: retained green caret styling in Mobile HTML/PDF documents and added explicit iOS Reader WKWebView tint after the owner reported that native selection remained blue. Quote underlines use the article's mark-stroke color below native line measurements. The owner confirmed RGBA `#8AD8A866` and accepted native iOS selection's system-controlled opacity instead of adding a custom selection renderer.
- Overview follow-up: the inline excerpt prefix now explicitly shares the content's 14-point typography rather than taking SourceText's 16-point default.
- The existing Mobile profile, feedback controller, transport, and attachment safeguards remain unchanged. The fixed compact editor is replaced by a flexible frame with internally scrolling input and a separate nonshrinking options group.
- The repository owner ran the simulator personally during the iteration and accepted the latest UI in this chat on 2026-10-30, then authorized local review and a PR targeting `dev`. This is hands-on acceptance, not just implementation approval. Version, build, verification gaps, and the pre-push review are recorded below. No release or deployment is part of this task.
- The owner explicitly chose to retain Mobile version `1.0.25`, `buildNumber: 796`, and `previousBuildNumber: 795`.

## Final acceptance and pre-push review

- Accepted by: the repository owner/requester in this chat, on 2026-10-30 (Asia/Shanghai), after their own simulator review. They reported no substantial remaining problems and authorized a short risk review followed by PR creation. The conversation identifies iOS simulator use; the owner did not provide a complete device, OS, locale, appearance, or font-scale matrix, so none is inferred.
- Accepted scope: Feedback header submission, stable reordered consent copy, smaller circles, flexible editor/keyboard layout, consent taps preserving input, and unbracketed email; Reader 24-point icons and centered Pro badge; native green selection hue, matching Overview typography, and below-text popup lines using the article mark color. These include the adjustments requested during the owner's hands-on iteration.
- Additional agent exercise: on the running iPhone 16 / iOS 18.6 simulator, Chinese UI, light appearance, 393-point logical width, opened Feedback from the menu. Observed the empty editor fill available space, bottom options, disabled-looking header Submit, and the final consent copy. Typed a temporary draft, toggled diagnostic attachment, and continued typing directly; the draft gained the additional text and focus was retained. Toggled follow-up and cleared the draft without refocusing; restored the default consent states and returned to the original Settings page. No feedback or diagnostic log was submitted. The simulator's software keyboard was not displayed during this hardware-keyboard exercise, so it does not establish software-keyboard movement or dismissal.
- Declared agent-verification gaps: no independent full native Reader/HTML/PDF selection exercise, Android device run, small-screen/font-scale/locale/theme matrix, real submission, cold/offline lifecycle exercise, or software-keyboard recording. This session used the owner's accepted simulator exercise and targeted running checks, rather than a separate baseline/fixture native installation. These are coverage limits, not claims that all matrix entries passed.
- Visual-media gap: no comparable target-branch before/after pair was captured. The inspected running Feedback screen contains the owner's account email, so its unredacted screenshots are not uploaded. The supplied mockup is a design reference and is not presented as an actual before capture. Native visual acceptance above is recorded separately from this missing agent-captured PR media.
- Fresh `pnpm mobile -- check`: exit 1; architecture, manifests, RSS, and TypeScript passed; 1,262 tests total, 1,255 passed, 2 failed, 5 skipped. The same missing-Kotlin and pre-existing dirty-configuration failures listed below remain. Log: `/tmp/slax-mobile-ui-pr-mobile-check.log`. No all-tests-green claim is made.
- To separate the configuration failure from this PR, ran the unchanged EAS configuration test against four allowlisted `origin/dev` files in a disposable directory with the installed dependencies. Both tests passed; the dirty `app.config.ts` is not staged. This does not repair or discard the owner's separate configuration work.
- Fresh read-only pre-push review by an independent reviewer and the implementing agent: no Important findings or Nits. **Bugs:** checked current header callbacks/disabled state, cancellation and retry, consent responder behavior, flexible layout, native line measurements/truncation and both platform border implementations. **Security:** no new dependencies, network/file operations, permissions, or logging; existing consent and account boundaries remain. **Compliance:** selected `mobile-ui-polish`, checked proposal/design/tasks/four delta specs, recorded hands-on acceptance and the explicit retained version. Earlier phase notes below describe their status at the time; their pending-acceptance wording is superseded by this final record.
- Commit scope excludes the five pre-existing configuration/native/deployment edits listed below. Strict OpenSpec validation and staged whitespace/scope checks run again after final documentation updates. PR delivery and automated review are recorded separately when available; post-merge archive remains a separate docs PR.

## Automated verification: Feedback phase

| Command | Result |
| --- | --- |
| `node --experimental-strip-types --test apps/mobile/tests/diagnostics/feedback-host.test.mjs` before implementation | Expected red: four locale/platform cases lacked header Submit; two consent cases found the previous row order. |
| Same targeted command after implementation | 17 passed, 0 failed, 0 skipped. |
| `pnpm mobile -- check` | Architecture, baseline/fixture verification, RSS verification, and TypeScript passed. Full tests: 1,260 total; 1,253 passed, 2 failed, 5 skipped. Exit 1; details below. |
| `pnpm mobile -- bundle --output-dir /tmp/slax-mobile-feedback-ui-bundle-20261030` | Exit 0. Android and iOS Hermes bundles exported successfully. |
| `pnpm exec openspec validate --all --strict` | 88 passed, 0 failed. Informational long-requirement notices only. |
| `git diff --check` | Passed. |

The mounted tests render the navigation header and exercise actual Feedback state/controller logic with isolated native/transport boundaries. They cover empty/whitespace/one-character/cleared input, current header callbacks, pending duplicate prevention, error retry, ownership invalidation, option independence, disclosure visibility, draft retention, and unmount cancellation. They do not establish native keyboard hit testing or visual parity.

### Full-check failures unrelated to this diff

1. `actual Kotlin file storage enforces atomic writes, bounded reads, paths and account replacement` (`tests/data/file-store.test.mjs`): `spawnSync kotlinc ENOENT`; `kotlinc` is not installed on the command path. No storage source was changed.
2. `EAS production builds check the production channel on launch without waiting, bound to the native version` (`tests/release/eas-updates-config.test.mjs`): expects `{policy: 'nativeVersion'}` but receives `undefined`. The pre-existing, uncommitted `app.config.ts` change uses `buildVersion.displayVersion`, while this test's build-version fixture omits that property. The existing configuration edit and its test were preserved.

Skipped native tests:

- Kotlin shared image registry: missing OkHttp/Okio jars.
- Kotlin offline engine: missing OkHttp/Okio/kotlinx-coroutines jars.
- Kotlin pull transport: missing OkHttp/Okio jars.
- Compiled Swift/Kotlin PDF policies: installed Kotlin compiler unavailable.
- Kotlin diagnostic writer: missing public org.json classpath/cache.

No application code was changed to bypass these failures or skips. Test output also contains existing Node module-type warnings.

## Automated verification: Reader More-panel follow-up

- `node --experimental-strip-types --test apps/mobile/tests/reader/screen-parity-repairs.test.mjs apps/mobile/tests/reader/pdf-screen.test.mjs`: 81 passed, 0 failed, 0 skipped. Existing coverage includes Reader menu actions and native-dialog dismissal sequencing for HTML and PDF flows.
- `pnpm mobile -- typecheck`: passed.
- `pnpm mobile -- bundle --output-dir /tmp/slax-mobile-ui-polish-bundle-20261030`: exit 0; Android and iOS Hermes bundles exported successfully. The task-owned temporary export was removed after recording the result.
- `pnpm exec openspec validate --all --strict`: 88 passed, 0 failed after renaming the change and adding the toolbar presentation delta.
- `git diff --check`: passed.
- The full Mobile check above was not repeated for this local badge-style follow-up. Its two unrelated failures and five native-toolchain skips remain unresolved; no all-tests-green claim is made.
- No new implementation-mirroring style test was added. The asset was inspected, its 100 by 40 pixel metadata checked, and the layout diff reviewed. Actual native alignment remains pending the owner's simulator exercise.

## Native scenario checklist from implementation

The owner reported general satisfaction with Feedback, then requested removing expanded attachment copy, reducing checkbox icon size, and filling the available height above options that move with the keyboard; these refinements were implemented. This is not a claim of final acceptance of the refinements or the Reader badge. No agent-operated native environment, screenshots, or recordings were produced. Verify on affected iOS/Android targets where available:

1. Open Feedback without the keyboard; ensure the options sit at the bottom safe area and the editor fills the remaining space. Submit must be in the upper right and disabled for empty/whitespace content. Enter one non-whitespace character, then clear it; verify enabled/disabled appearance.
2. Verify follow-up appears above diagnostic attachment, with the account email and the reference copy. Select/unselect logs: the concise visible text must stay unchanged and follow-up must remain independent. Both circular icons should be slightly smaller than the labels while the complete rows remain easy to tap.
3. With the keyboard open and the cursor inside the draft, toggle each option on and off. Each option must toggle once while input focus, cursor position, keyboard visibility, and draft remain intact; continue typing without tapping the input again. Then tap blank space or article context: the keyboard must close without changing the draft. Toggle options with the keyboard closed: it must stay closed. Confirm text selection, newlines, and Submit dismissal still work.
4. Focus the input: both options must rise above the keyboard as the editor shrinks. Dismiss the keyboard: the input must expand again without losing the draft or consent. Check a long draft, long email, and optional article context on a small device in Chinese/English and light/dark system appearance. Long text must scroll inside the input, with the options remaining visible; the app retains its light profile.
5. If intentionally submitting test feedback, verify pending, failure/retry, success, and Back behavior. Automated transport fixtures already cover these paths without sending real feedback.
6. Open an article and its bottom More panel. Confirm the icon tiles retain their size and labels, the action icons are now 24 points and centered, and the Pro badge is horizontally centered with its visible top edge flush to the tile. Check action taps, selected icons, YouTube/PDF variants, text scaling, and system appearance on the available native targets.
7. Rebuild and run the iOS app before retesting selection; Metro reload cannot apply the Swift tint change. Select HTML and PDF text; check the green hue, native selection handles, drag extension, copy, highlight, and comment. iOS retains native opacity by the owner's choice. Open comment-only and stroked quotes containing Chinese, descenders such as `gyp`, two wrapped lines, and longer truncated content; check that dashed/solid lines match the article's `#F6AF69` and remain below the text at normal and enlarged font scales and after switching quotes. Confirm the quote is read once by assistive technology and copy still uses its full content.
8. Check the top inline Overview excerpt in Chinese/English at normal and enlarged text sizes: its prefix must match the content's font size and line height while remaining muted. Confirm three-line truncation, tapping to expand, and closing still work.

The checklist above guided the owner iteration; final acceptance and remaining agent-verification gaps are recorded in the final section above. It is not a claim that the owner individually executed every checklist combination. PR delivery and post-merge archival are tracked in tasks.md.

## Local diff review and preservation

- Bugs: header effect dependencies track current validity, submitting state, translation, and submission closure. Existing unmount cancellation remains owned by `useFeedback`. The installed ScrollView provides unhandled-tap blur; the form Pressable covers outer padding, and consent Pressables toggle without requesting dismissal or focus. The footer is outside the editor scroll area, and long input text cannot change parent height. Native responder behavior remains unverified by the agent.
- Security: no new dependencies, services, uploads, logging, or permission changes. Existing diagnostic consent remains independent and unchecked by default; detailed retention/link-access information remains available.
- Compliance: implementation matches the approved presentation proposal. The final acceptance section supersedes the historical pending state; full-check and visual-evidence limitations remain explicit. No release readiness is claimed.
- Reader follow-up review: the product changes are decorative badge placement/image-frame height and action-icon size. Tile geometry, labels, callback routing, accessibility ownership, and assets are unchanged.
- Pre-existing edits to `app.config.ts`, `ios/Podfile.lock`, the Xcode project, `Info.plist`, and `deploy/mobile/README.md` were preserved and are not part of this task.
- Temporary bundle output is task-owned and disposable; source changes and this evidence remain in the checkout.

## Automated verification: owner-requested Feedback refinements

- Updated the existing English/Chinese consent tests to require stable row text when toggled; before the production change both failed because the detailed disclosure was appended, confirming the regression expectation.
- `pnpm mobile -- bundle --output-dir /tmp/slax-mobile-ui-feedback-refinement-bundle-20261030`: exit 0; iOS and Android Hermes exports passed. The task-owned temporary export was removed after recording the result.
- `node --experimental-strip-types --test apps/mobile/tests/diagnostics/feedback-host.test.mjs`: 17 passed, 0 failed, 0 skipped after the change.
- `pnpm mobile -- typecheck`: passed.
- `pnpm exec openspec validate --all --strict`: 88 passed, 0 failed.
- `git diff --check`: passed.
- Reviewed both icon sizes against the existing 14-point metadata font; each is now 12 points. Row minimum height remains 48 points. The visible disclosure block and its unnecessary text wrapper were removed; consent state, keyboard dismissal, submission, and the existing accessibility hint are retained.
- The earlier full-check failures/skips remain recorded above and were not rerun for this local presentation refinement. Native appearance of the smaller artwork and final owner acceptance remain pending.

## Automated verification: available-height editor and keyboard layout

- Reused the existing measured header offset and platform-specific KeyboardAvoidingView. The consent group is a nonshrinking sibling of the flexible editor scroll area. The input fills its editor frame absolutely and scrolls internally; a 96-point minimum editor keeps a short upper viewport scrollable without displacing the options.
- Executed a temporary geometry check using the already-installed Yoga layout engine and styles loaded from the actual FeedbackScreen. It covered 32 combinations: short/long text, absent/present article context, single/wrapped options, and 650/350/250/650-point available heights representing closed/open/small/restored keyboard space. All passed: the options remain bottom-anchored, long text does not enlarge the form, the input remains usable, and the normal-height editor shrinks/restores with available space. This is layout-engine evidence, not proof of native keyboard events or animation. Script: `/tmp/slax-feedback-keyboard-layout-check.mjs`; output: `/tmp/slax-feedback-keyboard-layout.log`.
- The initial layout check exposed footer displacement with intrinsic long-text sizing; a subsequent short-viewport case exposed overflow when all content shared one bounded form. Both observations informed the separate footer and flexible upper scroll-area implementation.
- `node --experimental-strip-types --test apps/mobile/tests/diagnostics/feedback-host.test.mjs`: 17 passed, 0 failed, 0 skipped. Existing four locale/platform cases now also verify that tapping the form dismisses the keyboard while retaining the draft and making no request, followed by first-tap option and header submission actions.
- `pnpm mobile -- typecheck`: passed.
- `pnpm mobile -- bundle --output-dir /tmp/slax-mobile-ui-feedback-keyboard-bundle-20261030`: exit 0; iOS and Android Hermes exports passed. The task-owned export is removed after recording the result.
- `pnpm exec openspec validate --all --strict`: 88 passed, 0 failed.
- The earlier full-check failures/skips remain recorded above. Native keyboard transitions, input selection/scrolling, and final human acceptance remain pending the owner's simulator exercise.

## Automated verification: 24-point Reader action icons

- Confirmed ReaderToolbar previously passed `size={28}` to every action icon. Changed that shared rendering prop to `size={24}`. SourceIcon uses the size for both image-frame dimensions; the 56-point tile, centered alignment, label gap, touch target, and separate Pro badge are retained.
- `node --experimental-strip-types --test apps/mobile/tests/reader/screen-parity-repairs.test.mjs apps/mobile/tests/reader/pdf-screen.test.mjs`: exit 0; 81 passed, 0 failed, 0 skipped. No new style-mirroring tests were added for this single-prop presentation adjustment.
- `pnpm mobile -- typecheck`: exit 0.
- `pnpm mobile -- bundle --output-dir /tmp/slax-mobile-ui-toolbar-icon-bundle-20261030`: exit 0; iOS and Android Hermes exports passed. The disposable task-owned export is removed after recording the result.
- `pnpm exec openspec validate --all --strict`: 88 passed, 0 failed.
- `git diff --check`: passed.
- Local Bugs/Security/Compliance review found no new Important implementation findings for `mobile-ui-polish`: this shared sizing prop covers selected and document-specific actions, introduces no dependency or transport changes, and matches the owner's explicit follow-up. Native visual acceptance remains pending the owner's simulator exercise; no PR readiness is claimed. The earlier full-check failures/skips and version-retention decision remain unchanged.

## Automated verification: Reader selection and comment-quote decoration

- Root cause: the existing comment quote used native textDecorationLine. The installed iOS React Native text renderer places that underline near the baseline, which can intersect descenders. The new local CommentQuote component uses native onTextLayout line boxes and independent decorative borders with two points of clearance. A three-point footer reserves the final border; only two visible lines are decorated, and text replacement resets measurements. The text remains a single accessible SourceText with the existing ellipsis.
- Selection investigation: HTML and PDF CSS already used the confirmed `#8AD8A866`. Mobile-owned root caret styling now supplies opaque `#8AD8A8` to the native iOS selection path. [WebKit's interaction implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm) prioritizes explicit CSS caret color; [its extended text traits](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/WKExtendedTextInputTraits.mm) derive the highlight at 20% opacity. The owner explicitly accepted native opacity. Shared reader assets, generated files, native code, and Web/Extension styles were not changed.
- Red/green: both new locale-independent iOS/Android mounted quote cases failed against the original text underline, then passed after the change. They exercise line geometry, two-line clipping, scaled/RTL measurements, dashed/solid/none state changes, replacement quotes, and noninteractive decoration. Measurements are supplied at the native boundary; these tests do not measure actual glyphs on a device.
- `node --experimental-strip-types --test apps/mobile/tests/reader/parity-repairs.test.mjs apps/mobile/tests/reader/document-composition.test.mjs`: exit 0; 10 passed, 0 failed, 0 skipped.
- `node --experimental-strip-types --test apps/mobile/tests/reader/dom.test.mjs apps/mobile/tests/reader/bridge.test.mjs apps/mobile/tests/reader/pdf-browser.test.mjs apps/mobile/tests/reader/performance-pipeline.test.mjs`: exit 0; 52 passed, 0 failed, 0 skipped. This includes the running Chromium PDF/selection fixture and existing annotation, bridge, comment focus/lifecycle, and document regressions.
- `node --experimental-strip-types /tmp/slax-reader-selection-colors-check.mjs`: exit 0. In headless Chrome, actual HTML/PDF document CSS for both platform configurations computes opaque RGB `(138, 216, 168)` for caret color and RGBA `(138, 216, 168, 0.4)` for selection background while retaining selected text. This one-off CSS check disables page scripts and supplies a PDF text-layer element; it is not native WebKit or PDF-layout evidence. Output: `/tmp/slax-mobile-ui-selection-colors.log`.
- `pnpm mobile -- typecheck`: exit 0. `pnpm mobile -- bundle --output-dir /tmp/slax-mobile-ui-annotations-bundle-20261030`: exit 0; iOS and Android Hermes exports passed. The disposable task-owned export is removed after recording the result.
- `pnpm exec openspec validate --all --strict`: 88 passed, 0 failed. `git diff --check`: passed.
- Local Bugs/Security/Compliance review for `mobile-ui-polish`: selection ownership and stored annotations are untouched, quote measurements are isolated from the comment editor, and decorative borders cannot receive input or accessibility focus. No new dependencies, services, or data handling were introduced. The implementation matches the clarified request; actual native hue, underline clearance, and final human acceptance remain pending. The prior full-suite failures/skips and version decision remain unchanged.

## Automated verification: Feedback consent preserves editing

- The owner's latest request supersedes the earlier consent-row dismissal behavior. Both row callbacks explicitly called Keyboard.dismiss; removed those calls so they only update their independent checked state. The input is neither blurred nor refocused. Consent rows remain outside the ScrollView, and their own Pressables handle taps. Background/context and header Submit dismissal remain in place.
- Updated existing English/Chinese and iOS/Android mounted cases first: all six affected cases failed against the old callbacks because they requested dismissal. After the two callback changes, the full Feedback suite passed. Assertions cover independent toggles in both directions, retained draft, no submission during toggles, no new dismissal/focus requests, and continued background/Submit dismissal.
- `node --experimental-strip-types --test apps/mobile/tests/diagnostics/feedback-host.test.mjs`: exit 0; 17 passed, 0 failed, 0 skipped.
- `pnpm mobile -- typecheck`: exit 0.
- `pnpm mobile -- bundle --output-dir /tmp/slax-mobile-ui-feedback-focus-bundle-20261030`: exit 0; iOS and Android Hermes exports passed. The disposable task-owned export is removed after recording the result.
- `pnpm exec openspec validate --all --strict`: 88 passed, 0 failed. `git diff --check`: passed.
- Local Bugs/Security/Compliance review for `mobile-ui-polish`: no new Important implementation findings. The change removes only the explicit dismissal calls, preserves pending/ownership guards and submission behavior, and matches the owner's revised interaction requirement. The mounted fixture checks callback effects rather than native first-responder state; actual keyboard/cursor retention remains pending the owner's simulator exercise. The earlier full-suite failures/skips, version-retention decision, and pre-existing unrelated edits remain unchanged.

## Verification: remove brackets around the follow-up email

- Removed brackets from both English and Chinese follow-up translations. The existing mounted consent cases now verify the complete visible and accessibility labels with the substituted email and no brackets.
- `node --experimental-strip-types --test apps/mobile/tests/diagnostics/feedback-host.test.mjs`: exit 0; 17 passed, 0 failed, 0 skipped. `pnpm exec openspec validate --all --strict`: 88 passed, 0 failed. `git diff --check`: passed.
- This follow-up changes only localized copy and its existing expectations; typecheck and bundles were not repeated after the preceding successful verification. Native copy appearance remains part of the owner's pending acceptance. Version and interaction behavior are unchanged.

## Verification: native selection tint, Overview prefix, and quote-line color

- The owner's simulator observation disproved the earlier assumption that document caret styling alone would recolor their iOS native selection. The earlier Chrome check established CSS values only. Reader WKWebView did not set a native tint and could retain the default blue; its initializer now explicitly supplies RGB `(138, 216, 168)` through the public tintColor property. [WebKit's tint-color change and tests](https://bugs.webkit.org/show_bug.cgi?id=192518) support using this native customization path. This requires rebuilding the iOS app; existing native handles and system opacity are retained.
- The inline Overview prefix nested a SourceText with only a color override, so the component's base 16-point body style replaced the parent's 14-point excerpt typography. It now receives the same excerptText style explicitly, including line height and scaling, with its existing muted color. Expanded-dialog typography remains unchanged.
- Comment quote lines used a separate `#CCB69A` literal; they now use mobileColors.markStroke (`#F6AF69`), matching article CSS and PDF mark stroke. Existing below-text clearance and dashed/solid states are retained.
- `node --experimental-strip-types --test apps/mobile/tests/reader/overview-motion.test.mjs apps/mobile/tests/reader/parity-repairs.test.mjs apps/mobile/tests/ui/source-text-scaling.test.mjs`: exit 0; 14 passed, 0 failed, 0 skipped. Existing coverage exercises excerpt expansion, reduced/interrupted motion, comment decoration geometry/actions, and actual SourceText scaling.
- `pnpm mobile -- typecheck`: exit 0. `pnpm mobile -- bundle --output-dir /tmp/slax-mobile-ui-reader-refinement-bundle-20261030`: exit 0; iOS and Android Hermes exports passed.
- `pnpm exec openspec validate --all --strict`: 88 passed, 0 failed. `git diff --check`: passed.
- `SLAX_MOBILE_NO_LOCAL_CONFIG=1 pnpm mobile -- build:ios -derivedDataPath /tmp/slax-mobile-ui-native-selection-20261030 -hideShellScriptEnvironment`: exit 0, BUILD SUCCEEDED. The changed SlaxReaderView.swift compiled for arm64 and x86_64, and Xcode linked/validated the unsigned Debug simulator app. No app was installed or launched. Log: `/tmp/slax-mobile-ui-native-selection-build.log`; this is compilation evidence, not native selection-color acceptance.
- The task-owned simulator DerivedData and temporary JavaScript exports are disposable verification outputs and are removed after recording results; source and build logs remain. Local environment-file loading was disabled for the verification build.
- Local Bugs/Security/Compliance review for `mobile-ui-polish`: no new Important implementation findings. The native change uses public Reader-local tint configuration without modifying selection interception or account ownership. Prefix typography uses the existing scaling path, quote lines reuse the existing mark token, and native acceptance remains explicit. No new dependencies, services, uploads, or permissions are introduced.
- Native selection color and the two typography/color refinements have not been visually accepted by the owner yet. The earlier full-check failures/skips, version-retention decision, and unrelated local edits remain unchanged.
