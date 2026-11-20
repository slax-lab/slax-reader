# Design

## Context

See `proposal.md` - Why. Nuxt 4.5.2 already provides the pieces this change builds on:

- With `experimental.appManifest` (on by default), the client plugin `check-outdated-build` fetches `/_nuxt/builds/latest.json` every `experimental.checkOutdatedBuildInterval` (default one hour) and calls the `app:manifest:update` hook when its `id` differs from the running build's. The Pages `_headers` give `/_nuxt/builds/*` `max-age=1`, so the check sees a new deployment almost at once.
- With `experimental.emitRouteChunkError: 'automatic'` (the default), Nuxt calls `app:chunkError` for Vite `vite:preloadError` events, and its `chunk-reload` plugin reacts to `app:manifest:update` by adding a router `beforeResolve` guard that reloads the app on the next navigation. It also reloads to the destination when a navigation fails on a chunk error.
- PowerSync local-database initialization runs in `powersync.client.ts` through `initializePowerSyncWithFallback`, which reports each failed attempt as an `attempt-error` recovery event with the thrown error. A skewed Worker asset fails with the browser's WebAssembly or script error, whose message names the HTML bytes (`expected magic word 00 61 73 6d, found 3c 21 44 4f`).
- `@vite-pwa/nuxt` 1.1.1 registers the Service Worker through its own client plugin, which calls `useRegisterSW` without `onNeedReload`. With `registerType: 'autoUpdate'`, `vite-plugin-pwa`'s `registerSW` then calls `window.location.reload()` on the Workbox `activated` event when `isUpdate` or `isExternal` is set. `apps/web/app/service-worker/sw_prod.ts` calls `skipWaiting()` and `clientsClaim()`, and the precache manifest includes `builds/meta/<build id>.json`, so every build yields a different worker that activates at once. The plugin's options do not expose `onNeedReload`; `client.registerPlugin: false` removes the plugin, and `virtual:pwa-register` remains available to the app. The plugin also provides `$pwa`, of which the app reads only `isPWAInstalled` (in `pwaOpen`).
- The existing top-right `InAppBrowserTip` defines the Web pattern for a non-modal, dismissible top-of-page tip: `role="status"`, `aria-live="polite"`, semantic `--slax-*` tokens, safe-area insets, and reduced-motion handling.

## Goals / Non-Goals

**Goals:**

- One client-side source of truth for "this page is outdated", fed by three signals, rendering one notice.
- No silent reload for a published build; the existing reload for a navigation that cannot complete stays.

**Non-Goals:**

- Repairing the PowerSync retention step in the release tooling, or making old assets available longer.
- Detecting skew inside the Extension, which embeds `/x/ext-bridge` in an offscreen document with no visible page.
- Preserving unsaved in-page state across the user's refresh.

## Decisions

### A small client store fed by hooks, rendered by one component

A client plugin `update-notice.client.ts` keeps a shared `useState('slax-update-notice')` with `{ kind: 'available' | 'outdated', buildId, dismissedBuildId }`. It listens to `app:manifest:update` (kind `available`, `buildId` from the hook's meta), to `app:chunkError` (kind `outdated`), and exposes a `reportVersionSkew()` used by PowerSync. `outdated` wins over `available` and is never downgraded. A component `UpdateNotice.vue`, mounted in both `default` and `blank` layouts inside `<ClientOnly>`, renders when the state is set and not dismissed for its build.

Alternative: patching Nuxt's plugins or showing a Toast. Toasts auto-hide, which suits neither a persistent "please refresh" nor a skew that has already broken loading.

### Own the Service Worker registration

Set `pwa.client.registerPlugin: false` and add `pwa-register.client.ts`, which calls `registerSW({ immediate: true, onNeedReload })` from `virtual:pwa-register`. Passing `onNeedReload` makes `vite-plugin-pwa` call it instead of `window.location.reload()`; the plugin routes it to the notice as kind `available`. Registration, `skipWaiting`, `clientsClaim`, precaching, and the PWA manifest are unchanged, so the app stays installable and the new worker serves later requests. The plugin also provides `$pwa` with `isPWAInstalled` (from `display-mode: standalone` and iOS `navigator.standalone`, updated on `display-mode` change), the only member the app reads. `useNotification` keeps its own `registerSW` call, which is unreachable today (no component renders `UserNotification`) and is left as is.

Alternative: patching `vite-plugin-pwa` or switching to `registerType: 'prompt'`. A patch is brittle across upgrades; `prompt` also changes the worker to wait for `skipWaiting`, so old pages would keep the old worker's caches.

### Faster and visibility-driven checks without replacing Nuxt's checker

Set `experimental.checkOutdatedBuildInterval` to 5 minutes. The update plugin also calls the same check when `document.visibilityState` becomes `visible`, throttled to once a minute, by fetching `builds/latest.json` with a cache-busting query and comparing it with `useAppManifest`-loaded `getAppManifest()`; a newer `id` calls the same `app:manifest:update` hook so both paths converge. The check is skipped in development, where Nuxt does not emit a build manifest.

Alternative: polling in a custom timer alone. Reusing Nuxt's checker keeps one implementation of the manifest comparison.

### Replace the silent navigation reload, keep the chunk-error reload

Nuxt's `chunk-reload` registers its silent `beforeResolve` reload inside its own `app:manifest:update` handler. Set `experimental.emitRouteChunkError: 'manual'`, which stops Nuxt from installing `chunk-reload` while keeping `app:chunkError` emission, and reproduce only its chunk-error part in the update plugin: record chunk errors per navigation and, on `router.onError` with a recorded chunk error, call `reloadNuxtApp({ path: to.fullPath, persistState: true })`. The crawler reload plugin remains installed by Nuxt whenever `emitRouteChunkError` is set.

Alternative: keeping `automatic` and removing the guard after Nuxt adds it. That depends on Nuxt's internal registration order.

### Classifying PowerSync skew narrowly

In `logPowerSyncRecoveryEvent`, on `attempt-error` and on the main-mode `init` failure, call `reportVersionSkew()` only when the error message matches a non-executable-response signature: the WebAssembly magic-word mismatch, `Unexpected token '<'`, or a module script MIME-type rejection (`text/html`). Storage, quota, lock, and timeout errors do not match. Classification runs inside the existing guarded capture, so it cannot change recovery or fallback.

Alternative: treating every initialization failure as skew. That would tell users to refresh for storage problems a refresh does not fix.

### Notice behavior

- Wording: `available` — "A new version is available" / "Refresh to get the latest version."; `outdated` — "This page is out of date" / "Refresh to keep using Slax Reader." Chinese strings are added alongside.
- Refresh calls `reloadNuxtApp({ path: route.fullPath, persistState: false, force: true })`, a full reload at the current URL. Close records `dismissedBuildId` (the current `buildId`, or the literal `outdated` for a skew).
- Placement and look follow `InAppBrowserTip`: fixed top-right with safe-area insets, `--slax-surface-solid` background, `--slax-border-strong` border, `--slax-shadow-modal`, `--slax-text` / `--slax-text-secondary` text; full width minus margins under 768px. Refresh is a primary button using `--slax-accent`; Close is an icon button with an accessible name. Both have visible `:focus-visible` rings and at least 32px touch targets; e-ink drops the shadow per the theme stylesheet; reduced motion disables the slide-in.
- `role="status"` and `aria-live="polite"`; focus is not moved. When both the in-app-browser tip and this notice would show, this notice stacks below it by a fixed offset.

## Risks / Trade-offs

- [A user ignores the notice and keeps using an outdated page] → Chunk failures during navigation still reload as before, and a broken PowerSync load upgrades the notice to the outdated wording.
- [`emitRouteChunkError: 'manual'` changes a Nuxt default] → The reproduced chunk-error reload is covered by a unit test that fails if a failed navigation does not reload.
- [Removing `@vite-pwa/nuxt`'s client plugin drops its install-prompt and periodic-sync helpers] → Neither is configured or read by the app today; `$pwa.isPWAInstalled` is reproduced and covered by the existing `pwaOpen` tests.
- [Polling every 5 minutes] → Each check is a ~70-byte JSON fetch with `max-age=1`; the visibility check is throttled.
- [An error message format changes in a browser] → An unmatched skew falls back to today's behavior (no notice from PowerSync); the newer-build check still shows the notice.
- [Pages left open in a background tab never check] → Browsers throttle timers in hidden tabs; the visibility check covers the return.

## Migration Plan

Ships with the next Web deployment and needs no data migration. The first deployment after it reaches pages already running the new code only; pages opened before it still have the hourly silent reload. Rollback is a revert.
