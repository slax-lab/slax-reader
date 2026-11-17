# Validation

## Scope and environment

- Web-only presentation correction on `fix/center-reader-panel-loading`, cut from `origin/dev` at `82b84500db02eb376c3715cd1a3e47b09bd7d3cb` after reader fix PR #641 merged.
- Production changes are the new `SnapshotPanelLoading.vue` and the two `/b/[id]` async loading declarations. The generic `DotLoading`, loaded panels, authorization, reader navigation, and position code are unchanged.
- Running environment: the existing opt-in reader-startup Nuxt layer at `http://127.0.0.1:3218`, real reader/router/account components and disposable local PowerSync database, synthetic backend/profile data. Synthetic marked samples simulate the remote stream checkpoint while using real local SQL and watchers.
- Browser: Python Playwright with locally installed Chromium headless shell, executable explicitly selected through `--browser-executable`. Media is under `/tmp/slax-reader-startup-evidence`, never committed.

## Running-browser evidence

- Before changing production code, `browser_panel_loading_check.py --before --browser-executable <local-browser>` reproduced the desktop/light Outline placeholder. Its four dots were 178px left and 371px above the sidebar content center (395 × 748px slot).
- The first complete post-fix panel matrix passed 18/18 cases (both Outline and Chat × 375/768/1280px × light/dark/e-ink). Dot centers matched content-slot centers within 0.001px; the mobile slot was 299px high after the grab area, desktop was 748px high. Releasing each held real module displayed its existing panel, removed the fallback, produced no upgrade modal or horizontal overflow, and raised no page errors.
- That matrix verified the localized loading status, decorative hidden dots, e-ink animation suppression, and reduced-motion animation suppression for both panels in every width/theme combination.
- A later concurrent matrix rerun stopped after seven passing cases because a fresh fixture page had no theme control before its hover timeout. This was not a centering assertion failure; the prior complete matrix remains the evidence for the 18 combinations. Panel selection checks are recorded separately below.
- The manual `case=loading` acceptance entry was exercised: both Analysis and Chat displayed the delayed placeholder and then their actual panel. Its 2.5-second Vite-module delay is limited to the explicitly loaded fixture layer and synthetic session cookie.
- `browser_panel_loading_check.py --selection-only --browser-executable <local-browser>`: 2/2 passed. Switching AI loading to Comments kept Comments selected after delivery; closing Chat during loading kept the sidebar closed after delivery. Explicitly reopening displayed the real panels. Both placeholders remained exactly centered before those actions.
- `browser_check.py`: 21/21 scenarios passed, including early weak-network scrolling with and without local data, delayed saved-position reads, normal navigation and Back/Forward, native reload history behavior, annotation/image settlement, pending Chat/Outline admission, failure/retry, confirmed inactive paywall, abandoned panel choice, logout/account switch, and anonymous public Outline.
- `browser_navigation_check.py`: all five existing locator cases passed: highlight, reply, same-page highlight, comment card, and Outline link. Passage 40 remained visible and stable after the late saved-position result.

## Automated checks

- Changed-file ESLint: passed for both production Vue files and the two TypeScript fixture files, zero errors/warnings.
- `pnpm exec openspec validate --all --strict`: 146 passed, zero failed.
- `git diff --check`: passed.
- `pnpm web -- test` with the documented synthetic fixture configuration: 254 test files passed, one skipped; 3103 tests passed, three skipped, zero failures (69.75s).
- `pnpm web -- typecheck` with the same configuration: passed (exit 0).

## Human hands-on acceptance

On 2026-11-17, the change requester personally exercised `/reader-fixture?case=loading` as requested: opening Analysis (Outline) and Chat, observing the centered four-dot placeholder during the 2.5-second module delay, then normal panel content. The requester explicitly replied that hands-on testing passed. No adjustment was requested. This acceptance preceded opening the PR and satisfies `DESIGN.md` §10.2.

## Boundaries and gaps

- No production account/OAuth, live billing service, live AI generation, real PDF asset, actual mobile device, or paired Extension integration was exercised. Those code paths and API contracts are unchanged; the exercise uses synthetic API replies and desktop Chromium responsive viewports.
- The runner does not claim a true BFCache hit; existing document-history checks report the browser's actual restore behavior.
- Web and API do not use package-version increments. No CLI, Extension, Mobile, runtime dependency, or shared-package output changed.

## Review

Independent read-only source review of the branch against `REVIEW.md` Bugs/Security/Compliance passes found no Important findings. A documentation Nit requesting the selection-only results was addressed by adding the command and both outcomes above. Final local pre-push review confirmed the scoped production diff, no added external data access or dependency, matching approved OpenSpec intent, completed automated/runtime verification, and the pre-PR human acceptance above.

## Delivery

Submitted [PR #649](https://github.com/slax-lab/slax-reader/pull/649) targeting `dev` after hands-on acceptance, with an attached matched before/after visual group and the evidence trail above. The change remains unarchived until merge; archive belongs in a separate human-reviewed documentation PR.
