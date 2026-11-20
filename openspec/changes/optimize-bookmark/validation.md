# Implementation validation

## Scope and approval

On 2026-11-19 the requester asked that article startup load content by request first and wait for PowerSync afterwards, and asked for a partly client-rendered detail page. After discussion in this task conversation the requester chose "only do 1", asked that permission checks be handled carefully, and asked which other pages can use the same fallback. The client-rendered body request is not implemented; see `proposal.md`.

Implementation is on `feat/optimize-bookmark` (the change was first proposed as `defer-snapshot-local-startup` and renamed on 2026-11-20 at the requester's request). The branch is based on `fix/recover-powersync-init-timeout` (PR #678, head `025faef4`) because both change `apps/web/app/plugins/powersync.client.ts`; it must merge after #678. The SDK, VFS, timeouts, database generation, data version, SSR, edge caching, and `/api/content` are unchanged.

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
- `openspec validate optimize-bookmark --strict`: valid.

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

## Switch flicker investigation (2026-11-19 follow-up)

The requester asked whether the REST-to-local switch can flash. A frame-sampling harness (`requestAnimationFrame` sampling plus a `MutationObserver` on `slax-mark`) recorded, every rendered frame: the title, the highlight count, whether each highlight carries the reader's own style, and the archive and star toolbar state. The harness used 30 highlights, Chrome CPU throttling at 6x, and a 12 s held lease (slow path).

Two real flashes were found and fixed:

- **Archive/star toolbar.** The page switched as soon as the local queries mounted, before the local row loaded. Recorded toolbar sequence `11 -> 00` (archived+starred, then shown as neither). The page now switches only after the local row has loaded. After the fix: `11` only.
- **Stale local data.** With REST showing 30 highlights and the local database holding 29, the count went `30 -> 29`. The page now keeps the shown REST highlights until the local rows cover them (`localMarksCoverShown`). Extra local highlights do not block, and the reader's own local writes hand over immediately. After the fix: `0 -> 30`, with no drop.

Checked and found not to flash:

- **Highlights with identical data.** `drawMarks` clears and repaints all marks, but no frame showed fewer than the full count. The clear and repaint finished within one task (for example `[12309, 12309, 12317]` ms), because `MarkRenderer.drawMark` does no asynchronous work.
- **Title, own-highlight style, fast path.** Constant across all frames. The harness's synthetic `/v1/user/me` originally lacked `userId`, which hid own-highlight styling; that was corrected to the real response shape before these runs.
- **Auto-opened side panel.** Decided once at first load, not on the switch.

Final-revision results:

| Case | Frames | Highlights below full after first paint | Title | Own-highlight style | Toolbar |
| --- | --- | --- | --- | --- | --- |
| Slow path, same data, 30 highlights, CPU 6x | 1,051 | 0 | constant | constant `self` | constant `11` |
| Fast path, no held lease | 563 | 0 | constant | constant `self` | constant `11` |
| Slow path, local missing 1 of 30 | n/a | count `0 -> 30` | n/a | n/a | n/a |

New tests:

- `snapshot-mark-handover.spec.ts` (7): superset, missing mark, comment change, deletion change, empty REST, and a deleted mark absent locally.
- Local-first and Article tests after the change: 517 passed, 2 skipped. The full Web suite on the final revision passed with no failures (263 files, 1 skipped). Typecheck passed. The 7 regression scenarios passed again on the final build.
- One run failed 2 of 7 scenarios with `title: null, body: false`. The synthetic `reader-edge` process had exited (`content meta returned 503`). After restarting it, all 7 passed; the product code was unchanged between those runs.

Remaining limit: identical-data checks used one machine and synthetic content. Highlight anchors that resolve through the slower approximate-match path, and very large bodies, were not measured.

## Recorded verification (2026-11-20)

At the requester's request, a `slax/deepseek-flash` subagent screen-recorded the switch on the production build with Chrome DevTools `Page.startScreencast`. It captured JPEG q92 frames at repaint time, up to about 60 fps, and encoded them losslessly to VP9.

Recordings, all with an owner, 30 highlights, and an archived and starred bookmark:

| Recording | Setup | Switch at | Result |
| --- | --- | --- | --- |
| Slow path, throttled | Lease held 12 s, CPU throttled 6x | 12.04 s | No change in title, highlight, or toolbar regions |
| Slow path, unthrottled | Lease held 12 s, no throttling | 12.02 s | No change |
| Fast path | No held lease | 0.39 s | First render only; no region changed and returned |

Evidence:

- After the first load, every consecutive frame pair differed by 0 pixels through the end of each recording, switch included.
- On the slow path, the frames before the switch, after the DOM replaced all 30 `slax-mark` nodes, and 6 s later had the identical md5 `a976442269b3a3625d2e9d091cc7141a`.
- A full-size key frame was inspected manually: highlights and the Archived/Starred buttons were visible.

Limits:

- The screencast emits frames only on repaint.
- At 1280x800 only the first 10 or so highlights are visible on screen; the remaining 20 were checked through DOM sampling, not pixels.
- The recordings are local test artifacts and were not committed.

## PR #688 review follow-up (2026-11-20)

The automated review of `91bfffcb` reported no Important Bugs or Security findings and two Nits. Both were fixed:

- **Exit guard could stay stuck.** The guard cleared `leaving` only when the document load threw. If the browser or an extension suppressed the unload, every later navigation was cancelled. The guard now re-arms 3 s after a successful hand-off. A regression covers a suppressed unload followed by a retry.
- **Owner REST marks waited for the takeover decision.** REST marks, mark drawing, and `localReady` waited up to 1.5 s plus the local `exists()` lookup. Now REST marks load and draw at once, and only the reading-position restore waits, through a separate `positionReady` gate.

Re-verification on the final revision:

- Typecheck passed.
- Local-first and Article unit tests: 518 passed, 2 skipped.
- Full Web suite: 3,230 passed, 1 failed. The failure was the untouched `useSlaxRoutes.spec.ts` case hitting its 10 s timeout under full-suite load; run alone it took 2.9 s and passed 6/6.
- The beta production build passed.

Browser run on real SSR (30 highlights, 12 s held lease):

- **Owner:** REST highlights drew at 2,486 ms, about 9.6 s before local readiness at 12,099 ms. Across 968 frames at 6x CPU throttling, through the switch:
  - the highlight count never dropped below 30;
  - own-highlight style, toolbar (`11`), and title were each constant.
- **Visitor:** 704 ms to hydrate, REST only.
- **`/user`:** 565 ms to hydrate.
- **`/bookmarks`:** kept blocking startup, 8,582 ms.
- **`/b/` -> `/user`:** stayed client-side.
- **Anonymous HTML:** contained the title and body.

The exit scenario first reported `path: /onboarding`. The document load to `/bookmarks` did happen, and the new document had its local database. That run's synthetic data contained a single archived bookmark, so the Inbox was empty and the existing onboarding rule redirected. With the bookmark not archived, the same exit ended on `/bookmarks`. This is existing behavior, not a regression.

The UI hands-on acceptance finding remains open; it needs the requester's acceptance.
