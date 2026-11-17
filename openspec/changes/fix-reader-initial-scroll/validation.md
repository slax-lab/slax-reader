# Implementation Evidence

## Approval and workspace

- The requesting project owner approved the combined OpenSpec proposal on 2026-11-17 and explicitly requested implementation with navigation, highlight, and permission regression verification.
- Dedicated managed worktree: `/Users/yjc/.codex/worktrees/fix-reader-initial-scroll/slax-reader-v2`.
- Branch: `fix/fix-reader-initial-scroll`, created directly from `origin/dev` (`4c4925a1`). Unrelated source-workspace changes are untouched; the approved planning package was copied into this worktree.
- The original browser trace recorded approximately 9572px -> 0 via Vue Router initial navigation, then approximately 4163px via local progress restoration. The release-source subscription experiment reproduced rejected Chat/Analysis guards while a paid profile refresh was pending and allowed both after the identical profile resolved.

## Task ledger

- 1.1: workspace and approval recorded; dependencies installed with the frozen lockfile. No dependency or lockfile change is required.

## Checks and runtime verification

Code implementation and targeted agent verification are complete. The integrated smoke/BFCache gaps below remain explicit. Human hands-on acceptance is recorded below; the task branch is prepared for PR delivery; merge, deployment, and archive remain pending.
- Baseline: existing `useBookmark.spec.ts` and `useSidePanelPreference.spec.ts` passed; new tests reproduced 6 scroll cancellation defects and 2 subscription startup defects (8 failures, 41 passes across four files). After the focused restoration fix, all 7 reading-position cases pass.
- Review feedback: adopt current-account-derived subscription status, explicit unknown/error handling, reactive updates at the existing store/account boundary, and removal of the redundant cached `getUserInfo()` call. Ruling: retain `tasksReady`'s existing detail/mark dependency because it controls only initial automatic panel choice; manual panel permission readiness is separated instead. Changing the initial-panel heuristic is unnecessary for the approved fix and could change comment-first behavior.


## Implementation decisions and review

- Subscription access derives reactively from the existing account context and the matching server-confirmed profile, using the existing expiry/type calculation. Persisted profile data alone cannot grant access. Refresh uses the existing identity-sensitive `refreshServerUserInfo` path so an optional offline profile fallback cannot masquerade as successful verification or leave checking unresolved.
- The redundant cached profile lookup and the parallel initial detail identity refresh are removed. Manual panel selection can wait independently of `tasksReady`; existing automatic comment-first selection is retained unless the reader has already chosen a panel.
- A fresh whole-branch Bugs/Security/Compliance review found and resolved: automatic panel initialization overriding a pending manual selection; a same-path highlight losing its intent after query cleanup; and setup-time window listeners requiring an SSR guard. Follow-up review accepted the early page-completion hook registration and direct verified-profile refresh. No remaining Important code or security findings were reported. Delivery gates below remain pending.

## Automated checks so far

- Focused scroll/bootstrap/subscription/bookmark suite: 57 passed. Real subscription gate plus real bookmark caller: 5 passed. Accessible status component: 4 passed. Expanded navigation/lifecycle coverage and the final full-suite result are recorded below.
- `pnpm web -- typecheck`: passed after resolving the new promise initialization type error. The final check below ran after stopping the dev server to avoid sharing Nuxt generated files between commands.
- `pnpm exec openspec validate --all --strict`: 141 items passed, zero failures.
- `pnpm web -- lint`: initial full run reported 98 import-sort errors and existing warnings across the repository, including changed files. Autofix was limited to this change's files; changed-file lint then reported zero errors, 18 warnings. Final changed-file/full lint results will be recorded below.
- Initial `pnpm web -- test` without deployment environment: 3064 passed, 12 failed, 3 skipped. Rechecking the four failing files with explicit synthetic public config passed both identity/session files; eight assertions still fail in unchanged `useSlaxRoutes.spec.ts` and `BookmarkHighlightCell.spec.ts`, expecting links without the existing `_slax_entry=bookmarks` suffix. These source modules and link behavior are outside this diff. The final correctly configured full result is recorded below.

## Running Nuxt evidence so far

- Opt-in layer: `apps/web/tests/fixtures/reader-startup`; actual Nuxt reader/page, router, renderer, account store and PowerSync database. Backend content/profile replies and accounts are synthetic; the user's account and real subscription are untouched.
- `browser_check.py` delays the real main entry module independently of local-ready and saved-position reads, instruments application `scrollTo` calls, seeds the real local database, and writes JSON/screenshots/recordings under `/tmp/slax-reader-startup-evidence` (media is not committed).
- Before-client input: REST and local paths both retained Passage 15; y approximately 5500 to 5528 with **zero application scrollTo calls**. The 28px difference accompanies header/layout settlement with the same reading paragraph; it is not a default-top or saved-progress jump. The assertion checks the visible passage as well as bounded displacement, and initial cases additionally require no application scrolling.
- No-interaction positive control: local anchor restores Passage 15 at y5550.
- Input during separately delayed readiness and saved-position loading retains Passage 22 after the final correction window, rather than restoring Passage 15.
- Ordinary SPA navigation to an unsaved article ends at y0. Back returns to Passage 28 at y10550 even after the local DB anchor is deliberately changed to Passage 5; Forward returns to y0. An ordinary SPA navigation to a separately seeded article restores Passage 31. The latter caught a lifecycle defect in the first implementation; registering page completion during setup fixed it.
- Hash navigation reaches Passage 40 at y15080 and query-only replacement retains it. Subsequent permission, highlight/reply, reload and presentation results, plus the true-BFCache gap, are recorded below.

## Test-environment troubleshooting

- Commands that generate Nuxt files and a live Nuxt dev process must run sequentially in this worktree; running Vitest/prepare concurrently caused dev reloads and an initial browser navigation timeout. The server was restarted with an explicit IPv4 host and synthetic public config.
- For scroll assertions, considered freezing layout/fonts, disabling native scroll anchoring, measuring only y, or measuring the visible paragraph plus application scroll calls. Chose the last approach to preserve actual browser behavior. Browser scroll anchoring intentionally adjusts coordinates to maintain the visible content through layout changes ([W3C scroll anchoring](https://www.w3.org/TR/css-scroll-anchoring/)).
- Considered explicit context disposal, a bundled compatible headless shell, browser-process cleanup, or changing Chrome launch flags for slow browser teardown. The regression runner uses the bundled headless shell and explicitly closes disposable database/context state; no product workaround was added.


## Permission and presentation exercise

- Real reader with held profile replies: pending Chat and protected Analysis show local checking feedback, mount no protected Chat while unresolved, and open the originally selected panel after active confirmation with no upgrade modal.
- A failed profile produces an explicit error/retry state with no upgrade modal; retry reaches Chat after active confirmation. Confirmed expiry shows the existing upgrade modal and mounts no Chat. Choosing Comment while checking leaves Comment selected after confirmation and does not mount/reopen Chat. An anonymous visitor retains existing public Outline access.
- Checking/error/retry exercised at 375, 768 and 1280px in light/dark/e-ink using the real theme controls. Retry remains at least 44px tall, inside the viewport, and keyboard focusable; no horizontal overflow or upgrade prompt occurs on failure. Initial matrix screenshots revealed that a directly assigned HTML theme attribute was overwritten by color-mode; these captures were discarded and all nine combinations were rerun through the actual theme switcher.
- Highlight, root reply, same-path new highlight followed by query consumption, and comment-card locators reach Passage 40 and remain there after a delayed local reading-position result. In these cases the real local SQL tables and query watchers are used; the fixture simulates only the absent remote stream checkpoint because `waitForStream: true` otherwise correctly waits forever for the deliberately unavailable synthetic sync service. No SDK or product query is changed. This is not end-to-end verification of a deployed PowerSync service.


## Final automated verification

Run with the explicit synthetic public configuration documented in the fixture README:

- `pnpm web -- test`: **3089 passed, 8 failed, 3 skipped** across 255 files. The eight failures are the pre-existing link suffix expectations in `useSlaxRoutes.spec.ts` (five) and `BookmarkHighlightCell.spec.ts` (three); their implementations and tests are unchanged by this change. All 78 focused cases in the eight touched/new scroll, navigation, subscription, bookmark and status suites pass in this full run.
- `pnpm web -- typecheck`: **passed**, including a fresh Nuxt prepare after stopping the live server.
- Changed-file ESLint (all production/test/config files in this diff): **zero errors**, 24 warnings (primarily explicit-any patterns in test mocks). `pnpm web -- lint`: 88 import-sort errors in **88 unchanged files**, 455 warnings. Compared every error-bearing file against the diff; none is changed here. No unrelated files were reformatted.
- `pnpm exec openspec validate --all --strict`: **141 passed, zero failed**.
- `git diff --check` and Python fixture-script compilation: **passed**.
- Additional red/green regressions: a browser-established position appearing during the local query initially produced five old-position scroll calls, then passed after first-restore eligibility was rechecked; a new account initially failed to request a profile, then the real incremental key-before-generation sequence exposed incorrect merging with an older request. The final gate batches the account transition and coalesces by account plus generation. No failure-triggered automatic retry was added.
- Final reviewer confirmed the incremental-account fix and reported no remaining Important Bugs/Security findings. Local Compliance review matches `fix-reader-initial-scroll`; the pending hands-on/PR gates below are explicit and not claimed complete.

## Delivery gates and verification limits

- Human hands-on acceptance was completed before PR creation, as recorded below. The implementation is committed on the dedicated task branch; PR delivery targets `dev`. No merge, deployment, or archive is performed by this task.
- Changes remain Web-only. CLI, Extension, Mobile, shared contracts, runtime dependencies, and package versions are unchanged; no affected-application version decision is needed under the repository rule.
- Real OAuth login, a production/development account's live subscription and server authorization denials, deployed PowerSync streaming, an actual PDF asset, and the paired installed Extension `/x/ext-bridge` flow are not exercised by these isolated fixtures. They require configured integrated services/accounts/assets unavailable in this worktree. The existing auth/session/store and PDF/chat error-handling suites ran in the full test run; they do not replace that integration verification.
- No causal before/after LCP reproduction-rate benchmark is claimed. The defects predate the LCP work; earlier readable HTML can expose the startup window, while this fix retains those optimizations.


## Clean server restart

After the final automated checks, restarted the opt-in Nuxt server with the documented
synthetic configuration. A fresh HTTP response for `/b/reader-one` contains the long
article paragraphs in SSR HTML, places the startup tracker before `entry.async.js`,
and contains no `window is not defined` error. This verifies the SSR guard without
relying on the previously running dev process. The server remains available for
hands-on acceptance at `http://127.0.0.1:3218/reader-fixture`.


## Final running-app observations

- Clean-restart repeat retains the earlier reading/navigation results. Reload without a hash (browser restoration enabled) returns to Passage 40 at y15108 instead of the seeded Passage 15. A full document Back returns to Passage 40 at y15107.
- That document Back reports `pageshow.persisted=false`; it proves ordinary document-history restoration, **not a BFCache hit**. A true BFCache-hit run remains an explicit environment gap in this dev fixture. No new pageshow/re-entry behavior is introduced by the reader fix.
- Added a combined marked-article/image case: scroll before the client entry starts, then deliver a delayed image and local annotations. The image loads, the mark renders, and Passage 17 remains visible (y7000 to7028) with **zero application scroll calls** after the final correction window.
- The normal-browser exercise exposed a fixture-readiness issue: root `app:mounted` can precede an asynchronous page becoming interactive. Considered waiting for network idle (incompatible with deliberately held profiles), arbitrary longer sleeps, click retries, or Nuxt's hydration-ready signal. The fixture now marks readiness through `onNuxtReady`; no product behavior or timing delay was added for this test issue ([Nuxt hydration lifecycle](https://github.com/nuxt/nuxt/blob/main/packages/nuxt/src/app/nuxt.ts)).
- The local marked fixture initially had SQL rows but no rendered marks because its deliberately unavailable sync endpoint never supplied the stream's first checkpoint. Considered a full local sync service, a fake query implementation, REST-only coverage, or a narrow synthetic checkpoint. Chose the checkpoint boundary while retaining real SQLite writes, subscriptions and rendered annotations ([PowerSync stream gating](https://github.com/powersync-ja/agent-skills/blob/main/skills/powersync/references/sdks/powersync-js.md)). Highlight, reply, same-page cleanup, comment-card and Outline runs then located Passage 40 and stayed stable beyond the delayed position lookup/correction window.

- Final permission-only run after correcting the fixture hydration marker: **8/8 passed**, including logout and a real field-by-field token/account switch while the first profile reply is held. Both abandon the previous selected action; the new account starts its own check, and the old result does not reopen Chat or show an upgrade modal.

## Remaining task classification

- 4.3: ordinary SPA/document Back/Forward, deliberately conflicting local progress, hash/query changes, and the existing highlight/reply/comment/Outline locators are exercised; a true BFCache hit is not yet observed in this dev browser fixture. This task remains partial pending that environment-specific case.
- 4.5: targeted Web presentation/reader checks are exercised. The integrated OAuth/library/installed Extension and actual PDF smoke cases remain declared gaps for the unavailable integrated environment; this task remains partial.
- 5.1: completed by the requesting project owner on 2026-11-17, as recorded below.
- 5.3: the single `dev`-targeting task PR is prepared with the template-based body, `OpenSpec: fix-reader-initial-scroll`, the scroll recording and status screenshots. Human acceptance preceded delivery. Merge and archive remain subsequent human-controlled steps.

- Final complete `python3 -B -u apps/web/tests/fixtures/reader-startup/browser_check.py`: **21/21 checks passed**, exit 0, after the fixture hydration signal was corrected. This includes independently delayed startup/readiness/lookup, saved progress, SPA history/local conflict, no-hash reload, document Back, annotations with a delayed image, pending Chat/Analysis, error/retry, confirmed inactivity, abandonment, logout, account switch, and public Outline.
- Manual lab adds opt-in Article A/B controls only when `manual=1`; they use the actual Nuxt router and are absent from normal application builds and automated visual captures.

- The human-ready lab itself was smoke-tested through its real synthetic endpoints: slow-profile checking becomes Chat, the opt-in Article B button performs SPA navigation to the top, browser Back returns to Article A, and no upgrade modal appears. This is agent preparation, not human acceptance.


## Human hands-on acceptance

- Who: the requesting project owner, through the conversation's explicit acceptance response.
- Date: 2026-11-17.
- Environment: `http://127.0.0.1:3218/reader-fixture`, prepared and smoke-tested by the agent.
- Cases in the acceptance request: weak-network reading/scrolling, Back/Forward, highlight positioning, and Chat/Outline checking plus retry.
- Human response: accepted after hands-on testing ("Tested personally; passed", translated from the original Chinese response).
- Requested adjustments: none. Acceptance was received before any task PR was opened.
- The synthetic-fixture and integrated-smoke limits above remain declared; this acceptance is not represented as testing live production services or a true BFCache hit.


## Task PR delivery

- Branch: `fix/fix-reader-initial-scroll`; target: `dev`; OpenSpec: `fix-reader-initial-scroll`.
- The implementation and acceptance evidence are committed together in this task branch. The PR follows the repository template and carries the recorded limits instead of claiming an all-green full-repository baseline.
- Key visuals are uploaded with `gh pr create --attach`: the 1280px light-theme delayed-start scroll recording, plus checking at 1280px/light and error/retry at 375px/dark and 1280px/e-ink. Media remains outside git.
- The recording's visible article is synthetic and the paid-account states are synthetic. The caption describes the retained paragraph; no recording is presented as a live production/account test.
- Local Bugs/Security/Compliance review is closed: all Important findings are resolved, and the human acceptance record predates PR creation. Remaining agent-executable integration gaps are classified in tasks 4.3 and 4.5.
