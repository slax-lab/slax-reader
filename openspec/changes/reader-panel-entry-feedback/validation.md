# Validation

## Scope and environment

Web reader panel entry feedback only, implemented on `fix/reader-panel-entry-feedback` from `origin/dev` at `a439e112`. The change requester approved the proposal and design in conversation on 2026-11-17. This is implementation approval, not post-implementation hands-on acceptance.

The local opt-in reader-startup Nuxt lab runs the real `/b/[id]` page, startup script, router, controls, account/access decisions, and panel components. Its backend replies, account, article, and browser-local database are disposable fixtures. No secret files or production credentials were used. Synthetic configuration is the documented Web fixture configuration, consistently using `http://127.0.0.1:3228`.

## Automated checks

- Focused startup, navigation-plugin, toolbar and side-panel suites: 24 tests passed after the final article-path ownership fix.
- Web typecheck: passed after the final ownership fix.
- Full Web suite after the final ownership fix: 3111 tests passed, 3 skipped (254 files passed, 1 skipped); exit code 0.
- Changed-file ESLint: 0 errors; 3 existing explicit-any warnings in the navigation-plugin test. Full Web lint reports 87 errors and 455 warnings; every error is in a file unchanged from `origin/dev`. These existing errors are not expanded into this scoped change.
- Icon registry: 59 entries valid.
- `pnpm exec openspec validate --all --strict`: 147 items passed, 0 failed.
- `git diff --check`: passed.

## Browser evidence

The initial testing-environment reproduction used the requester's Chrome with 3G and Disable cache: an early click produced no panel state change; after interaction readiness, another click immediately opened the shell while the on-demand component loaded. This justified testing the two waits independently.

The checked-in `browser_panel_feedback_check.py` holds the real entry response and panel module response separately. The final runner passed all 21 cases:

- Early Analysis and Chat activation shows the loading ring while the application entry is still withheld, without changing button bounds.
- Repeated clicks hand off once; exactly one selected component-module request is observed; loading remains visible in expanded tabs and ends when the module resolves.
- No page errors or hydration mismatch warnings in those early handoff cases.
- Choosing Comment after Analysis while entry loading is pending retains only Comment.
- Early Chat selection retains pending-profile feedback and normal active, inactive, and failed-profile/retry outcomes.

The existing browser navigation checks passed all five real-reader cases: direct highlight, reply, same-page highlight, comment-card navigation, and Outline anchors remain stable after the delayed saved-position result.

The final run also passed the complete 1280px/768px/375px × light/dark/e-ink presentation matrix; keyboard Enter activation; static reduced-motion loading; component rejection and the existing 15-second timeout; closing or switching while a module is held; and source controls during pending destination navigation. Mobile entries retain their existing hiding behavior after the sheet opens; the content loading placeholder remains visible in that stage. JSON, screenshots and recordings are written under `/tmp/slax-reader-panel-feedback-evidence` and `/tmp/slax-reader-startup-evidence`, not committed.

## Review

Independent read-only Bugs, Security, and Compliance review found one Important issue: a still-visible source article's controls could be intercepted after navigation started and applied to the destination. It was reproduced in the running lab by holding destination content, navigating, then clicking the source Comment control. Both the tracked browser assertion and a startup unit test failed before the fix. The fix stamps an immutable article path on the source container and validates it at the early-click boundary. The unit regression passed and the final browser runner confirmed source clicks are not handed to the destination. This resolves the only Important finding; Security and remaining Compliance checks found no new issue. No other Important or Nit findings were reported.

## Gaps and human acceptance

Real backend login, library synchronization, Extension integration, and deployed production assets are not verified by this scoped synthetic lab; they are outside the touched Web control/startup surface. The original live 3G reproduction predates this implementation. Post-implementation Chrome 3G + Disable cache smoke: after the server-rendered Analysis entry appeared, activation set the early pending marker and immediately displayed the loading ring while the sidebar remained closed. The measured ring color after the follow-up is `rgb(180, 88, 55)`, matching the light theme accent `#b45837`. Full cold development-module completion was not timed under continuous 3G; component completion and all terminal outcomes were independently verified with controlled module delivery in the lab.

On 2026-11-17 (Asia/Shanghai), the change requester completed hands-on acceptance of the running local page in their Chrome and explicitly answered “Effect accepted; create the PR” after reviewing the interaction and accent color. Their requested adjustment was to use `--slax-accent` for the ring; it was implemented and re-verified before acceptance. This is post-implementation acceptance under `DESIGN.md` §10.2, separate from proposal approval.

## Accent-color follow-up

On 2026-11-17, the change requester asked for the loading ring to use `--slax-accent`. The ring now sets that semantic color locally while ordinary icons retain their existing color. All 21 browser cases passed again after this CSS-only adjustment, and the screenshots and two recordings were regenerated. The real Chrome 3G smoke also confirmed the ring resolves to the theme accent; the unit/typecheck results above cover the unchanged application logic.

## Local pre-push review

Bugs: the only Important finding (source-page click captured for a destination article) is covered by failing-then-passing unit and browser regressions and is resolved. Security: no new permission path, secret handling, runtime dependency, or data transmission. Compliance: the diff implements `reader-panel-entry-feedback`; proposal approval, running-environment evidence, full-check limitations, and post-implementation human acceptance are recorded. No unresolved Important findings remain. Only Web code and fixtures changed, so CLI/Extension/Mobile version increments are not applicable.

## Task PR

Created https://github.com/slax-lab/slax-reader/pull/650 targeting `dev` after human acceptance, with the refreshed accent-loading recording attached. The PR is open for human review; no merge or archive was performed.
