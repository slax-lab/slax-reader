# Validation

## Scope and provenance

- Evidence date: 2026-11-17. Change: `add-content-tabs`; branch: `feat/add-content-tabs`; base: `2203281e`; target: `dev`.
- Worktree: `/Users/daguang/project/slax-reader/.local/worktrees/add-content-tabs`.
- Earlier application checks and device observations are supplied from the implementation/review session; they were not repeated in this metadata follow-up. The requester's explicit 2026-11-17 renewed hands-on acceptance and version approval are recorded below. Checks actually run for the versioned source are listed separately.
- Before the metadata follow-up, `git diff --stat 2203281e` showed **20 tracked files, 1026 insertions, 153 deletions**, plus untracked `apps/web/tests/unit/utils/isPossibleFeedUrl.spec.ts` and this change directory. The follow-up adds only the Mobile manifest and seven generator-owned native version files to that tracked scope.
- Scope includes Web modal/BookmarksPage/RssPanel routing and tests; Mobile Library/RssFeed/dialog/controller behavior and tests; localization; the shared RSS policy; development-manifest/OTA configuration tests; and the approved Mobile version metadata. No backend endpoint or database migration is added.
- No commit, push, PR creation, release, signing, or upload occurred. The follow-up changes Mobile version metadata, these approval/validation records, and `/tmp/add-content-tabs-pr-body.md`; Web, Extension, and CLI versions are unchanged.

## Review fixes reflected in the current results

### Web

- PDF selection preserves the shared URL/Feed address. URL validation errors remain scoped to URL; drafts reset on close.
- `BookmarksPage` passes `submit-feed` to the modal; Feed submission uses the existing RssPanel-owned `rss.add()`, selects the new subscription, and does not trigger the bookmark-success toast. RSS-panel Add entries open the unified dialog on Feed; the old add form is removed and rename remains separate.
- Import-sort lint was corrected. Added tests cover candidate policy, capability gates, hints, drafts, Feed ownership/failure, and contextual routing.

### Mobile

- `onSubmitFeed` returns `Promise<boolean>`. The dialog shows busy state, blocks duplicate submission and tab switching, dismisses only on success, retains drafts and localized controller errors on failure, and ignores late results.
- Feed and its hint use `confirmedEnabled`, set only when a current `rssLabs()` response enables RSS. Cached `enabled` remains available for offline RSS browsing, not acquisition authorization. RSS rail/empty/header Add entries open Feed when confirmed, otherwise Settings; removal of the active gate resets mode to URL.
- Removed the unused `pdfEnabled` prop; File remains independent of the Feed callback. **File still hands off to the existing `PdfImportDialog`; a single acquisition-session file draft is not implemented.** This is an implementation gap, not merely missing verification.
- The latest SourceUI edit rewrites its explanatory comment without changing keyboard code. `SLAX_MOBILE_DEV_MANIFEST` is ignored when `SLAX_MOBILE_OTA=1`.
- Earlier finalization fixes remain: new translations live in `appMessages.ts`, not the locked `messages.ts` source catalogue (217-key baseline); Mobile test hosts load real `isPossibleFeedUrl` and open PDF import through File.

## Automated checks

These results replace the earlier 1245-test Mobile and 18-test focused Web results and obsolete pending results. No all-green claim is made.

| Command or test target | Current result | Qualification |
| --- | --- | --- |
| `pnpm mobile -- check` | **PASS: 1272/1272 tests** | Architecture, asset/i18n baseline, fixtures, RSS controller verification, typecheck, and tests passed. |
| `EXPO_NO_DOTENV=1 pnpm mobile -- bundle` | **PASS** | Android/iOS export; not native iOS verification. |
| `pnpm web -- build` | **PASS** | Build success does not replace typecheck or browser evidence. |
| Focused Web suites | **PASS: 128 total** | AddUrlTopModal 36; RssPanel 11; isPossibleFeedUrl 16; bookmarks-page integration 65. |
| Full Web suite | **FAIL overall: 2928 passed, 4 failed, 25 skipped (2957 total)** | Two failures each in `expiredSessionColdStart.spec.ts` and `userLocaleFallback.spec.ts` fail identically on base `2203281e` in a clean temporary worktree. These four failures are established as pre-existing and unrelated. |
| `pnpm web -- typecheck` | **FAIL: TS2322 at unchanged `apps/web/app/pages/x/ext-bridge.vue:344,349` only** | Local generated runtime types lack public-config fields. Recent dev CI run `44006785639` passed Web typecheck. Treated as a local-environment failure; **not reproduced on a clean base**, unlike the four suite failures. This is not a proven clean-base failure or a local typecheck pass. |
| ESLint on changed Web files | **0 errors, 27 pre-existing warnings** | Supplied changed-file scope; not a zero-warning or repository-wide lint claim. |
| `openspec validate --all --strict` | **PASS: 134** | Supplied repository-wide result, separate from the scoped check below. |
| `git diff --check` | **PASS** | Supplied result for tracked changes; untracked documents require separate whitespace inspection. |
| `pnpm exec openspec validate add-content-tabs --strict` | **PASS, exit 0** | Run during this documentation update after edits: `Change 'add-content-tabs' is valid`. `git diff --check` also passed. Separate checks passed for exact PR-template headings, OpenSpec line, all 13 tasks and intended checkbox states, and whitespace in all four edited documents. Final `git status --short` retained the same 20 modified tracked implementation files, untracked policy test, and change directory; no additional repository artifacts appeared. |

<!-- RESULT: verification-invocations --> Pending exact runner invocations for the focused/full Web suites, clean-base comparison, and changed-file ESLint. Their supplied results are recorded above; no missing command is invented.

<!-- VERIFY: ext-bridge --> Pending a reproducible local generated-types/typecheck resolution or clean-base comparison. The available evidence supports the stated local-environment treatment, not an assertion that the same errors were reproduced on base.

### Scenario coverage and task boundaries

- `apps/web/tests/unit/utils/isPossibleFeedUrl.spec.ts` covers 16 positive path/query, false-positive, invalid-scheme/address, and original-address preservation cases (task 2.1).
- `AddUrlTopModal.spec.ts` covers four gate combinations, unknown/removed gates, explicit hint switching/dismissal without detection requests, cross-mode address/name/PDF retention, picker cancellation, owner submission, failure/busy behavior, and close-reset behavior (task 3.1).
- `RssPanel.spec.ts` and bookmarks-page integration tests establish contextual Add routing, existing-owner submission/selection, no bookmark toast, failure retention, and the separate rename form. URL/PDF component regressions also pass. Task 3.2 remains open because the specific **URL local-first/fork integration** proof in its wording is not identified by the supplied results or inspected integration cases; the routing itself is no longer missing.
- Mobile mounted-host tests cover confirmed versus cached gating, mode entry/removal, Feed busy/error/late-result behavior, clipboard prefill, and unchanged title editing (task 4.1). Existing PDF tests cover handoff lifecycle; they do not implement the missing single-session cross-tab file draft (task 4.2).
- Task 5.2 records completion of running/documenting the requested automated checks, including the qualified failures above. It does not certify an all-green check set or overall feature completion.

## Running-environment evidence

### Web: earlier real-component demo

The earlier screenshots came from `http://localhost:5799`, served from gitignored `.local/demo`, mounting the actual `AddUrlTopModal.vue` with Labs toggles. Link, Subscription, and File were captured in Chinese, light theme, at approximately 1200px viewport width; exact height was not recorded. This was **not the logged-in `/bookmarks` route**. It proves the shown real-component rendering, not authenticated routing or live service behavior. No new post-fix browser exercise is supplied.

The complete desktop/768px/320px matrix, dark/e-ink, English, keyboard navigation/focus restoration, overflow, and error/busy states were not exercised in a browser. Having Labs toggles does not prove the full matrix was exercised at runtime. No URL save, subscription, or PDF upload was submitted against a server.

### Android: earlier pre-fix Subscription keyboard evidence

- Android development build `com.slax.reader`, Pixel 9 Pro Fold, via ADB. OS version, font scale, exact viewport, and system-appearance settings were not recorded.
- Subscription was opened and the RSS-address input focused. Title: `添加内容` (Add content); tabs: `链接` / `订阅` / `文件` (Link / Subscription / File); RSS address, optional name, and original green action were visible.
- Without keyboard: `[29,874][1051,1702]`; with keyboard: `[29,490][1051,1318]`. Both **1022 × 828 physical pixels**, translated upward **384px** without resizing, with inputs/action visible.
- This measurement stands as evidence from **before the subsequent behavior fixes**. It was not repeated after them and does not establish other devices, keyboards, or states.

### Android: post-fix re-verification and stop condition

- Inbox `+` opens the real dialog with title `添加内容` (Add content), tabs `链接` / `订阅` / `文件`, empty input, and button `添加收藏` (Add bookmark). Capture: `/tmp/slax-verify-url.png`, not committed.
- Further on-device tab/keyboard-free verification stopped because the pre-existing input autofocus approximately 350ms after opening raises the soft keyboard; hiding it with a key event dismisses the dialog. **The user requested testing that does not raise the keyboard**, so the remaining flow was not exercised or worked around.
- The RSS rail Add entry was not visible on this account's rail during re-verification. Native post-fix RSS entry routing, Feed busy/error behavior, and additional tab states therefore remain unverified on-device despite automated coverage.
- No subscription, URL save, or PDF upload was submitted against a server.

### iOS

No iOS device run occurred. The successful `EXPO_NO_DOTENV=1 pnpm mobile -- bundle` export is not evidence of native rendering, keyboard handling, picker lifecycle, or human iOS acceptance.

## Human review and acceptance boundary

- **Who/when:** the change requester, repository owner and GitHub user behind this checkout, on **2026-11-17**. No unprovided GitHub handle is invented.
- **Reviewed:** earlier Web Link/Subscription/File screenshots and Android Subscription screenshots with and without the keyboard. The requester stated that UI and frontend review were complete with no problems and asked to open the PR. This is screenshot review; no personal operation of unrecorded flows is asserted.
- **Adjusted before that review:** Chinese labels `链接` / `订阅` / `文件`; Feed placeholder `RSS 地址` (RSS address); removal of URL-tab PDF import; restored Mobile title weight, 50-point input height, 8-point radius, 12-point horizontal padding, default green full-width action, and text-only tabs following the LoginScreen agreement tabs; Android avoidance moves the dialog up without resizing.
- **Renewed hands-on acceptance, 2026-11-17:** the change requester explicitly confirmed that they looked at the UI and it had no problems, including the post-review behavior: Mobile Feed busy/error feedback stays in the dialog, RSS Add entries open the unified dialog on Feed, and Web Feed submission uses the existing RSS owner. This records the requester's supplied hands-on acceptance under `DESIGN.md` §10.2, not an additional agent-run device/browser session.
- This renewed acceptance supersedes the earlier pending-acceptance record. It does not close the separate implementation gap, prove unrecorded live-service calls, or establish the full runtime/platform matrix. Task 5.1 still records the earlier demonstrated feedback.
- No separate pre-implementation approval covering the complete optional §10.1 state/theme/width matrix is inferred. See `proposal.md` for the same boundary.

## Remaining gaps, review, and publication

| Area | Gap and reason |
| --- | --- |
| Full Web runtime and visual matrix | The session used the isolated Chinese/light/~1200px demo, not `/bookmarks`; no post-fix browser routing/service exercise or complete theme/width/locale/accessibility matrix is supplied. Tasks 1.2 and 3.3 remain open. |
| URL local-first/fork integration | Specific integration evidence required by task 3.2 has not been identified; passing owner-routing tests do not imply every URL acquisition branch is covered. |
| Mobile file-session implementation | File hands off to `PdfImportDialog`; a single-session file draft across acquisition tabs is not implemented. Task 4.2 remains open; tests of the existing handoff do not close this design/spec gap. |
| Native post-fix state matrix | User-requested keyboard-free testing stopped at the autofocus limitation; RSS rail Add was absent on this account. Feed/hint/File/gate/error/busy states were not all re-exercised. No iOS device run or matched source/target appearance matrix exists. Task 4.3 remains open. |
| Real acquisition calls and smoke flows | No server URL-save, RSS-add, or PDF-upload success/failure calls occurred; original real-call scenarios and full affected-app smoke flows remain unverified. Tests are not presented as live server submissions. Task 5.3 remains open. |
| Typecheck and readiness | Local Web typecheck still fails as qualified above. Human hands-on acceptance and the Mobile version decision are now recorded. Task 5.4's handoff checks are complete, but the separate implementation/runtime gaps and remaining tasks prevent an overall-completion claim. |

- **Prescribed review:** the requester confirms that the `REVIEW.md` local pre-push Bugs/Security/Compliance review was run and its reported findings were fixed afterwards. This is supplied review evidence, not a fresh full review by this metadata follow-up. The single-session Mobile file-draft requirement remains explicitly unimplemented in task 4.2; no unqualified final compliance all-clear or complete-feature claim is inferred.
- **Mobile version decision, approved 2026-11-17:** the requester explicitly approved **1.0.31 → 1.0.32**, **buildNumber 806 → 807**, and **previousBuildNumber 805 → 806**. The previous bound is the prior approved source build, not an independently checked store publication. `docs/mobile/release.md`, `parseBuildVersion`, and the CI `compareMobileVersion` contract require a valid three-part version and a higher integer build with a lower previous bound.
- **Generated metadata:** Git confirmed the existing Android/iOS native version files are tracked, not ignored. Ran `env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" CI=1 EXPO_NO_DOTENV=1 EXPO_OFFLINE=1 SLAX_MOBILE_NO_LOCAL_CONFIG=1 pnpm mobile -- prebuild` successfully; the existing command runs `expo prebuild --no-install --no-clean`. Both existing native projects were reused. Android versionName/versionCode, Android share metadata, iOS main/share versions and Android/iOS runtime versions are now **1.0.32 / 807 / 1.0.32(807)**. The only unrelated output change, an unconfigured-Firebase flag in `ios/Podfile`, was restored exactly to its verified pre-run bytes. No native output was hand-patched to supply version values. No CocoaPods install, native build, signing, upload, or publication was run.
- `SLAX_MOBILE_DEV_MANIFEST` is a new non-secret development switch, ignored during OTA (`SLAX_MOBILE_OTA=1`); the PR template's combined no-new-environment-variables checkbox cannot truthfully be checked. No operator secret files were read. Processes on ports 8081 and 5799 were left untouched.

### Versioned-source follow-up checks (2026-11-17)

| Command or check | Observed result |
| --- | --- |
| `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 node --test apps/mobile/tests/release/*.test.mjs tooling/ci-workflow.test.mjs` | **PASS: 54 tests, 0 failures, 0 skipped.** Includes the discovered Mobile version assertions in `ios-release.test.mjs`, OTA configuration tests, all other release unit tests, and CI monotonic-version checks. The standalone native ABI compatibility host probe is not a package-version test and was not run. |
| `node apps/mobile/assets/verify-baseline.mjs` | **PASS:** 356 source files, 88 runtime assets, 217 localized keys, 160 migration protection keys, 27 stable test IDs; `sourceHashesVerified` is false, as reported by the verifier. |
| `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm --filter @apps/slax-reader-mobile typecheck` | **PASS:** standard PDF-assets pretypecheck generation and `tsc --noEmit`, exit 0. |
| Direct `readBuildVersion()` / `compareMobileVersion()` assertions and seven native metadata file checks | **PASS:** exact source values 1.0.32 / 807 / 806, increasing build from 806, matching generated main/share/runtime metadata, no stale 1.0.31 or 806 in those generated version files. |
| `pnpm exec openspec validate --all --strict` | **PASS: 134 passed, 0 failed.** Informational pre-existing messages are not validation failures. |
| `git diff --check`; `git status --short` | **PASS; inspected.** Existing implementation changes remain; only eight intended Mobile version files are added to the tracked scope. No task-created repository logs or new untracked build artifacts appeared. |

Task 5.4 is complete for its stated version decision, human acceptance, prescribed-review run, strict validation, status inspection, and authorization checks. Other open tasks retain their original boundaries. No commit, push, PR creation, release, or unrelated cleanup occurred.
