# Validation

## Scope

- Change: `frontend-error-logs`.
- Task branch: `feat/frontend-error-logs`, based on `origin/dev` commit `ffd5ae005b93d966d4ef5123650c626c7f4910b7`.
- Worktree: `.local/worktrees/frontend-error-logs` (repository-relative).
- The change requester asked in conversation to implement and open the pull request directly; this record serves as the proposal's review artifact alongside the pull request.
- The change is not UI-visible. It adds background telemetry with no rendered surface, so `DESIGN.md` hands-on UI acceptance does not apply.
- No package version was changed. The Extension version decision is pending with the change requester per `docs/release/VERSIONING.md`.
- No secret files were read. Builds and tests used the synthetic public values from `docs/web/development.md`.

## Cloudflare resources

Created before implementation. Existing lake buckets, streams, sinks, and pipelines in both accounts were not modified.

| Environment | Account | Bucket / table | Stream endpoint | CORS origins |
| --- | --- | --- | --- | --- |
| Test (`development`, `preview`) | test account `52bb…` | `slax-reader-client-errors-dev` / `client_errors.errors` | `https://b074a7024a724161aa7fef982e585f88.ingest.cloudflare.com` | `https://r.slax.dev`, `http://localhost:3000`, `http://localhost:3100` |
| Production (`production`, `beta`) | production account `f746…` | `slax-reader-client-errors` / `client_errors.errors` | `https://b4923d0c3dcf453ea945e37d23a3d1cd.ingest.cloudflare.com` | `https://r.slax.com`, `https://r-beta.slax.com` |

Both pipelines run the same admission SQL, differing only in allowed `env` values, page origins, and extension IDs. Both buckets have Basin Catalog compaction enabled. `http://localhost:3100` was added to the test stream only, for this verification; see Gaps.

## Automated checks

Run on the final diff with Node `v22.23.1`.

| Command | Result |
| --- | --- |
| `pnpm web -- test` | 259 files passed, 1 skipped; 3170 tests passed, 3 skipped; exit 0 |
| `pnpm extension -- test` | 29 files, 145 tests passed; exit 0 |
| `pnpm --filter @apps/slax-reader-dweb typecheck` | exit 0 |
| `pnpm --filter @apps/slax-reader-extensions compile` | exit 0 |
| `pnpm --filter @slax-reader/contracts typecheck` | exit 0 |
| `eslint` on every changed or added Web file | exit 0 |
| `openspec validate --all --strict` | 160 passed, 0 failed |
| Extension production build (`SLAX_ENV=production wxt build`) | Production endpoint present in `background.js`, `offscreen.html`, and `pdf-save.html`; test endpoint absent |

`eslint .` across all of `apps/web` reports 88 errors on the untouched `origin/dev` baseline and the same 88 with this change; none are in changed files. CI does not run Web lint.

New tests cover collector grouping, byte limits, the 200-fingerprint session cap, batching and hidden-page flush, a disabled collector, swallowed delivery failures, error normalization, non-counting observers, Web script-versus-image capture, Vue hooks with identity, PowerSync logger and status capture, SDK double-log suppression, Extension context and identity, and Extension Vue handler preservation. Existing PowerSync specs gained a `registerListener` mock and a `logger` expectation.

## Running environment

A production-mode Web build (`import.meta.dev` false, so real SharedWorker and Dedicated Worker paths) was served by `wrangler pages dev` at `http://localhost:3100` with `CLIENT_ERROR_INGEST_URL` set to the test stream. Port 3000 was occupied by an unrelated local server. A real `journeyapps/powersync-service` container on the local dev Postgres used a temporary signing key and its own storage database. A local stub served only `/v1/sync/token` and `/v1/sync/changes` and injected faults; a proxy in front of PowerSync injected sync-stream 503s. The session was the local dev user `100000000`. Chrome 158 drove the page.

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

- The Extension was not run against the stream in a loaded browser build. Its production build embeds the endpoint in all three entry points, unit tests cover context and identity, and a minimal MV3 extension confirmed that popup and service-worker `fetch` reach the stream without CORS restriction.
- The cause of a PowerSync Worker bootstrap crash is not captured; the SDK passes only its fixed message to the logger. Recovering it needs an application-owned worker factory.
- Vue `useQuery` SQL errors and the Extension bridge iframe were not exercised.
- The test stream's CORS list still includes `http://localhost:3100`, added for this run. It affects only the test stream.
- Rows written by this verification remain in the test table with messages starting `e2e-`, `e2e2-`, or `gate:`; pre-implementation probes left rows starting `case:` in the production table.
- The read-only query token created for this run expires on 2026-11-20.

## Local pre-push review

`REVIEW.md` Bugs, Security, and Compliance passes over the full diff, change-id `frontend-error-logs`:

- Bugs (Important, fixed): Nuxt pages raise 4xx errors on purpose (`dashboard` middleware, `/b/[id]`, `/c/[id]`), which would have been recorded as faults through `vue:error` and `app:error`. 4xx Nuxt errors are now skipped and 5xx ones carry `status_code`; covered by a plugin test.
- Security (Important, fixed): SDK and fetch errors embed request URLs in their message and stack, and application URLs can carry tokens in query strings. Query strings and fragments are now removed from every URL inside messages and stacks; covered by a collector test. Application-thrown messages were checked and carry status codes and icon keys only. No credentials, endpoints with secrets, or user content are added to records; the ingestion endpoints are public by design and documented as such.
- Compliance: the implementation matches the proposal, design, and delta spec, which were updated for both fixes. Extension Vue capture is installed for the `pdf-save` page; content-script Vue apps run on third-party pages and are excluded by the design. No Important findings remain.

The automated checks above were re-run after these fixes.

## Cleanup

The PowerSync test container, its replication slot and storage database, the local stub, proxy, and Pages server were removed. The existing `dev-powersync` service and its replication slot were unchanged.
