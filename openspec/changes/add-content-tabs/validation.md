# Validation

## Scope and provenance

- Evidence date: 2026-11-17. Change: `add-content-tabs`; branch: `feat/add-content-tabs`; rebased onto `origin/dev` at `82f890c6`, with feature commit `f107122f`; target: `dev`.
- Worktree: `/Users/daguang/project/slax-reader/.local/worktrees/add-content-tabs`.
- Fresh Web suite, typecheck, build, Mobile check, and changed-file ESLint results below are supplied from verification on the rebased branch with the five staged Web fixes, run without local Web environment variables. This documentation-only follow-up does not claim to rerun those application checks; it runs scoped OpenSpec validation and `git diff --check`. Documentation-only edits are exempt from additional running-environment verification; the feature's existing implementation/runtime gaps remain open.
- Earlier application checks and device observations retain their implementation/review-session provenance. The requester's explicit 2026-11-17 renewed hands-on acceptance and version approval are recorded below. Earlier checks actually run for the versioned source are listed separately.
- Historical metadata-follow-up scope: `git diff --stat 2203281e` showed **20 tracked files, 1026 insertions, 153 deletions**, plus untracked `apps/web/tests/unit/utils/isPossibleFeedUrl.spec.ts` and this change directory. That follow-up added only the Mobile manifest and seven generator-owned native version files to that tracked scope; these are not current post-rebase diff counts.
- Scope includes Web modal/BookmarksPage/RssPanel routing and tests; Mobile Library/RssFeed/dialog/controller behavior and tests; localization; the shared RSS policy; development-manifest/OTA configuration tests; and the approved Mobile version metadata. At the human's request, this PR also includes the test-fixture, environment-independent runtime-config typing, and import-order fixes described below. No backend endpoint or database migration is added.
- The earlier metadata follow-up changed Mobile version metadata, approval/validation records, and `/tmp/add-content-tabs-pr-body.md`, without committing, pushing, creating a PR, releasing, signing, or uploading. This documentation follow-up edits only this repository document and prepares `/tmp/pr638-body-new.md` from the fetched PR #638 body; it leaves the five staged Web files unchanged and does not commit, push, or edit the PR. Web, Extension, and CLI versions are unchanged.

## Mobile File-session follow-up (2026-11-17)

- Step 2 reuses the uncommitted Step 1 `usePdfImportSession` unchanged. `LinkInputDialog` replaces `onImportPdf` with `pdfEnabled` and `onPdfSaved`; the hook's `active` remains the real `visible` prop. Picker/background hiding changes only `SourceDialog.visible`, not the session or autofocus/clipboard effect. Title editing retains its presentation and never requests a picker.
- File retains the accepted PDF metadata, filename/size, picker, upload/sync feedback, and the existing error line. Upload busy disables competing tabs while the existing close control remains available and aborts through `active=false`. No translations, tokens, chrome, tab styles, input styles, or button spacing changed.
- Library retains its account-keyed add component and PDF navigation/reset behavior, removes the separate dialog/state, and ends the unified add session on focus exit to preserve PDF cancellation. The Labs-refocus test now explicitly reopens that ended session without dropping its gate or URL assertions.
- Ported 47 meaningful PDF lifecycle tests to the actual File panel (62 existing tests retained in the PDF suite), and added 10 tests: two-platform cross-tab retention, two-platform cancellation preserving URL/feed drafts without autofocus/clipboard replay, close/reset, account replacement/unmount cleanup, two-platform busy-close abortion, and mode-scoped error styling. The PDF suite now has 72 tests; all four requested suites total 122. Explicit VM maps load the real hook; obsolete standalone-dialog maps were removed.
- Verification: `pnpm --filter @apps/slax-reader-mobile typecheck` passed (PDF-assets generation and `tsc --noEmit`). From `apps/mobile`, `node --test --test-reporter=dot tests/ui/pdf-import.test.mjs tests/ui/general-parity-regressions.test.mjs tests/ui/startup-readiness.test.mjs tests/ui/feed-scroll-and-drawer.test.mjs` passed: 122 tests, zero failures.
- `node apps/mobile/assets/verify-baseline.mjs` passed: 356 source files, 88 runtime assets, 217 localized keys, 169 migration protection keys, 27 stable test IDs; `sourceHashesVerified=false`. `node apps/mobile/tooling/architecture-check.mjs` passed: 253 modules, zero violations, three exact existing exceptions. `git diff --check` passed. `pnpm exec openspec validate --all --strict` passed: 143 items, zero failures; informational existing messages remain.
- Native gap: this focused implementation step did not launch a native build/device or submit a live acquisition request. The mounted iOS tests explicitly deliver `onDidDismiss` and verify picker ordering and navigation once after dismissal; they do not establish the actual UIKit callback timing. Android retains the existing 250ms picker delay. Tasks 4.3 and 5.3 remain open for native/live verification; no new hands-on acceptance is inferred.
- Task 4.2 is complete for implementation and mounted-host coverage. The recorded Mobile version decision remains unchanged. No commit, push, secret-file read, or process termination occurred; ports 8081 and 5799 were not touched.

## Review fixes reflected in the current results

### Web

- PDF selection preserves the shared URL/Feed address. URL validation errors remain scoped to URL; drafts reset on close.
- `BookmarksPage` passes `submit-feed` to the modal; Feed submission uses the existing RssPanel-owned `rss.add()`, selects the new subscription, and does not trigger the bookmark-success toast. RSS-panel Add entries open the unified dialog on Feed; the old add form is removed and rename remains separate.
- Added tests cover candidate policy, capability gates, hints, drafts, Feed ownership/failure, and contextual routing.
- `expiredSessionColdStart.spec.ts` now supplies `COOKIE_TOKEN_NAME` and `DWEB_API_BASE_URL` runtime config and restores it after each test. The stale fixture passed an undefined cookie name to `useCookie`, causing `cookie-es` serialization to read `.length` before expired/rejected-token recovery could run. Assertions are unchanged; this is not a product change.
- `userLocaleFallback.spec.ts` replaces an obsolete `useI18n` mock with explicit cookie-name/API-base runtime config. After commit `9a1737d3` introduced validated cookie reads, the stale setup's missing cookie name rejected before the server-confirmed/401 paths could run. Assertions are unchanged.
- `nuxt.config.ts` declares empty-string defaults for `PUBLIC_BASE_URL`, `AUTH_BASE_URL`, `COOKIE_DOMAIN`, `COOKIE_TOKEN_NAME`, `SHARE_BASE_URL`, `DWEB_API_BASE_URL`, and `GOOGLE_OAUTH_CLIENT_ID` before `...envConfig`. `config/env.ts` drops missing keys, so generated public runtime-config types previously omitted them without local environment variables, producing `unknown` at `ext-bridge.vue:344,349`; CI supplies those values. Environment values still override the defaults, and the only fallback read uses `|| ''`, so runtime behavior is unchanged.
- `BookmarksPage.vue` and `FeedPanel.vue` receive import-order-only fixes for `simple-import-sort`. The previously recorded test/typecheck/import-order failures are resolved by these changes in this PR, not left as pre-existing failures.

### Mobile

- `onSubmitFeed` returns `Promise<boolean>`. The dialog shows busy state, blocks duplicate submission and tab switching, dismisses only on success, retains drafts and localized controller errors on failure, and ignores late results.
- Feed and its hint use `confirmedEnabled`, set only when a current `rssLabs()` response enables RSS. Cached `enabled` remains available for offline RSS browsing, not acquisition authorization. RSS rail/empty/header Add entries open Feed when confirmed, otherwise Settings; removal of the active gate resets mode to URL.
- File remains independent of the Feed callback. The follow-up restores `pdfEnabled` as the actual tab gate, removes the standalone PDF handoff, and implements the session-owned file draft as detailed above.
- The latest SourceUI edit rewrites its explanatory comment without changing keyboard code. `SLAX_MOBILE_DEV_MANIFEST` is ignored when `SLAX_MOBILE_OTA=1`.
- Earlier finalization fixes remain: new translations live in `appMessages.ts`, not the locked `messages.ts` source catalogue (217-key baseline); Mobile test hosts load real `isPossibleFeedUrl` and open PDF import through File.

## Automated checks

Fresh results on base `82f890c6` with the staged fixes supersede the earlier full Web failures, environment-dependent Web typecheck failure, changed-file lint errors/warning count, and Mobile test count. Historical focused/export/repository-wide checks remain separately qualified. Passing scoped checks do not imply repository-wide lint cleanliness or overall feature completion.

| Command or test target | Current result | Qualification |
| --- | --- | --- |
| `pnpm mobile -- check` | **PASS: 1318/1318 tests** | Fresh post-rebase result; architecture, asset/i18n baseline, fixtures, RSS controller verification, typecheck, and tests passed. |
| `EXPO_NO_DOTENV=1 pnpm mobile -- bundle` | **PASS** | Earlier Android/iOS export; not native iOS verification. |
| `pnpm web -- build` | **PASS** | Fresh post-rebase result without local Web environment variables; build success does not replace browser evidence. |
| Focused Web suites | **PASS: 128 total** | Earlier supplied result: AddUrlTopModal 36; RssPanel 11; isPossibleFeedUrl 16; bookmarks-page integration 65. |
| `pnpm --filter @apps/slax-reader-dweb test` | **PASS: 3098 passed, 3 skipped, 0 failures** | Fresh full Web run: 251 files, 250 passed and 1 skipped, without local Web environment variables. Both stale test setups are fixed in this PR; assertions are unchanged. |
| `pnpm web -- typecheck` | **PASS** | Fresh post-rebase result without local Web environment variables. Explicit public runtime-config defaults resolve the generated-type errors formerly reported at `ext-bridge.vue:344,349`. |
| ESLint on all Web files changed versus `origin/dev` | **0 errors, 34 warnings** | Fresh changed-file result. Repository-wide Web lint still has other import-order errors outside this change; CI does not run Web lint. No zero-warning or repository-wide lint pass is claimed. |
| `openspec validate --all --strict` | **PASS: 134** | Earlier supplied repository-wide result, not a fresh result on `82f890c6`; separate from the scoped check below. |
| `git diff --check` | **PASS** | Run for this documentation follow-up; does not claim a clean worktree or modify the staged Web files. |
| `pnpm exec openspec validate add-content-tabs --strict` | **PASS, exit 0** | Scoped validation for this documentation follow-up: `Change 'add-content-tabs' is valid`. Historical metadata/template/task checks retain their original provenance and are not represented as new runs. |

<!-- RESULT: verification-invocations --> Exact runner invocations for the earlier focused Web suites, historical clean-base comparison, and changed-file ESLint were not supplied; no missing command is invented. The fresh full-suite command is recorded above. The historical clean-base failures are superseded by the fixes and fresh passing results, not an unresolved blocker.

### Scenario coverage and task boundaries

- `apps/web/tests/unit/utils/isPossibleFeedUrl.spec.ts` covers 16 positive path/query, false-positive, invalid-scheme/address, and original-address preservation cases (task 2.1).
- `AddUrlTopModal.spec.ts` covers four gate combinations, unknown/removed gates, explicit hint switching/dismissal without detection requests, cross-mode address/name/PDF retention, picker cancellation, owner submission, failure/busy behavior, and close-reset behavior (task 3.1).
- `RssPanel.spec.ts` and bookmarks-page integration tests establish contextual Add routing, existing-owner submission/selection, no bookmark toast, failure retention, and the separate rename form. URL/PDF component regressions also pass. Task 3.2 remains open because the specific **URL local-first/fork integration** proof in its wording is not identified by the supplied results or inspected integration cases; the routing itself is no longer missing.
- Mobile mounted-host tests cover confirmed versus cached gating, mode entry/removal, Feed busy/error/late-result behavior, clipboard prefill, and unchanged title editing (task 4.1). The follow-up ports PDF lifecycle tests to File and adds single-session cross-tab draft coverage (task 4.2); native acceptance remains separate.
- Task 5.2 records completion of running/documenting the requested automated checks, now including the fresh passing Web suite/typecheck/build and Mobile check. Changed-file ESLint has no errors but retains warnings; repository-wide Web lint is not clean. This does not certify overall feature completion.

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

### Mobile File tab session (follow-up to PR review)

- The automated PR review flagged that Mobile did not satisfy "the selected file SHALL remain available when switching away and back" and the "File picker cancellation" scenario. The requester chose to implement the requirement rather than narrow the spec.
- `apps/mobile/src/pdf/usePdfImportSession.ts` now owns PDF selection, temporary-file release, Labs preflight, upload, background abort and saved-row watching (extracted unchanged from the former `PdfImportDialog`). `LinkInputDialog` uses it for the File tab, so the selected PDF and the URL/Feed drafts survive tab switches; the picker hides the dialog without ending the session and a cancelled picker returns to the same session with File selected. `PdfImportDialog.tsx` was removed.
- Verification: `pnpm mobile -- check` **PASS, 1328/1328 tests**; `EXPO_NO_DOTENV=1 pnpm mobile -- bundle` **PASS**; `pnpm exec openspec validate --all --strict` **PASS (143)**; `git diff --check` **PASS**.
- **Not verified:** the new in-dialog File flow was not exercised on an Android or iOS device (the device check was stopped and the device then disconnected), and the requester has not yet given hands-on acceptance of this follow-up behavior. Real picker/modal timing on iOS remains unverified.

### iOS

No iOS device run occurred. The successful `EXPO_NO_DOTENV=1 pnpm mobile -- bundle` export is not evidence of native rendering, keyboard handling, picker lifecycle, or human iOS acceptance.

## Human review and acceptance boundary

- **Who/when:** the change requester, repository owner and GitHub user behind this checkout, on **2026-11-17**. No unprovided GitHub handle is invented.
- **Reviewed:** earlier Web Link/Subscription/File screenshots and Android Subscription screenshots with and without the keyboard. The requester stated that UI and frontend review were complete with no problems and asked to open the PR. This is screenshot review; no personal operation of unrecorded flows is asserted.
- **Adjusted before that review:** Chinese labels `链接` / `订阅` / `文件`; Feed placeholder `RSS 地址` (RSS address); removal of URL-tab PDF import; restored Mobile title weight, 50-point input height, 8-point radius, 12-point horizontal padding, default green full-width action, and text-only tabs following the LoginScreen agreement tabs; Android avoidance moves the dialog up without resizing.
- **Renewed hands-on acceptance, 2026-11-17:** the change requester explicitly confirmed that they looked at the UI and it had no problems, including the post-review behavior: Mobile Feed busy/error feedback stays in the dialog, RSS Add entries open the unified dialog on Feed, and Web Feed submission uses the existing RSS owner. This records the requester's supplied hands-on acceptance under `DESIGN.md` §10.2, not an additional agent-run device/browser session.
- This renewed acceptance supersedes the earlier pending-acceptance record. It does not close the separate implementation gap, prove unrecorded live-service calls, or establish the full runtime/platform matrix. Task 5.1 still records the earlier demonstrated feedback.
- **Hands-on acceptance of the File tab and tab refinement, 2026-11-18:** the change requester stated they completed hands-on acceptance in both the Android app and the Web dialog and that their tests had no problems. This covers the in-dialog Mobile File session (picked PDF kept across tab switches; cancelled picker returns to the same session) and the refinement made at their request: Mobile tabs gained a full-width hairline divider and a green underline under the selected label; the Mobile File panel became one dashed picker card ("选择 PDF 文件" / "单个 PDF，最大 50 MiB", and the file name, size and "更换" once chosen); the separate `pdf_limit` sentence and "选择 PDF" text link were removed; the primary button reads "选择 PDF" until a file is chosen and "上传" afterwards. Web keeps its existing File panel and tab styling.
- No separate pre-implementation approval covering the complete optional §10.1 state/theme/width matrix is inferred. See `proposal.md` for the same boundary.

## Remaining gaps, review, and publication

| Area | Gap and reason |
| --- | --- |
| Full Web runtime and visual matrix | The session used the isolated Chinese/light/~1200px demo, not `/bookmarks`; no post-fix browser routing/service exercise or complete theme/width/locale/accessibility matrix is supplied. Tasks 1.2 and 3.3 remain open. |
| URL local-first/fork integration | Specific integration evidence required by task 3.2 has not been identified; passing owner-routing tests do not imply every URL acquisition branch is covered. |
| Mobile file-session implementation | Implemented with 122 passing scoped mounted-host tests in the follow-up; task 4.2 is complete. Actual native modal/picker timing and live acquisition remain open under tasks 4.3 and 5.3. |
| Native post-fix state matrix | User-requested keyboard-free testing stopped at the autofocus limitation; RSS rail Add was absent on this account. Feed/hint/File/gate/error/busy states were not all re-exercised. No iOS device run or matched source/target appearance matrix exists. Task 4.3 remains open. |
| Real acquisition calls and smoke flows | No server URL-save, RSS-add, or PDF-upload success/failure calls occurred; original real-call scenarios and full affected-app smoke flows remain unverified. Tests are not presented as live server submissions. Task 5.3 remains open. |
| Readiness | Web typecheck now passes without local Web environment variables; the earlier generated-type issue is resolved in this PR. Human hands-on acceptance and the Mobile version decision remain recorded. Task 5.4's handoff checks are complete, but the separate implementation/runtime gaps and remaining tasks prevent an overall-completion claim. |

- **Prescribed review:** the requester confirms that the `REVIEW.md` local pre-push Bugs/Security/Compliance review was run and its reported findings were fixed afterwards. This is supplied review evidence, not a fresh full review by this metadata follow-up. The follow-up implements task 4.2; no unqualified final compliance all-clear or complete-feature claim is inferred because native and live-service verification remain open.
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
