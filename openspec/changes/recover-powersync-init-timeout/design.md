# Design

## Context

See `proposal.md` for the confirmed diagnosis. The relevant SDK facts for `@powersync/web` 2.4.0:

- `PowerSyncDatabase` starts `initialize()` in its constructor; `init()` returns the same memoized promise. There is no public API to cancel it.
- With `IDBBatchAtomicVFS` and `enableMultiTabs`, the database server lives in the SharedWorker and serializes all clients through one connection lease. A queued `init()` proceeds when the lease is released.
- Nuxt `provide()` defines `$powersync` with a getter over a fixed value. Composables such as `useLocalBookmarks` capture the database during setup. Replacing the database inside a running document would require reworking every consumer.

## Decisions

### 1. Retain the timed-out instance

`tryMode` keeps its timeout race but no longer disposes the database when the error is a `PowerSyncInitializationTimeoutError`. Disposal for definite failures is unchanged, including the cleanup-timeout and cleanup-error stop rules.

`initializePowerSyncWithFallback` returns `{ database: null, mode: 'rest', pending }` for a timeout, where `pending` is `{ mode, ready }` and `ready` resolves `true` or `false` once the original `init()` promise settles; it never rejects. Recovery still stops after the timeout, so no second instance opens the same `dbFilename`. This removes the reason the current code stopped instead of retrying: concurrency comes from creating another instance, not from letting the first finish.

A `background-ready` or `background-error` event reports the outcome with `durationMs` measured from the attempt start. After a background failure the retained instance is disposed with the same bounded cleanup used for definite failures: its `init()` has settled, so closing no longer races with completion, and the SharedWorker client is released before the document unloads.

### 2. Resume through a full document load on the next navigation

For a top-level page with the plugin otherwise eligible for PowerSync, when `pending.ready` resolves `true`, the plugin installs a one-shot `router.beforeEach` guard. When the next navigation targets a different internal path, the guard starts Nuxt's external `navigateTo` document load and returns `false` to cancel the client-side transition, so the destination document starts PowerSync from scratch. Outside Nuxt middleware `navigateTo` does not cancel the transition by itself, so the explicit `false` is required. If the document load throws, the guard stays installed and lets that navigation continue on REST, so a later navigation can still resume. Destinations that do not start with a single `/` are ignored, matching `powersync-public-restore.client.ts`. The SharedWorker stays alive across the load because other tabs or the new document reconnect to it, and the new document's `init()` finds an already open, idle connection.

Alternatives rejected:

- Reloading the current page when initialization completes interrupts reading and may lose unsaved input.
- Hot-swapping `$powersync` needs reactive consumers across bookmarks, marks, collections, notifications, RSS, user state, and the bridge. The rework is large and every consumer would need a REST-to-local transition.
- Raising the timeout delays every affected startup and still fails when the hold is longer.
- Waiting indefinitely blocks the app mount because the plugin is async.

Hash-only and query-only navigation within the same path do not trigger the load, so in-page anchors and filters stay client-side. The guard is skipped inside the extension bridge iframe and when the plugin returned before database creation (public bypass, snapshot recovery, bridge without a session).

The retained instance is not reused inside the current document and is not closed: the next document needs no handoff, and closing would race with its completion.

### 3. Diagnostics

The plugin logs `[powersync] background initialization completed` with `{ mode, durationMs }`, or `[powersync] background initialization failed` with `{ mode, durationMs, error }`. The timeout event adds `visibility` (`document.visibilityState`) at the timeout. Logs stay in the console like existing PowerSync diagnostics; first-party delivery belongs to `powersync-client-telemetry`.

## Risks / Trade-offs

- **The first page of an affected session stays on REST** -> it already does today; the change bounds the rest of the session to one navigation.
- **A background init that never completes** -> the page behaves exactly as today, and the failure or absence is visible in diagnostics.
- **A full load on the next navigation costs one document request** -> it happens at most once per affected document, only after a timeout.
- **A retained instance consumes a SharedWorker client** -> it holds no lease after completion; the next document reconnects normally.

## Verification

Unit tests cover retention, the pending result, background events, unchanged cleanup rules, guard installation, path-change detection, and bridge exclusion. A production build is exercised in Chrome with a second tab holding the shared write lease past the timeout: before the change the page stays on REST after the lease is released; after the change a navigation returns the destination to local mode with synchronization requested.
