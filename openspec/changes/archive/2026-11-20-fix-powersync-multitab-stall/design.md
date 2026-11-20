# Design

## Context

Production desktop tabs that pass the worker policy open the database with `enableMultiTabs`. The SDK hosts one SQLite connection (IndexedDB VFS) in a SharedWorker and serializes every read and write lease from every tab on it; a lease spans several page-to-worker round trips. Live queries (`useQuery`, `watch`, `onChange`) first call `resolveTables`, which runs `EXPLAIN <sql>` and a `sqlite_master` read, then register through `onChangeWithCallback` for their initial run and later re-runs.

Chrome deprioritizes hidden renderers. Measurements used real Chrome 158 started without automation flags and driven over CDP, because Playwright's default switches keep background tabs visible and unthrottled.

- Bare SDK pages: 8 idle hidden tabs did not delay a new tab on 2.4.0 or 2.7.0 (11–27 ms).
- Running Web app on `dev`, 8 hidden `/bookmarks` tabs: hidden tabs' `resolveTables` reads held the connection 32–88 s; a new tab timed out at 8 s and used REST. With 3 tabs a new tab started in 0.4 s.
- With background synchronization changing one bookmark per second and 3,000 bookmarks, `dev` started 9 new tabs in 0.8–5.3 s with one 8.3 s REST fallback.

A first gate that only held change re-runs did not help, and one that also held initial runs still timed out, because table resolution happens before registration. With table resolution held, a remaining timeout came from a hidden tab briefly shown when an adjacent tab closed: the gate released its backlog, the tab was hidden again, and the released reads held the connection 9–13 s.

Not reproduced as a cause: CDP-frozen tabs (the freeze did not suspend timers), tabs closed or crashed inside a write transaction, a syncing tab closed during a 60,000-row apply, and a zombie sync loop. A large initial synchronization in another tab delays a new tab (5–13 s at 200,000 rows) on both SDK versions; that is a bounded transaction already covered by timeout recovery and is unchanged here.

## Goals / Non-Goals

**Goals:** Stop hidden tabs from occupying the shared connection with live-query work; upgrade the Web SDK to 2.7.0 safely.

**Non-Goals:** Changing the VFS, database generation, timeouts, recovery order, or initial-sync batching. OPFS options still route through the SharedWorker in 2.7.0, `OPFSWriteAheadVFS` and `OPFSCoopSyncVFS` also timed out under the bare-SDK load test, and an open upstream issue reports OPFS renderer crashes.

## Decisions

### Gate live-query entry points on settled visibility

After a successful local start, outside the extension bridge frame, the plugin wraps the database's `resolveTables` and `onChangeWithCallback` once. While `document.visibilityState` is hidden, both await a shared promise. A `visibilitychange` to visible starts a 500 ms timer that resolves it; hiding again before it fires cancels the timer. The SDK's `ControlledExecutor` coalesces change notifications that arrive while one is pending, so each query re-runs once on release. Every Vue composable, `watch`, and `onChange` path in the SDK uses these two methods, so no SDK patch or per-composable change is needed. Writes, uploads, and synchronization are untouched.

Alternatives considered:
- Larger `throttleMs` reduced but did not remove the backlog and varied between runs (1.2–15.6 s).
- Pausing or closing the database in hidden tabs would also stop synchronization and uploads in the tab that owns the sync stream.
- Gating only re-runs, or re-runs plus initial runs, left table resolution ungated and did not fix the running app.

Visibility, not focus, is the trigger: a visible but unfocused window keeps updating.

### Increment the Worker generation

2.7.0 replaced the worker's `addLockBasedCloseSignal` with `initialize(name, capabilities)`. With an unchanged URL and name, a 2.7.0 page would attach to a live 2.4.0 SharedWorker. `v5` gives the new SDK its own worker; the database name stays `slax-reader-v3.db`. Concurrent v4 and v5 workers sharing that database read and wrote correctly. Retained-asset tooling roots history at the asset index and keeps its `worker-v4.js` fallback for pre-index deployments.

### Verification

Unit tests drive the gate with a fake document and database, including the brief-visibility case. Plugin specs assert it is installed for pages and not for the bridge frame. Production builds of this branch and of `dev` run side by side in local acceptance environments with synthetic data and are compared in real Chrome.
