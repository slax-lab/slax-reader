# Design

## Context

- Nuxt runs non-`parallel` plugins serially and mounts the Vue application only after every plugin settles (`nuxt/dist/app/entry.js`). `slax:powersync` awaits recovery, `ensureDataVersion`, and `guardAccount` before returning, so each delays mount.
- `$powersync` is provided once with a getter over a fixed value. `isLocalFirstEnabled()` reads it synchronously, and every local-first consumer (`useLocalBookmarks`, `useLocalMarks`, the `local-first-adapters` factories, `useLocalSyncStatus`, `useRss`, the Pinia profile fallback) captures that decision during setup.
- `@powersync/vue` `useQuery` resolves its client with `inject` at setup. `createPowerSyncPlugin` calls `app.provide`. A Vue check confirmed that an `app.provide` performed after mount is visible to components created afterwards.
- `/b/[id]` server-renders from `/api/content/[uuid]`. After mount `initializeClientDetail` sets `localFirst` only when `local.exists(uuid)` and `isOwner`. With `localFirst` false the article uses `DwebHttpClient` and `isOwner` still enables highlighting and comments.

## Decisions

### 1. Route policy

`app/local-first/deferred-startup-policy.ts` exports `isDeferredLocalStartupPath(pathname)`, true for `/b/<id>`, `/user`, and `/collection/manage` (trailing slash accepted), and `needsLocalStartupDocumentExit(pathname)`, true for paths outside that set. The plugin defers when the document is top-level, not the bridge, not in snapshot session recovery, not on the anonymous public bypass, and its initial pathname matches. Like `public-startup-policy.ts`, the decision uses the initial pathname only.

### 2. Background startup with a readiness API

The plugin factors its existing body after the bypass checks into `startLocal(): Promise<PowerSyncDatabase | null>`, which runs recovery, `ensureDataVersion`, and `guardAccount` unchanged and returns the database only when all pass. In the blocking path the plugin awaits it and keeps today's provide shape. In the deferred path it returns at once with `$powersync: null` and runs `startLocal()` in the background.

A deferred document is already readable on REST, so on an initialization timeout it keeps waiting for the instance retained by `recover-powersync-init-timeout`. When that background initialization succeeds, the same data-version gate and account guard run on it before publication. When it fails, the instance is disposed and the document stays on REST. Blocking documents keep the existing timeout behavior and its navigation-time document load.

Both paths provide `$powersyncReady: ShallowRef<PowerSyncDatabase | null>` and `$powersyncWhenReady(): Promise<PowerSyncDatabase | null>`. When a deferred start succeeds, the plugin installs `createPowerSyncPlugin({ database })`, sets the ref, starts `connect`, and registers the cookie watcher and router reconciliation that the blocking path registers. `$powersync` stays `null` for the document lifetime, so every captured consumer keeps its REST branch.

### 3. Leaving a deferred document

The plugin registers a `router.beforeEach` guard on deferred documents. For a destination where `needsLocalStartupDocumentExit` is true, it cancels the client transition and performs a full document load (`navigateTo(fullPath, { external: true })`, then `false`), after awaiting `$powersyncWhenReady()` bounded by 2 s so pending local writes and the account guard can finish. Destinations that do not start with a single `/` are ignored. This gives the Inbox its normal local-first startup and onboarding guarantees. Navigation among deferrable routes stays client-side.

### 4. Detail page upgrade

`/b/[id]` keeps its REST-first logic. When `$powersync` is null and the document is deferred, it awaits `$powersyncWhenReady()` after the REST initialization finishes (`loadMarks` already ran). The upgrade proceeds only when all hold at that moment:

- a database is ready;
- the account generation equals the one captured before waiting;
- `metadata.role === 'owner'` in the current `/api/content` response;
- `useState('powersync-owner')` equals `getTokenUserId(getUserToken())`;
- `exists(uuid)` on that database is true;
- the conditions above still hold after the asynchronous lookup (`canTakeOverSnapshotLocally` re-evaluates them).

It then mounts `SnapshotLocalDetail`, a renderless child that calls `providePowerSync(database)` and sets up `useLocalBookmarks(database)`, `watchDetail(uuid)`, and `watchMarkDetail(uuid)`, then emits them to the page. `useLocalBookmarks`, `useLocalMarks`, and `LocalFirstHttpClient` accept an optional database; existing callers pass none and keep reading `$powersync`.

The owner check waits at most 1.5 s for readiness before deciding, because `useReadingPosition` waits on `localReady` for up to about 5 s. A database that becomes ready later still upgrades the page in place, without a reading-position restore. The page sets `localFirst = true` only when the child emits, so `marks`, `detail.title`, archive/star state, and the selection client switch together. The body is never refetched. Local writes (`setAliasTitle`, `setArchive`, `setStar`, local marks) use the child's composables.

In the blocking path the page keeps today's in-setup local queries.

### 5. Writes during the REST window

Before the upgrade, owner highlights, comments, archive, star, and title edits use REST, as they do today when local mode is unavailable. Synchronization later delivers the rows, so the local view shows them after the switch.

## Risks / Trade-offs

- **Leaving the reader costs one document load** -> only when leaving a deferred document for a non-deferrable route, at most once per document.
- **Late `app.provide`** -> verified for Vue's app-level provides. Only components created after readiness read it, which is the intent.
- **Account change during the wait** -> `guardAccount` runs inside `startLocal`, and the page re-checks generation and owner before the switch.
- **Logout during the wait** -> the cookie watcher is registered when startup succeeds; until then nothing local is exposed, and a logged-out page stays on REST.

## Verification

Unit tests cover the route policy, the deferred readiness API (success, data-version failure, account guard failure, recovery unavailable), the exit guard, and the detail upgrade checks. In a production-profile build in Chrome, with another tab holding the database lease for 12 s:

- `/b/[id]` mounts at normal time, and REST highlighting works.
- After readiness, an owned bookmark switches to local marks and title, and a visitor or another account never switches.
- `/user` mounts at normal time.
- Leaving to `/bookmarks` performs one document load and the Inbox starts local-first.
- `/bookmarks` keeps its existing startup.
- Anonymous `/b/[id]` HTML still contains the body.
