# Implementation validation

## Scope and approval

On 2026-11-19 the human asked, in this task conversation, to fix the intermittent `PowerSyncInitializationTimeoutError ... timed out after 8000ms` REST fallback, open a new pull request, and reproduce the failure afterwards to confirm the fix. The scope recorded in `proposal.md` was chosen after the diagnosis below. The SDK (`@powersync/web` 2.4.0), VFS (`IDBBatchAtomicVFS`), timeout (8,000 ms), database generation, data version, and server are unchanged. Implementation is on `fix/recover-powersync-init-timeout`, cut from `origin/dev` at `ffd5ae00`.

## Diagnosis evidence

- Production nginx and PowerSync service logs on `powersync-sg-prod` (read only, last 24 hours): containers healthy, no 5xx, no nginx errors; non-2xx were expired-JWT 401s, client disconnect 499s, and two 408s. Sync sessions in the last 72 hours: 12,192, `operations_synced` p50 0, p99 1,260, max 14,179.
- The deployed `/_nuxt/worker-v4.js` graph on `r.slax.com` (12 JS modules and `wa-sqlite-async.zc68fxQq.wasm`) returned valid JavaScript and WASM. The earlier missing-asset incident was ruled out.
- SDK history: `@powersync/web` has been 2.4.0 since 2026-09-21, so a mixed-version SharedWorker was ruled out.
- Upstream: powersync-js #1195 and #1114 (open) report that the single web connection is held for seconds while a checkpoint is applied, and #785 (open) reports Chrome renderer crashes with OPFS VFSes, which rules out an OPFS migration as the fix.
- Mechanism reproduced with a disposable SDK-only page in Chrome 158: another tab holding the write lease for 12 s made a new tab's `init()` time out at 8,002 ms. With the last sync-connected tab closed and another tab holding the database, the shared worker logged `Could not open DB connection since no client is connected.` every 5 s (3.5 s, 8.6 s, 13.6 s, 18.7 s); a new tab still initialized in 9 ms and the errors stopped when a connected tab returned, so that log is unrelated to the timeout.

## Automated checks

- `pnpm install --frozen-lockfile` passed; no dependency or lockfile change.
- New regressions failed against the base implementation: with the source changes stashed, 5 tests failed (`uses REST after a timeout without another instance` x2, `keeps a timed-out instance open ...`, `reports a background failure ...`, and the plugin's `keeps the current document on REST until a different path is visited`). All pass after the fix.
- `pnpm exec vitest run tests/unit/local-first/`: 10 files, 127 passed, 2 skipped (final revision).
- `pnpm web -- test` (full Web suite, final revision): 258 files passed, 1 skipped; 3,172 tests passed, 3 skipped.
- `pnpm web -- typecheck`: passed with synthetic public configuration.
- ESLint on the four touched source and test files: zero errors and warnings.
- `pnpm web -- build` with `SLAX_ENV=beta` and synthetic local public configuration: passed for both the base and the final revision. The beta profile keeps console diagnostics; the production profile drops them, but the code paths are identical.
- `pnpm exec openspec validate --all --strict`: 160 passed, 0 failed (also enforced by the pre-commit hook).

## Running environment

A local server served the built `apps/web/dist` on `127.0.0.1:4310` together with synthetic endpoints for `/v1/user/me`, `/v1/sync/token`, `/sync/stream` (an empty completed checkpoint followed by keepalives), and other `/v1/*` calls. A synthetic JWT cookie represented a signed-in user. No real account, API, or PowerSync service was used. Chrome 158 (headless) ran the real Nuxt application, plugins, router, and PowerSync SDK. Tab A loaded `/bookmarks`, connected, and held `$powersync.writeLock()` for 12 s; tab B then loaded `/bookmarks`.

| Scenario | Base build | Fixed build |
| --- | --- | --- |
| B startup while A holds the lease | `recovery attempt failed ... durationMs: 8004`, `stopReason: initialization-timeout`, REST | Same timeout at 8,003-8,004 ms, REST; the diagnostic adds `visibility: visible` |
| After the lease is released | No further PowerSync activity | `background initialization completed {mode: shared, durationMs: 11554-11927}` |
| B navigates in-app to `/user?tab=profile` | Client-side navigation, `$powersync` null, no sync stream from B, no document request | `resuming local database with a document load`, document request for `/user?tab=profile`, new document `recovery attempt succeeded (13 ms)`, `connected: true`, second sync stream observed |
| Old document reaches the destination route | Yes (SPA navigation) | No: the old document's router reported the navigation as cancelled |

Regression scenarios on the final fixed build (6 of 6 passed):

- Normal startup with no timeout: local mode, connected, client-side navigation with no extra document request, no background or resume diagnostics.
- Same-path navigation (`/bookmarks?filter=starred#top`) after background completion: stays client-side on REST, no document request.
- A later path change (`/user`) after that: document load, local mode, connected.
- Staying on the page for 8 s after background completion: the same document remains (marker preserved), no document request.
- B timed out while in the background: after returning to the foreground, its next navigation resumed local mode and connected.
- After B resumed, a write in B (`local_reading_state`) was visible from tab A, confirming one shared database and no second database identity.

## Not verified

- Real production users, accounts, data volumes, and the real PowerSync service: the fix was exercised with synthetic endpoints and a forced 12 s lease, not with the production workload that holds the lease. What holds the connection for more than 8 s in production is still unconfirmed; the new `background initialization completed/failed` and `visibility` diagnostics are intended to measure it.
- Safari, iOS, and Android: their dedicated-first policy and recovery code paths are unchanged; no device run was performed.
- The hosted Extension bridge in a real Extension: covered only by the unit test that installs no guard inside the bridge. The bridge behavior is unchanged apart from not disposing a timed-out instance.
- A background initialization that never settles: covered by unit tests (no guard is installed); not forced in the browser.
- No remote deployment was performed.

## Delivery checkpoints

- UI hands-on acceptance: the change has no new visible component or layout. Its user-visible effect is that one navigation after a recovered timeout loads as a full document. Whether that counts as a UI-visible change requiring hands-on acceptance before the pull request is the human's decision; the human asked for the pull request to be opened directly.
- Version impact: no Extension, CLI, or Mobile code or shared package changes. Only `apps/web` changes. No application version changes are made.

## Local review

Bugs, Security, and Compliance passes per `REVIEW.md` on the final diff.

- Bugs (Important, fixed): the first revision returned Nuxt's `navigateTo(..., { external: true })` from a plain `router.beforeEach` guard. Outside Nuxt middleware that call resolves instead of returning `false`, so Vue Router completed the SPA transition and the old document briefly reached the destination route before unloading. The guard now starts the document load and returns `false`, matching `powersync-public-restore.client.ts`. The unit test asserts the `false` result, and the browser harness confirmed the old document's router reported the navigation as cancelled (`cancelled:/user`), while the base build reached `/user` client-side.
- Bugs (checked, no change): the retained `ready` promise never rejects, so no unhandled rejection is introduced; the guard removes itself before navigating, so a second navigation cannot trigger another load; `pending` is only produced for `PowerSyncInitializationTimeoutError`, so definite failures still dispose and follow the next-mode path; the development main-thread path never produces `pending`.
- Security: no new network calls, storage, or dependencies. The new diagnostics log the mode, attempt, duration, visibility state, and destination path only; no token, account identifier, or query string is logged.
- Compliance: the diff implements every delta scenario in `specs/web-local-sync/spec.md`, and the evidence above exercises each one. No Important findings remain.

## PR review follow-up (2026-11-19)

The automated review of `d34b1d4` on PR #678 reported no Important findings and three Nits. All three were addressed:

- A retained instance whose background initialization fails is now disposed with the same bounded cleanup (`disposeTimeoutMs`) as definite failures. Its `init()` has settled, so closing no longer races with completion, and the SharedWorker client is released before the document unloads. Regressions: the background-failure test asserts the adapter close, and a new test confirms that a never-settling dispose still resolves `ready` to `false` after the bound.
- The resume guard now awaits the external `navigateTo`. If the document load throws, the guard stays installed and lets that navigation continue client-side on REST, so a later navigation can still resume; there is no unhandled rejection. Destinations that do not start with a single `/` are ignored, matching `powersync-public-restore.client.ts`. Regressions: a failed load followed by a successful one, and a `//evil.example/x` destination that triggers nothing.
- `design.md` now describes `pending` as `{ mode, ready }` and documents the bounded disposal and guard failure handling.

Re-verification on the final revision: `pnpm web -- typecheck` passed; the full Web suite passed (3,172 tests); ESLint on the touched files was clean; the production-profile beta build passed. The browser reproduction passed again: B timed out, completed in the background at 11,922 ms, its next navigation loaded `/user` as a new document that reported `connected: true` with a second sync stream, and the old document's navigation was cancelled. The 6 regression scenarios passed again (6/6).

## Second review follow-up (2026-11-19)

The automated review of `afffdd4` reported no Important Bugs or Security findings, one Important Compliance finding, and three Nits.

- Nits addressed: a throwing diagnostics listener can no longer reject `ready` (a regression test shows `ready` still resolves `true`). The resume guard reuses the existing `topLevel` constant. The MODIFIED requirement now states that the retained instance is not closed while its initialization is pending and is disposed with bounded cleanup if it later fails, matching `design.md` and the code.
- Re-verification on the final revision: 128 local-first unit tests passed (2 skipped), typecheck and ESLint were clean, the beta production build passed, the browser reproduction passed (`resumedLocal=true connected=true`, old document navigation cancelled), and the 6 regression scenarios passed.
- Important Compliance finding (open): the review classifies the one-time full document load after a recovered timeout as a user-perceivable interaction change, which needs human hands-on acceptance recorded before merge (`DESIGN.md` §10.2). It has not been performed. It needs either the human's hands-on acceptance or the human reviewer's decision that the change is not UI-visible, recorded here and in the pull request Test plan.

## Human hands-on acceptance (2026-11-20)

The change requester performed hands-on acceptance on 2026-11-20 at about 17:59 CST, in the local acceptance environment (`http://127.0.0.1:4320/__accept`) running a production build of `feat/optimize-bookmark` at `5c4a3664` (SDK 2.7.0, `worker-v5.js`, synthetic data). The panel covered normal owner reading and writes, a slow local database with an in-place switch, local data behind REST, initialization-timeout recovery through the next navigation, visitor and anonymous views, and multi-tab startup. The requester reported no problems and requested no adjustments. Earlier pending-acceptance notes in this file are resolved by this entry.

Before acceptance, the environment's page renderer had stopped answering because its temporary build directory had been deleted while it ran; it was restarted, and the pages were re-checked in Chrome (owner `/b/` interactive in 0.64 s, `/bookmarks` in 1.08 s, no page errors) and by the 13-scenario self-check (13/13). This was an environment issue, not a product change.
