# Proposal

## Why

A page opened before a Web deployment keeps running the previous build, and today it is reloaded without warning in two ways. Every build changes the PWA Service Worker (its precache lists `builds/meta/<build id>.json`), the worker calls `skipWaiting()` and `clientsClaim()`, and `vite-plugin-pwa` in `autoUpdate` mode calls `window.location.reload()` when the new worker activates; a local reproduction with two `preview` builds served at one address reloaded an open page with no user action. Separately, Nuxt checks for a newer build once an hour and reloads silently on the next navigation. Neither tells the user anything, and either can discard what they were reading or typing. When such a page later requests a chunk the new deployment no longer serves, Pages answers with the HTML shell and the load fails: on 2026-11-20 the test environment recorded a PowerSync local-database failure (`WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f`, the bytes of `<!DO`) from a `/bookmarks` page left open across a deployment, which the page could not recover from without a reload.

## What Changes

- Check for a newer Web build every 5 minutes instead of every hour, and also when the page becomes visible again after being hidden, using Nuxt's existing `builds/latest.json` check.
- Treat a version skew as detected when a newer build is published, when a newer Service Worker activates, when a dynamic chunk fails to load, or when PowerSync local-database initialization fails because a script or WASM response is HTML rather than the expected asset.
- Show a notice in the top-right corner telling the user a new version is available, with a **Refresh** action that reloads the current page and a **Close** action. When a version skew has already broken something (a failed chunk or PowerSync asset), the notice says the page is outdated and must be refreshed to keep working.
- Keep the user in control: the app no longer reloads when a new Service Worker activates or on the next navigation after a new build is published; the user refreshes from the notice. The PWA stays installable, and the new worker still installs and takes control as today. A failed chunk load during navigation still reloads to the requested page, as today, because the navigation cannot complete otherwise.
- Closing the notice hides it for the current build; a later deployment shows it again.

## Capabilities

### New Capabilities

- `web-update-notice`: detecting that an open Web page runs an outdated build and prompting the user to refresh.

### Modified Capabilities

None.

## Impact

- `apps/web/nuxt.config.ts`: `experimental.checkOutdatedBuildInterval`, `experimental.emitRouteChunkError`, and `pwa.client.registerPlugin: false`.
- A Web client plugin replaces `@vite-pwa/nuxt`'s client plugin: it registers the same Service Worker through `virtual:pwa-register` with `onNeedReload` routed to the notice, and still provides `$pwa.isPWAInstalled` for `pwaOpen`.
- A new client plugin and notice component under `apps/web/app`, mounted from the default layout; English and Chinese strings in `apps/web/i18n/locales/`.
- `apps/web/app/plugins/powersync.client.ts`: report a version-skew initialization failure to the notice; sync, recovery, and REST fallback behavior are unchanged.
- Nuxt's `chunk-reload` plugin behavior on `app:manifest:update` is replaced by the notice; its chunk-error reload stays.
- UI-visible: requires hands-on acceptance (`DESIGN.md` §10.2) before the pull request. No API, data, or dependency change.

## Assumptions

Decisions taken without the change requester's input, each open to change during review:

- Check interval: 5 minutes, plus a check when the page becomes visible. Each check fetches one small JSON file.
- Closing the notice hides it until a newer build appears; it is never re-shown on a timer for the same build.
- A version skew that already broke a load uses the same top-right notice with stronger wording, not an automatic reload, so unsaved input is not lost.
- No requirements-discovery demo: the notice reuses the existing top-right tip pattern (`InAppBrowserTip`) and does not restructure navigation, flows, or layout. Hands-on acceptance after implementation still applies.
- Out of scope: retaining earlier builds' assets so old pages keep loading is the separate change `retain-web-build-assets`. The PowerSync retention step that should keep replaced Worker resources for 7 days logged `download-unavailable` for every historical deployment in the 2026-11-20 test release and retained none. That is now addressed there; this change makes skew visible and recoverable whether or not retention covers a page.
