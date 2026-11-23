# Validation

## Scope and provenance

- Evidence date: 2026-11-20. Change: `web-update-notice`; branch: `feat/web-update-notice`, first built on `origin/dev` at `c50cd5f6` and rebased onto `5820d7f8` before the pull request; target: `dev`. Worktree: `.local/worktrees/web-update-notice`.
- The rebase conflicted only in `apps/web/app/plugins/powersync.client.ts`, where `dev` moved initialization into `startLocal`; the resolution keeps `dev`'s code and adds the two version-skew reports to its recovery `onEvent` and main-mode `init` failure. After the rebase: `pnpm web -- typecheck` passes; `pnpm web -- test` passes with 273 files passed, 1 skipped, 3342 tests passed, 3 skipped; two fresh production builds repeated the Chrome Service Worker scenario (notice shown, in-page marker kept, navigation type `navigate`, no reload recorded) with PowerSync initializing normally. Other results below were produced before the rebase.
- Scope: Web only. `nuxt.config.ts` (Nuxt outdated-build interval, manual route-chunk errors, PWA registration ownership), the `update-notice`, `pwa-register`, and `powersync` client plugins, the shared `useUpdateNotice` state, the `versionSkew` classifier, the `UpdateNotice` component in the `default` and `blank` layouts, and English and Chinese strings. No API, contract, Extension, Mobile, or CLI change; Web carries no package version (`docs/release/VERSIONING.md`).

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm web -- typecheck` | PASS |
| `pnpm web -- test` | PASS: 265 files passed, 1 skipped; 3264 tests passed, 3 skipped |
| `npx eslint` on every changed or added Web source and test file | PASS: 0 errors (two existing warnings in untouched `app/plugins/pinia.ts` appear when linting the plugin directory) |
| `npx openspec validate --all --strict` | PASS: 162 items |

New or extended unit suites: `tests/unit/composables/useUpdateNotice.spec.ts`, `tests/unit/utils/versionSkew.spec.ts`, `tests/unit/plugins/updateNotice.spec.ts`, `tests/unit/plugins/pwaRegister.spec.ts`, `tests/unit/components/Tips/UpdateNotice.spec.ts`, and four cases added to `tests/unit/local-first/powersync-error-log.spec.ts`. The existing `tests/unit/utils/pwa.spec.ts` (`pwaOpen`) passes unchanged.

## Build output (task 1.1, 1.3)

Two production-mode builds (`SLAX_ENV=preview pnpm build`, placeholder public URLs on `localhost:3105`) were made from the final source:

- `dist/registerSW.js` is not generated and no page injects a registration script; `dist/sw_prod.js` and `dist/manifest.webmanifest` are still produced, and the two builds' workers differ only in precache revisions.
- The client bundle contains `slax:pwa-register` and `slax:update-notice`, the outdated-build check with `3e5` ms, and no `nuxt:chunk-reload` plugin; only Nuxt's crawler-only `chunk-reload-crawler` remains.

## Running-environment verification (task 3.2)

Environment: the two builds served by a local static server on `127.0.0.1:3105` with production cache headers and an HTML fallback for missing files (as Pages serves them). The server records every document load whose navigation type is `reload`. Build A was served, a page opened under its Service Worker, then build B replaced the files at the same address.

### Chrome (DevTools MCP, isolated profiles)

- **New Service Worker:** after `registration.update()`, the build B worker installed, activated, and took control (its precache revisions replaced build A's; `controllerchange` observed in an earlier run). The page was not reloaded: an in-page marker survived, the navigation type stayed `navigate`, and the server recorded no reload. The notice appeared with the new-version wording, `role="status"`, `aria-live="polite"`, and build B's id.
- **Close and return to the tab:** after Close, a hidden-then-visible transition fetched `builds/latest.json` once, found the same build, and the notice stayed closed. An earlier run exposed the notice reappearing here because the worker path reported no build id; fixed by reading the id in `pwa-register.client.ts`, then re-verified.
- **Missing route chunk:** with `/terms` and `/privacy` chunks deleted (served as HTML), an in-app navigation recorded the outdated wording before Nuxt's `nuxt:reload` write and then reloaded to the destination URL.
- **PowerSync WASM served as HTML:** with all `_nuxt/*.wasm` deleted, opening `/terms` produced `RuntimeError: Aborted(CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f @+0)` in the shared-worker attempt; the page fell back to REST and showed the outdated wording. After restoring the WASM, Refresh reloaded `/terms` at the same URL, PowerSync initialized, and the notice was gone.
- **Layout and themes:** desktop 1200 px light, dark, and e-ink (e-ink computed `box-shadow: none`, `transition-duration: 0s`, `backdrop-filter: none`, black Refresh with white text); 768 px; 320 px (notice 296 px wide with 12 px margins, Refresh 56×32, Close 44×44, no horizontal overflow). With a WeChat user agent at 768 px and 375 px, the notice sat 8 px below the in-app-browser tip and returned to the top after that tip closed.

### Safari (macOS, Safari 27.2, driven through KimiCU)

- Safari's "Allow remote automation" is off, so WebDriver was unavailable and page scripts could not be read; observation used the accessibility tree, screenshots, and the server's reload log.
- Build A at `/terms?safari=1`, then build B served; opening and closing a new tab showed the new-version notice. No reload was recorded during the following 30 seconds. Close hid it, and a second tab switch did not show it again (that switch fell within the one-minute visibility throttle, so it is weaker evidence than the Chrome check above).

### Not verified

- The 5-minute scheduled check was not waited out in a browser; it is covered by unit tests with fake timers, including continued checks after the first newer build.
- iOS Safari, an installed (standalone) PWA, and a real Cloudflare Pages deployment were not exercised; they are part of the hands-on acceptance below or of the first `dev` release.
- Safari's route-chunk and WASM scenarios were not repeated; they use the same code paths as Chrome, with Safari's error text (`Importing a module script failed`) covered by the classifier tests.

## Review (task 3.3)

Local `REVIEW.md` passes (Bugs, Security, Compliance) on the final diff:

- Bugs: two Important findings were found and fixed before this record: the closed notice returning on the next visibility check (worker path without a build id), and Nuxt's scheduled check stopping after the first newer build, which would have hidden a later release from a page that stays visible. PowerSync and PWA reporters resolve the shared state while the Nuxt context is available; every reporter is wrapped so a failure cannot change navigation, recovery, fallback, or error capture.
- Security: no new dependency, network endpoint, or stored data; the only new request is the same-origin `builds/latest.json` Nuxt already fetches.
- Compliance: matches the proposal, design, and delta spec; tasks 1.1–3.3 are complete.

## Hands-on acceptance (DESIGN.md §10.2)

- Who: the change requester (GitHub `DGuang21`).
- When: 2026-11-20, before the pull request opened.
- Where: the local production-mode environment above (`http://localhost:3105`, builds A and B switched with `/tmp/wun/switch.sh`), exercising the new-version notice, Refresh, and Close.
- Result: accepted without adjustments ("我测过看过了，没问题").
