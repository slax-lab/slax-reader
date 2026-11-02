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
- Human visual/hands-on acceptance of the restored knob animation is
  recorded in the acceptance section at the end of this file (`DESIGN.md`
  §10.2).

## `backdrop-filter` prefix fix — verification

Two independent tools decide the vendor prefix, and they disagreed:

- **Minified builds** (`production`, `beta`): Vite's `cssMinify` follows
  `build.minify`, so CSS is compressed with Lightning CSS. Lightning CSS
  collapses a `-webkit-backdrop-filter` + `backdrop-filter` pair inside one
  rule into a single declaration and keeps the **last** one.
- **Unminified builds** (`preview`, `development`): `minify: false`, so no
  Lightning CSS at all. There, the project's autoprefixer (10.6.1, pulled in by
  Nuxt) is the only prefixer, and it was running on the **default** browserslist
  because the repo declared no support matrix for the Web app.

Reproduced each half in isolation with the exact pinned versions:

```js
// Lightning CSS: order decides which declaration survives (targets ≈ es2022)
'.x{backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}'
//   => .x{-webkit-backdrop-filter:blur(8px)}     standard property dropped
'.x{-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}'
//   => .x{-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}  both kept

// autoprefixer: default browserslist removes a hand-written prefix
'.x{-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}'
//   overrideBrowserslist: defaults       => .x{backdrop-filter:blur(8px)}
//   overrideBrowserslist: safari>=15.4   => .x{-webkit-backdrop-filter:...;backdrop-filter:...}
```

Safari/iOS Safari support was checked against the bundled `caniuse-lite`
dataset (`css-backdrop-filter`): every Safari 9.x–17.6 range is `"y x"`
(supported only with the prefix), and only 18.0+ is plain `"y"` — so
`build.target: 'es2022'`, which still includes Safari 15.4, needs the prefix in
both build profiles.

Fixes applied:

1. Every blur rule declares `-webkit-backdrop-filter` **before** the standard
   property, so Lightning CSS keeps both in minified builds and cssnano (which
   does not merge prefixes) keeps both in unminified builds.
2. `apps/web/package.json` now declares `browserslist` mirroring
   `build.target: 'es2022'` (Chrome/Edge 94+, Firefox 93+, Safari/iOS 15.4+), so
   autoprefixer stops deleting the prefix in unminified builds and agrees with
   Lightning CSS.

Verified on real builds of both profiles. The counts below are per **rule**
(each rule that declares the standard property is either paired or not), so
they reconcile by construction rather than by subtracting raw text matches:

| profile | rules with `backdrop-filter` | paired with `-webkit-` | unpaired |
| --- | ---: | ---: | ---: |
| `SLAX_ENV=production` (minified) | 56 | 56 | 0 |
| `SLAX_ENV=preview` (unminified) | 53 | 48 | 5 |

The production bundle carries the pair on every rule, including
`.bottom-toolbar`, `.login-modal.appear`, and the E-ink `*` override. In the
preview bundle the 5 unpaired rules are not blur surfaces: one is comment text
inside `theme.css`'s token block and four are pdf.js's own
`--hcm-highlight-filter` rules in `PdfReader.*.css`.

Minifier identity, since an earlier review read `build.minify: 'esbuild'` as the
CSS minifier: Vite's `cssMinify` resolves to `!!build.minify` for the client
environment, and `minifyCSS` only takes the esbuild branch when
`build.cssMinify === 'esbuild'`, which this config never sets — so minified CSS
goes through Lightning CSS. Reproduced directly: `esbuild.transformSync` with
`{ loader: 'css', minify: true }` keeps both declarations, while
`lightningcss.transform` with `{ minify: true }` collapses them to the last one.
The observed collapse is therefore Lightning CSS's.

Not verified: human visual confirmation of the restored blur on a real
Safari 15.4–17 device. The hands-on acceptance that §10.2 requires is recorded
below; this row is the narrower device-coverage gap.

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

## Human hands-on acceptance (`DESIGN.md` §10.2)

- **Who:** Yaojunchang (repository owner).
- **When:** 2026-11-02.
- **Environment:** a local `SLAX_ENV=production` build (minified CSS — the only
  profile where the `backdrop-filter` prefix defect is observable) served by
  `wrangler pages dev`, against the local API. The `SwitchToggle` knob fix is
  observable in the same build.
- **What was exercised and observed:**
  - `SwitchToggle` (Settings → Labs, and the share dialog): the knob stays
    visible while the request is in flight and the spinner overlays it; the knob
    no longer disappears.
  - `/b/[id]` bottom toolbar on an owned bookmark: the frosted-glass blur behind
    the toolbar renders normally, matching what an unminified build shows; the
    E-ink theme still suppresses the blur on the same surface.
- **Adjustments requested after acceptance:** none; no follow-up changes were
  made.
- **Not covered by this acceptance:** the mobile notes entry and the remaining
  modal surfaces listed in the change's proposal were not opened
  individually — they carry the identical declaration pair, and the compiled CSS
  carries the prefix on every one of them (see the build evidence above).

This record satisfies the §10.2 acceptance requirement; it does not extend the
verification evidence above.
