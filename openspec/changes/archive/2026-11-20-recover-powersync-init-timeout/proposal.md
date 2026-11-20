# Proposal

## Why

Production Chrome sessions intermittently log `PowerSyncInitializationTimeoutError: PowerSync shared initialization timed out after 8000ms` followed by `local database initialization unavailable; using REST fallback` with `stopReason: 'initialization-timeout'`. The page then stays on REST for the whole document lifetime: no local queries, no synchronization, and no recovery until the user reloads.

The diagnosis confirmed the mechanism. With the default `IDBBatchAtomicVFS`, `@powersync/web` 2.4.0 hosts one SQLite connection in the SharedWorker, and every tab plus the shared sync worker queue on a single FIFO lease. A new tab's `init()` needs a write lease for schema setup and trigger cleanup. In a Chrome 158 reproduction with the real SDK, another tab holding the write lease for 12 seconds made a new tab's initialization time out at 8,002 ms, matching the production `durationMs: 8004`. The production `stopReason` was `initialization-timeout`, not `cleanup-timeout`, so the worker still answered the cleanup call within 250 ms: the database was busy, not dead. The server side was healthy (no 5xx in 24 hours) and the deployed Worker graph serves valid JS and WASM.

Two details make the current fallback worse than necessary:

- After the timeout, recovery closes the timed-out instance, discarding an initialization that would usually complete seconds later once the lease is released.
- The page has no path back to local mode during its lifetime.

The repeated `[shared-sync]: Sync error Error: Could not open DB connection since no client is connected.` logs were reproduced separately: they occur every 5 seconds while a page holds the local database but no page is connected to synchronization, and they stop as soon as a connected tab returns. They do not block initialization and are out of scope.

## What Changes

- On an initialization timeout, keep the timed-out database instance instead of closing it, and let its `init()` continue in the background. The page still starts on REST immediately; the timeout bound and REST behavior are unchanged.
- When the background initialization completes for a top-level page, the next client-side navigation to a different path performs a full document load of that destination, so the new document starts PowerSync normally and returns to local mode and synchronization. The current page is never reloaded on its own.
- Record the background outcome in the browser console: completion time, failure, and whether the page was visible at the timeout.
- Keep every other recovery rule: no second local instance after a timeout, cleanup failure still stops recovery, definite failures still try the next mode, and the database filename, data-version state, and pending mutations are untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-local-sync`: initialization timeout keeps the original instance for background completion and allows a top-level page to resume local mode on its next navigation.

## Impact

- `apps/web/app/local-first/powersync-recovery.ts`, `apps/web/app/plugins/powersync.client.ts`, and their unit tests.
- No SDK upgrade, VFS change, timeout change, database generation change, server change, or API contract change.
- The Extension's hosted `/x/ext-bridge` iframe keeps its existing behavior: it never performs the navigation-time reload. A timed-out bridge instance is still retained for background completion, but it stays on REST until the bridge iframe is recreated.

## Non-goals

Hot-swapping `$powersync` inside a running document, reducing how long other operations hold the shared connection, the idle `no client is connected` retry loop, OPFS migration, SDK upgrades, first-party telemetry delivery (owned by `powersync-client-telemetry`), and any change for Safari or mobile beyond keeping their existing dedicated-first policy.
