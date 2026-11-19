# Implementation validation

## Scope and approval

On 2026-11-19 the requester asked that article startup load content by request first and wait for PowerSync afterwards, and asked for a partly client-rendered detail page. After discussion in this task conversation the requester chose "only do 1", asked that permission checks be handled carefully, and asked which other pages can use the same fallback. The client-rendered body request is not implemented; see `proposal.md`.

Implementation is on `feat/defer-snapshot-local-startup`. The branch is based on `fix/recover-powersync-init-timeout` (PR #678, head `025faef4`) because both change `apps/web/app/plugins/powersync.client.ts`; it must merge after #678. The SDK, VFS, timeouts, database generation, data version, SSR, edge caching, and `/api/content` are unchanged.

## Route classification evidence

All 23 Web pages were checked for direct and indirect local-database use (`$powersync`, `isLocalFirstEnabled`, `useLocal*`, `LocalFirstAdapterKey`, `useQuery`/`useStatus`, `useRss*`, the Pinia profile fallback).

- Direct users: `/b/[id]`, `/bookmarks` (via `BookmarksPage`), `/x/ext-bridge`.
- `/user` uses local data only through `BookmarksTopBar` (non-production sync indicator) and `UserNotification` (local notification feed). Both take their REST or empty branch when `$powersync` is null.
- `/collection/manage` has no local-data consumer.
- `/` and `/bookmarks` stay blocking because `offline-onboarding-readiness` and `inbox-onboarding-readiness` require local ownership and first-sync proof before onboarding.

## Automated checks

- `pnpm web -- typecheck`: passed.
- `pnpm web -- test` (full Web suite, final revision): 3,222 passed, 3 skipped, 1 failed. The failure is `tests/unit/composables/useSlaxRoutes.spec.ts > Nuxt 自动导入覆盖` hitting its 10 s timeout under full-suite load. That file is untouched by this change. Run alone it passed 6/6, with the case taking 1.2 s.
- New and changed tests in `tests/unit/local-first/` and `tests/unit/components/Article/`:
  - `deferred-startup-policy.spec.ts` (18): route matching.
  - `powersync-deferred-startup.spec.ts` (19):
    - mount without waiting on all three routes; readiness only after recovery, data-version, and account checks;
    - REST on ownership, data-version, and initialization failure; account-switch clearing;
    - a timed-out instance published after background success and not published after background failure;
    - blocking startup on `/bookmarks`, `/`, `/s/`, the bridge, and iframes;
    - the exit guard's document load, client-side reader navigation, bounded 2 s wait, failure recovery, and ignored external destinations.
  - `snapshot-local-takeover.spec.ts` (11):
    - owner allowed;
    - refused for visitor, account change, another database owner, unestablished owner, unreadable token, missing row, and failed lookup;
    - no lookup for visitors;
    - re-check after the lookup for both generation and database owner.
  - `bookmark-article-local-first-adapters.spec.ts` (3): blocking path keeps local tags; a late database writes marks locally with that database and keeps tags on REST; REST before the switch. This test caught a regression in an earlier revision: an omitted boolean prop defaulted to `false` and would have moved blocking-path tags to REST. It was fixed with `withDefaults`.
  - Existing plugin tests were adjusted only for the new route behavior: `/b/example` moved out of the blocking-route list, bridge tests wait for readiness, and a router mock gained `beforeEach`. All 180 local-first tests passed.
- ESLint on every touched file: clean.
- `pnpm web -- build` (beta profile, synthetic local configuration): passed.
- `openspec validate defer-snapshot-local-startup --strict`: valid.

## Running environment

- **App:** the built `apps/web/dist/_worker.js`, run by Wrangler 4.127.0 `pages dev` with local R2 holding a synthetic article body.
- **Backend:** a synthetic `reader-edge` service bound as `BACKEND`. `/content/meta` returns `role: owner` for token user 4242 and `role: visitor` otherwise.
- **Front proxy:** a local proxy serves synthetic `/v1/*`, `/v1/sync/token`, and `/sync/stream`. The stream delivers that bookmark's `sr_user_bookmark` row with `alias_title: LOCAL ALIAS`. All other paths go to the Pages server, so server-side rendering is real.
- **Browser:** headless Chrome 158 ran the real Nuxt application and PowerSync SDK. No real account, API, or PowerSync service was used.

A first tab opened `/bookmarks`, waited until the bookmark row was synced locally, then held `$powersync.writeLock()` for 12 s.

| Scenario | Result |
| --- | --- |
| Owner opens `/b/e2e-snap` while the lease is held | Hydrated in 311-560 ms (final revision: 418 ms) (previously about 8.5 s for blocked documents). SSR title and body present; `$powersync` null; REST marks loaded |
| Owner after the lease is released | `deferred local startup settled {ready: true, durationMs: 11544}`; the title switched in place to `LOCAL ALIAS`; the body was not reloaded |
| Another account (user 7) opens the same snapshot | Hydrated in 332-420 ms; never switched to local data |
| `/user` while the lease is held | Hydrated in 210-476 ms |
| `/bookmarks` while the lease is held | Hydrated at 8.17-8.3 s (unchanged blocking startup) |
| `/b/` then in-app navigation to `/bookmarks` | New document request for `/bookmarks`; the old document's state was gone; the new document had `$powersync` |
| `/b/` then in-app navigation to `/user` | Client-side; the page marker was preserved |
| Anonymous `GET /b/e2e-snap` | 200 with title and first-screen body in the HTML; the Pages server reported `x-bcache: hit` |
| Owner `GET /b/e2e-snap` | 200 with title and body; `cache-control: private, no-store` |

An earlier run failed the owner-switch scenario because the lease holder blocked the first sync before the bookmark row arrived, so `exists(uuid)` was false and the page correctly stayed on REST. The harness was corrected to hold the lease only after the row was synced, matching a returning owner.

## Not verified

- Real production data volume, accounts, and the real PowerSync service.
- Safari, iOS, and Android: those browsers select dedicated workers; the deferred path is browser-independent, but no device run was performed.
- Interactive highlight, comment, archive, star, and title writes after the in-place switch in a real browser: covered by unit tests of the injected database path, not clicked in the browser run.
- Tag editing on a deferred owner page in a real browser: covered by the adapter unit test, not clicked in the browser run.
- No deployment was performed.

## Delivery checkpoints

- UI hands-on acceptance: pending. The change alters startup timing and the moment an owner's page switches to local data. It needs the requester's hands-on acceptance before merge.
- Version impact: only `apps/web` changes. Web does not use package-version increments (`docs/release/VERSIONING.md`).

The final revision passed all 7 browser scenarios in one run (`SUMMARY [final] 7/7 passed`), and its anonymous and owner SSR responses were re-checked.

## Local review

Bugs, Security, and Compliance passes per `REVIEW.md` on the final diff.

- **Bugs, Important, fixed during implementation:**
  - A deferred owner page switched `tagsDataSource` to `local` while `BookmarkTags` had captured no local writer at setup, so tag edits would have shown an error. Tags stay on REST on a deferred page.
  - An omitted `localTags` prop defaulted to `false` and moved blocking-path tags to REST. Fixed with `withDefaults`; both are covered by the adapter test.
- **Bugs, checked with no change:**
  - Snapshot session recovery and the anonymous public bypass return before deferral.
  - The bridge and iframes never defer.
  - An account switch during the wait clears the late sources, and a pending takeover for the earlier generation is rejected by the generation re-check.
  - External navigation (login redirects) does not pass through the exit guard.
  - The blocking path's startup sequence is unchanged. Whitespace-insensitive diff of the plugin: +103/-9, all in the new deferred branch, readiness plumbing, and the extracted `startLocal`.
- **Security:**
  - Local rows are exposed only after the existing data-version gate and account guard, plus the owner checks.
  - New diagnostics log readiness, duration, and destination path only; no token, account identifier, or query string.
  - No new network calls, storage, or dependencies.
- **Compliance:**
  - The diff implements every scenario in `specs/web-local-sync/spec.md`, and the evidence above covers each one.
  - The body-stays-server-rendered requirement is verified by the SSR checks.
  - Open item: human hands-on acceptance.
