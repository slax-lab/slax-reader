# Tasks

## 1. Detection

- [x] 1.1 Set `experimental.checkOutdatedBuildInterval` to 5 minutes and `experimental.emitRouteChunkError` to `manual` in `apps/web/nuxt.config.ts`. Verify with a production build that `.nuxt/nuxt.config.mjs` exports `outdatedBuildInterval = 300000` and `chunkErrorEvent = "vite:preloadError"`, and that Nuxt's `chunk-reload` plugin is no longer registered.
- [x] 1.2 Add `update-notice.client.ts` holding the shared notice state, listening to `app:manifest:update` and `app:chunkError`, checking `builds/latest.json` when the page becomes visible (throttled to once a minute, production only), and reloading to the destination when a navigation fails on a recorded chunk error. Verify with unit tests: a manifest update sets `available` with its build id; a chunk error sets `outdated`; `outdated` is not downgraded; a visibility change runs one check per minute and ignores a failed fetch; a failed navigation with a chunk error reloads to its destination; a manifest update alone never reloads on navigation.
- [x] 1.3 Set `pwa.client.registerPlugin: false` and add `pwa-register.client.ts` that registers the Service Worker with `onNeedReload` routed to the notice and provides `$pwa.isPWAInstalled`. Verify with unit tests that `onNeedReload` sets `available` without reloading, that `isPWAInstalled` follows `display-mode: standalone`, and that the existing `pwaOpen` tests pass; and with a production build that `dist/sw_prod.js` and the manifest are unchanged in shape.
- [x] 1.4 Report version skew from `powersync.client.ts` on `attempt-error` and main-mode `init` failures whose message matches a non-executable-response signature (WebAssembly magic-word mismatch, `Unexpected token '<'`, HTML module-script MIME rejection). Verify with unit tests that each signature reports skew, that storage, quota, lock, and timeout errors do not, and that a throwing reporter changes neither recovery nor fallback.

## 2. Notice

- [x] 2.1 Add `UpdateNotice.vue` and mount it inside `<ClientOnly>` in the `default` and `blank` layouts, with English and Chinese strings for both wordings, Refresh, and Close. Verify with component tests: hidden with no state; `available` and `outdated` wording; Refresh reloads the current path; Close hides it for that build and a new build id shows it again; a skew after Close shows it again; `role="status"` and `aria-live="polite"` without moving focus.
- [x] 2.2 Style the notice with `--slax-*` tokens following `InAppBrowserTip`: top-right with safe-area insets, full width minus margins below 768px, visible `:focus-visible`, at least 32px targets, reduced-motion without slide-in, e-ink without shadow, stacking below the in-app-browser tip when both show. Verify in a running build at desktop, 768px, and 320px widths in light, dark, and e-ink.

## 3. Verification

- [x] 3.1 Run Web lint on changed files, `typecheck`, `pnpm web -- test`, and `openspec validate --all --strict`.
- [x] 3.2 Exercise production-mode `preview` builds in Chrome and Safari: serve build A, open a page under its Service Worker, then serve build B at the same address and trigger a worker update, and confirm the page is not reloaded (an in-page marker survives and the navigation type stays `navigate`) and the notice appears; confirm the notice also appears within 5 minutes and on returning to the tab; make a route chunk and a PowerSync WASM request return HTML and confirm the outdated wording; confirm Refresh loads the new build and Close holds until a newer build. Record results in `validation.md`.
- [x] 3.3 Complete the local `REVIEW.md` review and the change requester's hands-on acceptance (`DESIGN.md` §10.2) in the running build before the pull request, recording who, when, and what was adjusted in `validation.md`.
