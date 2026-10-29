# Validation

## Scope and environment

- Date: 2026-10-29.
- Branch: `fix/mobile-browser-tip-layering`, based on refreshed `origin/dev` at `79e4c6232845767906b331c048c4ef1c72e58f1f`.
- Runtime diff: only `InAppBrowserTip.vue` changes `z-index: 80` to `z-index: 1000`. The collection header remains at 100.
- Web-only change; CLI, Extension, and Mobile package versions are unaffected.
- The optional technical design artifact is omitted because this is a single local style correction with no architectural decisions.

## Automated checks

- `openspec validate --all --strict`: 83 items passed, 0 failed.
- `eslint app/components/Tips/InAppBrowserTip.vue`: passed.
- `vue-tsc --noEmit -p .nuxt/tsconfig.app.json`: passed after Nuxt prepare with documented placeholder environment values.
- `git diff --check`: passed for the changed component and change artifacts.
- Existing guidance component, detection, and cooldown suites: 3 files and 83 tests passed with `/Users/yjc/Documents/Company/slax-reader-v2/apps/web/node_modules/.bin/vitest run --config /private/tmp/slax-tip-unit/vitest.config.mjs`. The temporary runner uses the worktree's actual component, utilities, icons, and locale files with the installed Vue/Vitest dependencies. It preserves the existing assertions, substitutes the Nuxt route-import mock with an equivalent global stub, and explicitly imports `useI18n` because the isolated runner lacks Nuxt auto-imports.
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

## Limitations and acceptance

- Physical iOS/Android embedded browsers, nonzero device safe-area insets, and a full authenticated collection/backend session have not been exercised. The fixture uses a simulated WeChat user agent in the desktop in-app browser.
- Login, library synchronization, highlights, comments, payment/subscription actions, and the extension bridge are outside this one-declaration change and were not exercised.
- Human hands-on acceptance is pending. A PR must not open until the requester exercises the prepared running result and acceptance is recorded.

## Local review

An independent read-only review completed the Bugs, Security, and Compliance passes against `origin/dev`: no Important findings and no Nits. The reviewer confirmed the one-declaration scope and that body-mounted modals retain their existing precedence through the application stacking context. Focused tests subsequently passed as recorded above. Human hands-on acceptance remains a delivery gate.
