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

Run on the final diff with Node `v22.23.1`.

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

## Cleanup

The PowerSync test container, its replication slot and storage database, the local stub, proxy, and Pages server were removed. The existing `dev-powersync` service and its replication slot were unchanged.
