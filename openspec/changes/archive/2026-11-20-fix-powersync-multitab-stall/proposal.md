# Proposal

## Why

With several Slax Reader tabs open in desktop Chrome, a newly opened tab can fail to start its local database: initialization times out after 8 seconds and the page falls back to REST. Every tab shares one SharedWorker database connection, and each query holds it across several page-to-worker round trips. Chrome deprioritizes hidden tabs, so a hidden tab's query can hold the connection for tens of seconds while every other tab's initialization waits behind it.

The dominant source in the running Web app is live-query setup in background tabs: each watched query first resolves its tables with two `EXPLAIN` reads. Instrumented hidden `/bookmarks` tabs held the connection 32–88 s for these reads while a new tab timed out. A brief visible flash of a hidden tab (Chrome activates a neighbour when a tab closes) also released held work that then ran deprioritized for 9–13 s.

The Web client also runs `@powersync/web` 2.4.0 while 2.7.0 contains fixes relevant to this path (listener cleanup after aborted watches, error propagation across workers, recoverable connection-manager failures).

## What Changes

- A hidden Web page holds its live-query work (table resolution, initial runs, and re-runs after changes) until it has been visible for 500 ms, then runs each affected query once. Writes from hidden pages are not held.
- The extension bridge frame, which is never visible, is excluded.
- Upgrade Web PowerSync packages: `@powersync/web` 2.7.0, `@powersync/common` 2.5.0, `@powersync/shared-internals` 1.6.0, `@powersync/vue` 0.7.0 (wa-sqlite 2.0.10).
- Increment the Worker generation from `v4` to `v5`, since 2.7.0 changed the tab-to-worker protocol; a 2.7.0 page must not attach to a running 2.4.0 SharedWorker.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-local-sync`: local database startup in a new tab is no longer blocked by live-query work in hidden tabs; the Worker generation changes for the SDK upgrade while database identity and stored data are preserved.

## Impact

- User-visible: a page opened in a background tab, or a tab returning to the foreground, loads or refreshes its local live data about 0.5 s after it is shown. Inbox and other lists in background tabs stop updating until shown.
- `apps/web/app/local-first/powersync-visibility-gate.ts` (new), `apps/web/app/plugins/powersync.client.ts`, `apps/web/app/local-first/version.ts`, `apps/web/app/local-first/powersync-worker-policy.ts` (comment), `apps/web/package.json`, `pnpm-lock.yaml`.
- Tests: a unit spec for the gate; plugin specs assert installation for pages and exclusion for the bridge frame; four PowerSync database test doubles gain `onChangeWithCallback` and `resolveTables`; the PowerSync release browser check reads the Worker entry from the asset index instead of a fixed `worker-v4.js`.
- Unchanged: database filename and generation `v3`, data version, VFS (IndexedDB), timeouts, recovery order, sync rules, Mobile (`@powersync/react-native`), retention tooling (its `worker-v4.js` fallback applies only to legacy deployments without an asset index, which are all v4).
- Release: the first deployment starts new SharedWorkers under `worker-v5.js`; tabs still on `worker-v4.js` keep their worker and retained dependencies. A v4 and a v5 worker reading and writing the same database concurrently was verified.
- The extension loads the hosted `/x/ext-bridge` page, so it receives the SDK upgrade without an extension release; whether to increment the extension version is a release decision for the change requester.

## Approval

On 2026-11-20 the change requester approved this proposal, the design, and the verification scope after reviewing the reproduction and the side-by-side acceptance environments (this branch and `dev`). The requester also accepted the background-tab trade-off (hidden pages refresh live data about 0.5 s after they are shown). Delivery was first a separate task PR (#698); the requester then directed that it ship together with `optimize-bookmark` and `recover-powersync-init-timeout` in one pull request, since all three modify `web-local-sync` and are archived together. The extension version stays unchanged, following the previous decision for hosted `/x/ext-bridge` changes.
