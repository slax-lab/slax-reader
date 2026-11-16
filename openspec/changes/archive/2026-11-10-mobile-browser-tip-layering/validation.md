# Validation

## Scope and environment

- Date: 2026-10-29.
- Branch: `fix/mobile-browser-tip-layering`, based on refreshed `origin/dev` at `79e4c6232845767906b331c048c4ef1c72e58f1f`.
- Runtime diff: `InAppBrowserTip.vue` changes `z-index: 80` to `z-index: 1000`; `_twitter.scss` changes the quoted-tweet hover background to the existing accent-background token and explicitly sets description line height to 20px. The collection header remains at 100.
- Web-only change; CLI, Extension, and Mobile package versions are unaffected.
- The optional technical design artifact is omitted because these are local style corrections with no architectural decisions.

## Automated checks

- `openspec validate --all --strict`: 83 items passed, 0 failed.
- `eslint app/components/Tips/InAppBrowserTip.vue`: passed.
- `vue-tsc --noEmit -p .nuxt/tsconfig.app.json`: passed after Nuxt prepare with documented placeholder environment values.
- `git diff --check`: passed for the changed component and change artifacts.
- The actual `BookmarkArticle.vue` article Sass compiles successfully with Sass and the existing UnoCSS configuration, including directive expansion. The generated quote description uses the existing metadata font-size token and `line-height: 20px`; the hover rule consumes `var(--slax-accent-bg)`.
- Existing theme-token suite: 15 tests passed with a temporary Node-environment Vitest configuration. This runs the unchanged `tests/theme/tokens.spec.ts` against worktree token files without the unrelated Nuxt runtime setup.
- An additional default-Prettier check reports existing single-quote and line-wrapping differences throughout `_twitter.scss` (there is no Web Prettier configuration). Inspection of the proposed formatter diff confirms this is broader formatting churn; the established style is retained for the two-line correction. No formatter-pass claim is made.
- Existing guidance component, detection, and cooldown suites: 3 files and 83 tests passed with `vitest run --config <temporary-guidance-runner>`. The temporary runner uses the worktree's actual component, utilities, icons, and locale files with the installed Vue/Vitest dependencies. It preserves the existing assertions, substitutes the Nuxt route-import mock with an equivalent global stub, and explicitly imports `useI18n` because the isolated runner lacks Nuxt auto-imports.
- The standard Nuxt suite did not complete: its initial run failed before collecting tests because the Nuxt runtime entry resolved outside the worktree. Offline dependency installation then lacked package metadata; the online and Web-filtered attempts made no further progress and were stopped. No full Nuxt-suite or production-build success is claimed. The temporary runner is focused regression evidence, not a replacement claim for those checks.

## Running-browser exercise

A temporary fixture at `http://localhost:4319` compiles the actual guidance Vue component, icon registry, localization, detection, and dismissal logic. It uses the collection page's header markup and stylesheet, the application theme tokens, and the layout's stacking contexts. Collection content is synthetic; this is component-integration evidence, not a full backend-integrated collection session. The fixture and media are outside Git.

- Before, 390 x 844, light: the guidance has layer 80, the header 100, and `elementFromPoint` at the close-button center returns `cp-topbar-inner`. The title and close button are visibly obscured.
- After, matched state: guidance layer 1000, header 100, and the close-button center hits the close control. The whole card is visible above the header.
- Matrix: 320, 390, 768, and 1280px widths at 844px height, each in light, dark, and e-ink. All 12 cases keep the card within the viewport, deliver pointer input to its close button, remove the card on click, and preserve the main content's position.
- Scrolling: at 390px with English copy, Page Down scrolls the document while the card remains fixed at 10px from the viewport top. The close control remains above the header.
- Upward drag: dragging the English card from (180, 105) to (180, 20) removes the actual component; the test waits for the status element to detach.
- Ordinary-browser simulation and the excluded `/privacy` route both keep guidance hidden.
- Screenshots: `before-390-light.png` and `after-390-light.png` are retained outside Git for the PR's matched visual group.

## Quote-card browser exercise

A second temporary fixture at `http://localhost:4320` compiles the actual Web article Sass from `BookmarkArticle.vue`, its mixins, and the existing UnoCSS configuration. It loads the current theme token declarations and host theme rules, and mirrors the quote markup and sibling placement in `apps/api/src/utils/htmlBuilder.ts` using synthetic Chinese and English text. The baseline is the same source from `origin/dev`; the fixture and media remain outside Git.

- Before, 390 x 844: the metadata utility generates a unit line height, giving the 14px description a 14px line height. Hover produces fixed `rgb(245, 248, 250)` in both light and dark themes.
- After: all 24 combinations of 320, 390, 768, and 1280px widths, light/dark/e-ink themes, and Chinese/English descriptions have 14px text, 20px line height, and no horizontal overflow. Adjacent body text retains its 28px line height.
- Native pointer input at the card border activates the actual hover selector. Computed backgrounds match the active accent-background tokens: `rgba(180, 88, 55, 0.06)` in light, `rgba(212, 118, 79, 0.08)` in dark, and `rgb(240, 240, 240)` in e-ink. E-ink retains a zero-duration transition.
- Moving the pointer outside the card restores its transparent resting background in all three themes.
- Activating the quote overlay link opens the fixture destination in a separate tab with the expected destination heading. Only the fixture substitutes a local destination; the runtime anchor and URL handling are unchanged.
- Matched light and dark before/after screenshots at 390 x 844 are retained outside Git for the PR. The browser viewport override was reset after checks.

## Limitations and acceptance

- Physical iOS/Android embedded browsers, nonzero device safe-area insets, and a full authenticated collection/backend session have not been exercised. The fixture uses a simulated WeChat user agent in the desktop in-app browser.
- Login, library synchronization, highlights, comments, payment/subscription actions, and the extension bridge are outside these local style corrections and were not exercised. Quote-card evidence uses the source-style fixture, not an authenticated production article or physical touch-device session.
- The requesting maintainer completed hands-on acceptance of the guidance at `http://localhost:4319` on 2026-10-29 and confirmed that display and dismissal work normally. No further guidance adjustments were requested.
- On 2026-10-29, the same requesting maintainer also exercised the quote-card fixture at `http://localhost:4320`, confirmed the colors and line spacing meet expectations, and requested no further adjustments. This follows the earlier proposal approval for the two additional quote styles; both changed surfaces have human hands-on acceptance before the combined PR opens.

## Local review

An independent read-only review completed the Bugs, Security, and Compliance passes against `origin/dev`: no Important findings and no Nits. The initial review confirmed the guidance layer and that body-mounted modals retain their existing precedence through the application stacking context. A second review of the combined final diff on 2026-10-29 also found no Important findings or Nits: all three runtime declaration changes match the approved scope, the quote link/content and Mobile assets remain unchanged, and the evidence records both surfaces' hands-on acceptance and environment limitations. A fresh fetch confirmed the base remains `79e4c6232845767906b331c048c4ef1c72e58f1f` before delivery.

## Delivery

Both corrections were pushed on `fix/mobile-browser-tip-layering` and submitted together in [PR #435](https://github.com/slax-lab/slax-reader/pull/435), targeting `dev`, on 2026-10-29. The PR follows the repository template and includes three matched before/after visual groups uploaded with `gh --attach`. The remaining archive task is deliberately pending until this task PR merges; it belongs in a separate documentation PR afterward.

## PR review follow-up: intentional overlay priority

On 2026-10-29, automated review reported that raising guidance to 1000 also places it above the in-page subscription overlay (100), and the collection-management backdrop/dialog (999/1000, with guidance later in document order). Source inspection and a running fixture reproduced this observation. The requesting maintainer explicitly confirmed that 1000 is correct, covering the subscription modal is expected, and route-specific handling is prohibited. The proposal and delta spec now state that intended priority. This follow-up leaves the previously accepted runtime code unchanged; the single global `z-index: 1000` declaration remains the entire guidance implementation diff.

- The fixture uses the actual subscription and collection-management overlay styles, in their layout stacking context and document order, with synthetic dialog content. On `/`, `/bookmarks`, `/onboarding`, and `/collection/manage`, guidance remains at 1000 above these in-page overlays and receives pointer input in the overlapping region; its close button remains reachable.
- All 48 combinations passed: four eligible routes, light/dark/e-ink, and 320 x 568, 390 x 844, 844 x 390, and 1280 x 844 viewports. These checks verify the explicitly intended precedence, not backend subscription or collection-management behavior.
- Client navigation from `/c/collection` to `/bookmarks` and back keeps layer 1000 throughout. There is no route-specific class, computed layer, or selector in the runtime diff. The browser viewport override was reset after verification.
- The pre-existing quote border is intentionally outside the approved hover-background/description-spacing scope; it is not claimed as a full quote-card theme migration. Machine-specific test-runner paths were removed from this evidence file in response to the other review Nit.
- GitHub's `web` job and `Web CI gate` passed for head `c0dc4638311ebbe39c597fd71212a9db453b66b2` in [Frontend CI run 40809316067](https://github.com/slax-lab/slax-reader/actions/runs/40809316067). The reported blocker was the automated review's interpretation of intended overlay priority, rather than a Web build/test failure.
- A fresh independent Bugs/Security/Compliance review found no Important findings or Nits under the maintainer's explicit priority decision. OpenSpec strict validation passed all 83 items. The PR body now includes the same review response and evidence; its existing visual groups remain accurate because runtime styling is unchanged.
