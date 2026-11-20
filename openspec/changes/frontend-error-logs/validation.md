# Validation

## Scope

- Change: `frontend-error-logs`.
- Task branch: `feat/frontend-error-logs`, based on `origin/dev` commit `ffd5ae005b93d966d4ef5123650c626c7f4910b7`.
- Worktree: `.local/worktrees/frontend-error-logs` (repository-relative).
- The change requester asked in conversation to implement and open the pull request directly; this record serves as the proposal's review artifact alongside the pull request.
- The change is not UI-visible. It adds background telemetry with no rendered surface, so `DESIGN.md` hands-on UI acceptance does not apply.
- No package version was changed. The final diff has no Extension change, so no Extension version increment applies; Web does not use package-version increments (`docs/release/VERSIONING.md`).
- No secret files were read. Builds and tests used the synthetic public values from `docs/web/development.md`.

## Cloudflare resources

Created before implementation. Existing lake buckets, streams, sinks, and pipelines in both accounts were not modified.

| Environment | Account | Bucket / table | Stream endpoint | CORS origins |
| --- | --- | --- | --- | --- |
| Test (`development`, `preview`) | test account `52bb…` | `slax-reader-client-errors-dev` / `client_errors.errors` | `https://b074a7024a724161aa7fef982e585f88.ingest.cloudflare.com` | `https://r.slax.dev` (the `localhost` origins used for verification were removed afterwards) |
| Production (`production`, `beta`) | production account `f746…` | `slax-reader-client-errors` / `client_errors.errors` | `https://b4923d0c3dcf453ea945e37d23a3d1cd.ingest.cloudflare.com` | `https://r.slax.com`, `https://r-beta.slax.com` |

Both pipelines run the same admission SQL, differing only in allowed `env` values and page origins, and admit only `app=web`. Both buckets have Basin Catalog compaction enabled. `http://localhost:3100` was added to the test stream only, for this verification, and removed with `http://localhost:3000` after it.

## Automated checks

First run, on the diff before the review rounds below, with Node `v22.23.1`. Each later section records its own re-run; the latest Web count is 3193 passed.

| Command | Result |
| --- | --- |
| `pnpm web -- test` | 260 files passed, 1 skipped; 3189 tests passed, 3 skipped; exit 0 |
| `pnpm extension -- test` | 27 files, 127 tests passed; exit 0 (no Extension change; regression only) |
| `pnpm --filter @apps/slax-reader-dweb typecheck` | exit 0 |
| `pnpm --filter @apps/slax-reader-extensions compile` | exit 0 |
| `pnpm --filter @slax-reader/contracts typecheck` | exit 0 |
| `eslint` on every changed or added Web file | exit 0 |
| `openspec validate --all --strict` | 160 passed, 0 failed |
| `git diff origin/dev -- apps/extension` | empty |

`eslint .` across all of `apps/web` reports 88 errors on the untouched `origin/dev` baseline and the same 88 with this change; none are in changed files. CI does not run Web lint.

New tests cover collector grouping, byte limits, the 200-fingerprint session cap, batching and hidden-page flush with reused identity, a disabled collector, swallowed delivery failures, error normalization, URL query stripping, non-counting observers, Web script-versus-image capture, Vue hooks with identity and single counting across both Nuxt hooks, 4xx skipping, and PowerSync logger and status capture with SDK double-log suppression. Existing PowerSync specs gained a `registerListener` mock and a `logger` expectation.

## Running environment

A production-mode Web build (`import.meta.dev` false, so real SharedWorker and Dedicated Worker paths) was built with `CLIENT_ERROR_INGEST_URL` set to the test stream in the build environment and served by `wrangler pages dev` at `http://localhost:3100`. Port 3000 was occupied by an unrelated local server. A real `journeyapps/powersync-service` container on the local dev Postgres used a temporary signing key and its own storage database. A local stub served only `/v1/sync/token` and `/v1/sync/changes` and injected faults; a proxy in front of PowerSync injected sync-stream 503s. The session was the local dev user `100000000`. Chrome 158 drove the page.

| Scenario (spec) | Observed |
| --- | --- |
| Healthy startup | SharedWorker mode initialized, synced real bookmarks into the list; no record created |
| Uncaught `TypeError` | `kind=error`, name, message, stack, line and column delivered |
| Unhandled rejection | `kind=unhandledrejection` delivered |
| Failed `<script>` | `kind=resource`, script URL without query delivered |
| Failed `<img>` in the same page | No record |
| Vue render error in a live component | `kind=vue` via Nuxt `vue:error`; page kept rendering |
| Upload rejected (500) | 4 real rejections → 3 batches with counts 1 + 2 + 1 = 4, sources `connector.upload` and `status.uploadError`; after recovery the change uploaded and `ps_crud` emptied |
| Sync stream 503 | 4 real 503 responses → 3 batches with counts 2 + 1 + 1 = 4, `worker_mode=shared`, server code `PSYNC_S2001` and worker stack preserved |
| Identity | `user_id=100000000`, cookie `device_id`, per-page `session_id`, `page_url` origin and path only |
| Delivery | `text/plain` POSTs with no preflight; endpoint returned `committed` for each batch |

Every delivered record above was queried back from `client_errors.errors` in the test catalog with `wrangler basin sql`.

Two counting defects found during this run were fixed and re-verified with the counts above: the status listener had re-counted failures already counted by the connector or SDK logger, and the SDK logs one sync failure twice ("Could not POST streaming…" then "Sync error").

### Admission filter

One valid record and twelve invalid records were posted to the test stream in one batch; the endpoint accepted all 13 and only the valid record reached the table. Rejected cases: `env=production`, `kind=console`, `app=mobile`, release `latest`, a foreign origin, the production origin `r.slax.com`, a URL with a query, `user_id=admin`, a malformed `session_id`, `count=0`, a 30-day-old timestamp, and a missing `session_id`. A pre-implementation run against both environments covered the same rules plus extension-ID allowlists and the production/test isolation in both directions.

## Gaps
- The PowerSync connector reads its token through `getUserToken()` on each credential fetch, which registers a `useCookies()` change listener outside any Vue scope; while credentials keep failing, listeners accumulate about one per retry. This predates this change (`dev` has the same path) and is left for a separate fix.

- Extension reporting is out of scope by request. The Extension's PowerSync bridge is the Web `/x/ext-bridge` page, which reports as `app=web`; that page was not exercised inside the offscreen iframe.
- The cause of a PowerSync Worker bootstrap crash is not captured; the SDK passes only its fixed message to the logger. Recovering it needs an application-owned worker factory.
- Vue `useQuery` SQL errors were not exercised.
- Rows written by this verification remain in the test table with messages starting `e2e-`, `e2e2-`, or `gate:`; pre-implementation probes left rows starting `case:` in the production table.
- The read-only query token created for this run expires on 2026-11-20.

## Local pre-push review

`REVIEW.md` Bugs, Security, and Compliance passes over the full diff, change-id `frontend-error-logs`:

- Bugs (Important, fixed): Nuxt pages raise 4xx errors on purpose (`dashboard` middleware, `/b/[id]`, `/c/[id]`), which would have been recorded as faults through `vue:error` and `app:error`. 4xx Nuxt errors are now skipped and 5xx ones carry `status_code`; covered by a plugin test.
- Security (Important, fixed): SDK and fetch errors embed request URLs in their message and stack, and application URLs can carry tokens in query strings. Query strings and fragments are now removed from every URL inside messages and stacks; covered by a collector test. Application-thrown messages were checked and carry status codes and icon keys only. No credentials, endpoints with secrets, or user content are added to records; the ingestion endpoints are public by design and documented as such.
- Compliance: the implementation matches the proposal, design, and delta spec, which were updated for both fixes. No Important findings remain.

The automated checks above were re-run after these fixes.

## Pull request review follow-up

The automated PR review reported no Important findings and five Nits, all fixed with tests:

- `app:error` with a nullish error no longer throws while reading `statusCode`.
- A fatal component error that Nuxt reports through both `vue:error` and `app:error` (wrapped with `cause`) is recorded once.
- The SDK duplicate-suppression key uses normalized name and message, so distinct non-`Error` payloads stay distinct.
- Query stripping also covers root-relative URLs such as `/v1/sync/changes?token=…`, and keeps stack `line:column` positions.
- Page-hide batches reuse the identity resolved by the previous flush.

## Review round on 12317c4

The automated review reported one Important finding, fixed:

- Important: the URL query pattern used RegExp lookbehind, which Safari and iOS before 16.4 cannot parse, while `apps/web/package.json` declares Safari 15.4. The collector chunk would have failed to parse there and stopped the app from booting. The pattern no longer uses lookbehind and passes the same 12 cases. A production `pnpm web -- build` was inspected: the chunk containing the collector has no lookbehind.

Nits fixed with tests: a message line containing an address is no longer taken as a call frame; batches are split into request bodies below 60 KiB; HTTP status codes stay distinct in fingerprints (401 versus 500).

## First frame only, original PowerSync console output

At the change requester's request:

- A record's `stack` holds only the first call frame (at most 512 bytes), and the SDK log text is no longer copied into `properties`. A 503 sync failure is now recorded as `stack: "at WebRemote.fetchStreamRaw (https://r.slax.com/_nuxt/worker-v4.js:3239:35)"` with the error message. The frame finder no longer mistakes a message line containing `@` for a frame; V8 and Firefox formats are tested.
- The PowerSync logger hands every record to the SDK's own `createConsoleLogger()`, so console output matches `dev` exactly (`[PowerSync]:` prefix, info/warn/error, debug below the SDK default level). A test asserts every level, debug included, reaches that logger unchanged.

Re-run afterwards: `pnpm web -- test` 3188 passed, 3 skipped; Web `typecheck` passes; changed-file lint passes; `pnpm extension -- test` 127 passed. One run hit an unrelated flake in `useSlaxRoutes.spec.ts`, which passed 3 of 3 reruns and in the next full run.

## Extension reporting removed

The change requester decided that the Extension does not report errors. The Extension code is restored to `origin/dev`, the collector accepts only `app=web`, and both pipelines were recreated with `WHERE app = 'web'` and Web-only origins. Verified on both streams by sending one Web record and three Extension-shaped records (`app=extension`, a `chrome-extension://` page URL, and both): each table stored only the Web record. The collector tests moved to `apps/web/tests/unit/utils/errorLog.spec.ts`.

## Pull request CI follow-up

The first push failed `pnpm test:extension-tooling` with "Extension profile ID mismatch". Release tests read signing keys from `apps/extension/wxt.config.ts` with the pattern `^  (preview|beta|production): '…'`, and the new per-profile endpoint map used the same line shape, so the endpoint URLs replaced the keys. The map now uses a single-line form outside that pattern. Locally afterwards: `pnpm test:extension-tooling`, `pnpm test:preflight`, `pnpm test:ci`, and `pnpm test:cli-tooling` exit 0; Extension `compile` passes and 145 Extension tests pass.

## Re-run on 402c1f61 (Chrome, Safari 27.2, iOS 27.1 simulator)

The running-environment scenarios were repeated on `402c1f61` with the same production-mode build, PowerSync container, stub, and test stream, in three browsers, one at a time: Chrome 158 (run `chrome4`), macOS Safari 27.2 (`safari6`), and Mobile Safari on an iOS 27.1 simulator (`ios2`). An injected page probe waited for the first sync, raised the four front-end errors plus a failed `<img>`, rejected uploads with 500 for 12 seconds, then answered the sync stream with 503 for 16 seconds. Each run's records were selected by the `session_id` of its page load and queried back from `client_errors.errors`.

| Check | Chrome | Safari 27.2 | iOS 27.1 |
| --- | --- | --- | --- |
| Startup mode | SharedWorker, multi-tab | SharedWorker, multi-tab | Dedicated Worker (multi-tab unsupported) |
| `error`, `unhandledrejection`, `resource` (script), `vue` | 1 row each | 1 row each | 1 row each |
| Failed `<img>` | no row | no row | no row |
| Upload 500: stub rejections / summed `count` | 3 / 3 | 3 / 3 | 3 / 3 |
| Sync 503: stub responses / summed `count` | 3 / 3 | 3 / 3 | 3 / 3 |
| Recovery | `ps_crud` empty, reconnected | `ps_crud` empty, reconnected | `ps_crud` empty, reconnected |
| `stack` | one frame, V8 `at …` | one frame, `fn@url:line:col` | one frame, `fn@url:line:col` |

Across the 29 rows, no `stack` contains a newline, the longest is 78 bytes, no `message` keeps a query string, every row has `user_id=100000000` and `env=development`, and sync rows carry `worker_mode`. Each run also had one `kind=powersync` `TypeError` row for the live stream the stub dropped when the 503 window opened (`network error` in Chrome, `Load failed` in Safari).

Console output was captured in each browser and matches `dev`: `[powersync] …` application lines, SDK lines with the `[PowerSync]:` prefix at info, warn and error (for example `[PowerSync]: calling the last port client provider for credentials`), and `[powersync] uploadData failed: …` as on `dev`. On iOS the SDK additionally warned that multiple tabs are not enabled, which is SDK behavior.

A static check parsed all 273 chunks in `apps/web/dist/_nuxt` as ES2022 and found no RegExp lookbehind or `v` flag, so the bundle stays parseable on the declared Safari 15.4; a sample file containing lookbehind was detected as a control.

Gaps for this re-run:

- Safari and iOS older than 27 were not run. The iOS 15.4 through 16.2 simulator runtimes require Xcode 26.99 or earlier and macOS 26.99 or earlier, and this host runs macOS 27.2 with Xcode 27.1; `xcodebuild -downloadPlatform iOS -buildVersion 16.0` reports the runtime as not available. Only the static syntax check covers them.
- Earlier Safari attempts were discarded as environment failures: another local session's `pkill -f "cli.js pages dev"` stopped the Pages server mid-run, and a still-open iOS simulator tab held the PowerSync database and delayed the first sync. `safari6` ran after both were removed.
- Rows from these runs remain in the test table. A new read-only query token for this re-run expires on 2026-11-21.

## Final review Nits

- Oversized `properties` could exceed 8 KiB after truncation, because JSON escaping (quotes, backslashes, control characters) grows the cut text. The size is now checked on the final serialized form. A test covers five inputs and fails against the previous code.
- The next review round noted that the overflow fallback replaced the whole object with one truncated string, losing its keys and `sources`. The largest values are now shortened instead, the record is marked `truncated: true`, and 1 KiB is kept for sources merged into a queued record later; tests cover both.
- A test now covers the connector's upload `onError`: the failure is recorded with source `connector.upload` and counted, and the console line `[powersync] uploadData failed:` is unchanged.

Afterwards, and again after the follow-up: `pnpm web -- test` 3191 passed, 3 skipped, and 1 failure in `useSlaxRoutes.spec.ts` (a 10-second timeout seen before), which passed 3 of 3 reruns; Web `typecheck` passes; lint on the changed Web test files passes.

The test stream's CORS list now holds only `https://r.slax.dev`: the dashboard shows that single origin, and a preflight from `http://localhost:3000` or `http://localhost:3100` returns no `Access-Control-Allow-Origin`, while one from `https://r.slax.dev` does.

## Security review on b23bedef

The automated review raised two Important Security findings, both reproduced before fixing:

- Queries survived in Safari and Firefox frames (`fetchStreamRaw@https://r.slax.com/_nuxt/a.js?v=1:12:3`), in bracketed or braced URLs, after `:` or `-`, and in protocol-relative URLs, because an absolute URL had to follow one of a few lead characters. Absolute URLs now match wherever they start; protocol-relative and root-relative paths still need a delimiter before them, so prose such as `and/or? maybe` is unchanged. Ten new cases pass alongside the existing ones, a Safari-format stack yields `fetchStreamRaw@https://r.slax.com/_nuxt/w.js:12:3`, the pattern still has no lookbehind or `v` flag, and 20,000-character adversarial inputs finish in under 1 ms.
- `page_url` kept share codes (`/s/<code>`) and collection codes (`/c/<code>/<id>`), which grant read access to their content. The path is now recorded as `/s/:code`, `/c/:code`, or `/c/:code/:id`; other paths are unchanged. The production pipeline's `page_url` check (`^(https://(r\.slax\.com|r-beta\.slax\.com))(/[^?#]*)?$`, read back with `wrangler pipelines get`) admits these paths.

The review's Compliance Nits were also addressed: `design.md` now names the connector's upload `onError` as a counting source and the `installGlobalErrorCapture` helper, and the spec states the path redaction with a scenario. Related tests: 149 passed, 2 skipped. `pnpm web -- test`: 3193 passed, 3 skipped, and the known `useSlaxRoutes.spec.ts` timeout, which passed 3 of 3 reruns; Web `typecheck`, lint on the changed test file, and `openspec validate --all --strict` pass.

## Compact stack instead of one frame

Querying the test table after the re-run showed that one frame was too little: 1535 of 1633 rows were Safari `TypeError: Load failed` records, with no frame at all, from the `safari6` page left open for ten hours (sync retries and an uncaught rejection about every 40 seconds), so nothing said which code path failed. At the change requester's direction the record now keeps a compact stack rather than the first frame only: up to five application frames, each shortened to `function (file:line:col)`, with browser, extension, and Vue wrapper frames and recursion repeats removed, bounded at 1 KiB. The fingerprint still uses the first frame. Tests cover V8 and Safari stacks, anonymous callbacks with a file location (kept) next to built-ins located at `<anonymous>` (dropped), noise-only stacks, and the size bounds. Real V8 stacks were also run through the collector: an async upload failure records `uploadChanges (…)` then `async uploadData (…)`, and 30-deep recursion records two frames; the related suites pass (150 tests, 2 skipped). `pnpm web -- test`: 3194 passed, 3 skipped, and the known `useSlaxRoutes.spec.ts` timeout, which passed 3 of 3 reruns; Web `typecheck`, lint, and `openspec validate --all --strict` pass.

## Fuller compact stack and counting across flushes

At the change requester's direction, diagnosis takes priority over brevity: the compact stack now keeps every frame within 4 KiB instead of five, without dropping built-in, extension, or Vue frames, and collapses recursion into `×N`. The requester also noticed that `count` was ineffective, which the test table confirmed: for the `safari6` page, the `unhandledrejection` fingerprint `8a7804acdcb3850c` had 1084 rows, 919 with `count=1` and 165 with `count=2`, because counts accumulated only within one 5-second flush while the error recurred every 40 seconds. Repeats now accumulate across flushes with a backoff from one minute doubling to one hour, and each record carries `session_count`.

A simulation of that page (one rejection every 40 seconds for 10 hours) now delivers 16 records whose counts add up to 900, the last with `session_count=900`; 50 occurrences within one second deliver one record with `count=50`; a new error is still delivered within 5 seconds while a repeat is held. A timer defect found by the new tests was fixed: a held repeat's long timer had delayed a new error until the repeat was due. Unit tests cover these cases, the 4 KiB cut with its dropped-frame line, V8 and Safari stacks, and hidden-page delivery of held repeats.

A production-mode build with the test endpoint was then served at `http://localhost:3103` and driven in Chrome 158; the records were queried back from `client_errors.errors` by the page's `session_id`. One uncaught error from 12-deep recursion stored a 413-byte stack of two lines (`recurse (…:12:44)` and `recurse (…:12:81) ×9`). Eleven unhandled `Failed to fetch` rejections from one call path stored two rows instead of eleven: `count=4` (`session_count=4`), then `count=7` (`session_count=11`) one minute later, each with `last_occurred_at` and a six-frame stack of about 1.2 KiB naming `loadBookmarks` and `refreshList`. `pnpm web -- test`: 3198 passed, 3 skipped, and the known `useSlaxRoutes.spec.ts` timeout, which passed 3 of 3 reruns; Web `typecheck`, lint, and `openspec validate --all --strict` pass.

## Review Nits on 4a032fc0

The automated review found no Important issue. Its four Nits are fixed:

- One occurrence could be counted twice when a flush fell between its non-counting observer (status listener) and its counting capture (SDK logger), because the claim state was cleared with the queued record. That state is now kept apart from the queue; a test fails against the previous code.
- `page_url` had no byte cap, so a very long path could make one record exceed the 60 KiB request body. It is now capped at 2 KiB.
- In messages, `:digits` after a query was reattached to the URL as if it were a stack position; the position is now kept only in stacks.
- `design.md` described `fetch` as primary and `sendBeacon` as the hiding fallback; it now matches the code.

`pnpm web -- test`: 3200 passed, 3 skipped, and the known `useSlaxRoutes.spec.ts` timeout, which passed on rerun; Web `typecheck`, lint, and `openspec validate --all --strict` pass.

## Capture cannot affect the app

Asked to guarantee that error capture never breaks the app, a review of every entry point found gaps: the PowerSync logger normalized the error and created the collector outside any guard, the status listener and plugin setup were unguarded, and a page-hide flush could reject. The SDK source (`AbstractStreamingSyncImplementation.ts`, `@powersync/shared-internals` 1.3.0) calls the logger from its sync retry loop without a `try`, so a throw there could skip setting `downloadError` or end the loop. All entry points are now guarded. Tests make the collector throw on every capture and fail at creation: the app plugin still installs and starts, PowerSync still initializes, the SDK logger still prints and does not throw, the status listener and connector `onError` do not throw, `[powersync] uploadData failed:` is still logged, and no page error or unhandled rejection is raised, including when delivery fails on page hide. Against the previous plugins, four of these tests fail.

`pnpm web -- test`: 3205 passed, 3 skipped, and the known `useSlaxRoutes.spec.ts` timeout; Web `typecheck` and lint on the changed files pass.

A production-mode build served at `http://localhost:3103` was then driven in Chrome 158 with the ingestion endpoint unreachable (`fetch` rejected, `sendBeacon` refused) and serialization of collector payloads forced to throw. An application error and rejection raised during that window reached the page's own listeners exactly as usual, no further page error or unhandled rejection appeared through capture, flush, or page hide, and the app then navigated to `/guide` and rendered it.

## External review on e310fb6d

An external review of `e310fb6d` reported six boundaries. Each was reproduced or confirmed in source before fixing, and each has a test that fails against `e310fb6d`:

- Cookie listeners leaked (P1). `getUserToken()` and `getDeviceId()` call `useCookies()`, which creates a `universal-cookie` instance and registers a change listener (`cookieStore` `change`, or a 300 ms `setInterval` without it) released only with a Vue scope (`@vueuse/integrations` 14.4.0, `universal-cookie` 8.1.2). The collector called them on every flush outside any scope. It now reads both cookies from `document.cookie` and registers nothing; the shared helpers are unchanged. The test fails if the collector touches either helper, `cookieStore.addEventListener`, or `setInterval` over five flushes.
- Share and collection codes survived outside `page_url` (P1). Messages, stacks, and `properties` strings such as `filename` and `src` now pass the same redaction; the test serializes the whole record and asserts neither code appears, while `/usr/s/x` and `/bookmarks/s/x` stay.
- One PowerSync failure was counted several times (P2). The SDK sources (`@powersync/web` 2.4.0 `BroadcastLogger` and `SharedSyncImplementation`) show the shared worker broadcasts each log record and each status to every tab. In the same tab, the status listener's non-counting capture and the SDK logger's capture could fall on two sides of a flush and count twice. Each failure now has one counting source (the SDK logger for sync-stream failures, the connector for uploads); the status is not captured; and in shared mode only the tab holding a Web Lock records worker log records. The provisional-claim mechanism is gone. The duplicate window is now measured from the first log, so a failure repeating faster than once a second is counted once per second rather than once in total.
- A delayed record could be attributed to another account (P2). Identity is now read at capture and is part of the grouping key, so the same error under two accounts is two records, each with its own `session_count`.
- Repeats recompacted the full stack (P2). The compact stack is now built only for a new record.
- JSON escaping could push one record past 60 KiB. A record that does not fit has its message shortened and `properties.message_truncated` set; a 16 KiB control-character message now serializes to 55,428 bytes instead of about 98,558.

Related suites: 166 passed, 2 skipped. `pnpm web -- test`: 3210 passed, 3 skipped, and the known `useSlaxRoutes.spec.ts` timeout; Web `typecheck` passes.

A production-mode build at `http://localhost:3103` was then driven in Chrome 158 (with `cookieStore`):

- Five failing delivery batches carrying a share URL in the message, stack, and `filename` produced six records with no occurrence of either code, `user_id=100000000` from the cookie, and no 300 ms interval. The collector registered no `cookieStore` change listener. Listeners still grew about one per retry while idle, all from `fetchCredentials → refreshPowerSyncUserToken → getUserToken → useCookies`: the PowerSync connector's credential path, unchanged from `dev` and outside this change, which grows only while credentials keep failing. It is listed under Gaps.
- Three tabs shared one PowerSync worker whose sync failed on every retry (no local sync service). One tab held `slax-ps-worker-log-reporter` with two waiting; every tab printed `[PowerSync]: Sync error Failed to fetch`, but only the holder recorded it (one record, `count=36`, `worker_mode=shared`), and the other two recorded none. After the holder closed, the next tab took the lock and recorded the failure (`count=2`), and the third kept waiting.

## Cleanup

The PowerSync test container, its replication slot and storage database, the local stub, proxy, and Pages server were removed. The existing `dev-powersync` service and its replication slot were unchanged.
