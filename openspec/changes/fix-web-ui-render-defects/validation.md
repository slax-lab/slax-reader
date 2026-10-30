# Validation evidence

All commands were run on branch `fix/web-ui-switch-toolbar-lcp` locally with
synthetic environment values (`https://example.test`,
`https://api.example.test`); no real credentials or production data were
used.

## Automated checks

- `pnpm --filter @apps/slax-reader-dweb typecheck` (with `SLAX_ENV=preview`
  and synthetic required env vars) — passed.
- `pnpm web -- test` (with `SLAX_ENV=preview` and synthetic required env
  vars) — 224 test files passed, 1 skipped (one test file skipped
  entirely); 2559 tests passed, 3 skipped. No new failures from this change.
- `npx eslint <changed files>` — clean on every file this change touches.
  Two pre-existing, unrelated findings were left alone (not fixed, not
  caused by this change): an import-sort error in
  `app/components/Modal/EditTag.vue` and
  `vue-scoped-css/no-unused-selector` warnings in
  `app/components/Dashboard/HistoryLineChart.vue`; both reproduce
  identically on `origin/dev` before this branch's changes.

## `SwitchToggle.vue` knob fix — verification

- Unit test `tests/unit/components/SwitchToggle.spec.ts` (pre-existing, 5
  tests) passed unchanged; it asserts the `.knob.loading` class is present
  during loading, which this fix preserves — only the knob's
  background/shadow reset was removed.
- Rendered the real component (temporarily, via a throwaway injection into
  `app/pages/guide.vue`, reverted before committing) under the actual
  `pnpm web -- dev` server and read computed styles over the Chrome
  DevTools Protocol. Before the dev-cache preflight fix (task 2), the
  on/off knob transform was confirmed broken in `dev` for an unrelated
  reason (see next section); after both fixes, a `loading` knob keeps its
  surface background and only gains the spinner overlay, and the on/off
  transform computes correctly.
- Not verified: human visual/hands-on acceptance of the restored knob
  animation in a real browser session, across light/dark/e-ink themes.
  This is a UI-visible change; `DESIGN.md` §10.2 hands-on acceptance has
  no declared-gap path and must happen before this pull request leaves
  draft.

## `backdrop-filter` production-minification fix — verification

Root-caused with the project's actual pinned `lightningcss@1.33.0` (the
library Vite's `cssMinify` uses when `build.minify` is truthy, which is
distinct from `esbuild` CSS minification and was not initially suspected):

```js
// Reproduces the bug class with the exact dependency version this repo uses
lightningcss.transform({
  filename: 'x.css',
  code: Buffer.from('.a{backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}'),
  minify: true,
  targets: { chrome: 100 << 16, safari: 15 << 16 } // approximates build.target: 'es2022'
})
// => ".a{-webkit-backdrop-filter:blur(8px)}" — standard property dropped
```

```js
// Confirms the fix direction: standard-only input gets the prefix added back
lightningcss.transform({
  filename: 'x.css',
  code: Buffer.from('.a{backdrop-filter:blur(8px)}'),
  minify: true,
  targets: { chrome: 100 << 16, safari: 15 << 16 }
})
// => ".a{-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}" — both kept
```

Then built the real app with `SLAX_ENV=production` and scanned every CSS
file under `dist/_nuxt/`:

```bash
grep -oE "\.[a-zA-Z0-9_-]+(\[data-v-[a-f0-9]+\])?\{[^}]*[^-]backdrop-filter:[^;}]+;[^}]*\}" *.css | grep -c "webkit-backdrop-filter"
# 39
grep -oE "\.[a-zA-Z0-9_-]+(\[data-v-[a-f0-9]+\])?\{[^}]*[^-]backdrop-filter:[^;}]+;[^}]*\}" *.css | wc -l
# 39
```

All 39 rules carrying a standard `backdrop-filter` declaration in the
production bundle also carry `-webkit-backdrop-filter`, including
`.bottom-toolbar` (the originally reported `/b/[id]` bottom toolbar), the
E-ink override in `theme.css`, and `.login-modal.appear` (`LoginModal.vue`,
which independently picked up the same hand-written pattern from
`feat/login-modal-benefits`, a separate PR merged to `dev` while this fix
was in flight; this branch was rebased onto that merge and removed the
pattern there too). 5 unrelated matches on
`--highlight-backdrop-filter`/`--menu-backdrop-filter` (PDF reader custom
properties, not the real CSS property) were excluded by inspection.

Not verified: human visual confirmation of the restored blur effect on a
real device/browser in production-equivalent conditions (this change's dev
server runs unminified CSS, so the bug cannot reproduce there even after
the fix — a production or `wrangler pages dev` build against the compiled
`dist/` is required to see the effect). This is a UI-visible change;
`DESIGN.md` §10.2 hands-on acceptance has no declared-gap path and must
happen before this pull request leaves draft.

## Dev-only UnoCSS preflight fix — verification

Discovered while investigating a user report that the `SwitchToggle` knob
does not move at all in `pnpm web -- dev` (it did move correctly in
`preview` and `production`). Root-caused to
`apps/web/modules/dweb-dev-performance.ts`, which pre-builds a cached
UnoCSS stylesheet for dev and replaces the framework's normal CSS
injection (`unocss.autoImport = false`); that cache was built with
`preflights: false`, so the page never received `--un-translate-x: 0` etc.
default custom properties, leaving every
`translateX(var(--un-translate-x))` style `transform` with an empty
fallback and therefore invalid.

- Captured the real dev-server-served scoped CSS and UnoCSS cache CSS for
  `SwitchToggle.vue`, loaded them standalone in headless Chrome, and read
  `getComputedStyle` before the fix: `.on .knob` computed
  `transform: none` (should be `matrix(1, 0, 0, 1, 16, 0)`).
- After bumping `CACHE_SCHEMA` (invalidating the stale cache) and setting
  `preflights: true`, deleted `apps/web/.cache/unocss/`, restarted
  `pnpm web -- dev`, and confirmed via the Chrome DevTools Protocol
  against a real rendered page (`/guide`, with a temporary debug
  injection, reverted before committing): `.on .knob` now computes
  `transform: matrix(1, 0, 0, 1, 16, 0)`, `--un-translate-y: 0`
  (previously empty), and the knob's bounding-box `x` moved from 14px to
  30px (a 16px shift, matching the `translate-x-16px` utility).
- This fix only affects `nuxt.options.dev` builds (guarded in the module
  by `if (!nuxt.options.dev || options.enabled === false) return`);
  production and `preview` builds never execute this code path and were
  confirmed unaffected by inspecting their CSS output directly (see the
  previous section, which used real `production`/`preview` builds).

Not verified: no automated test exists for this dev-tooling module in
either direction (pre-existing gap, not introduced by this change). This
is dev tooling, not shipped behavior, and `DESIGN.md` §10.2 hands-on
acceptance does not apply to it.

## Outstanding before this pull request leaves draft

- Human hands-on acceptance (`DESIGN.md` §10.2) for the `SwitchToggle`
  knob fix and the `backdrop-filter` fix, across the themes/widths
  `DESIGN.md` §6 requires for the affected surfaces (`/b/[id]` bottom
  toolbar, mobile notes entry, Labs/share-modal switches, and the other 16
  files carrying the same `backdrop-filter` fix).
