# Validation

## Operator infrastructure (2026-11-25)

Each environment now has one client stream and one pipeline (production `client_errors_pipeline` `34bc8449…` on stream `b4923d0c…`; test `cf97f1e7…` on stream `b074a702…`). The Mobile streams and pipelines are deleted. SQL and history: `slax-reader-monitor/docs/pipeline-backup/`.

- Root cause of the earlier "silent stops", confirmed on production pipeline `261c4b77` (created 2026-11-24 08:51:15 UTC): a probe with `occurred_at` 08:50 the next day was stored, one at 08:53 was not, because pipeline SQL evaluates `now()` once at creation.
- Test, after the merge: Web `error` with a localhost page, Web `telemetry` at +3 days, iOS `telemetry` with `slaxreader://reader/12345`, and Android `error` at +3 days were stored; iOS `vue` and a Web record with a `slaxreader://` page were rejected.
- Production, after the merge: Web production, Web beta at +3 days and iOS production probes were stored; a development probe was rejected; real Web error records resumed at 13:42 UTC.

## Local Web against the test stream

`nuxt dev` (development profile, port 3100) with `DWEB_API_BASE_URL=https://api-reader-beta.slax.com` and `CLIENT_ERROR_INGEST_URL` set to the test stream, driven by headless Chrome 158 through Playwright with an authenticated session. The test stream's CORS admits only `https://r.slax.dev`, so the page's ingest requests were intercepted and their bodies forwarded unchanged to the stream (same approach as `client-error-diagnostics`).

- Success: two page loads produced `powersync_phase` rows for `token success` (`credential_source` `api`, then `cache` 0 ms), `connect success` (`connection_kind` `initial`) and `stream success`, each with a numeric `duration_ms`, `user_id`, `page_url`, `release` and `env`. The stream committed every batch, and the rows were queryable in the test `client_errors.errors`; `AVG` and `approx_percentile_cont` over `duration_ms` per phase returned values.
- Failure: with `/v1/sync/token` forced to 503 and a `cf-ray` header, one `powersync` error row (`[powersync] sync token failed: 503`, `ray` set) and `telemetry` rows `powersync_phase token failure` carrying `error_fingerprint` equal to the error row's `fingerprint` and the same `ray`, plus `powersync_connection_lost stream_lost`.
- `/events` received only `screen_viewed` in both runs; no `powersync_phase` or `powersync_connection_lost`.

## Monitor

`slax-reader-monitor` `6e83f84`, deployed to `clawdbot-node2`: client error counts, digests and alerts exclude `kind = 'telemetry'` and probe rows, and the status card has a 同步链路 row. Rendered from the test lake it showed connect P50 2.4 s / P90 5.1 s, token P90 3.8 s, first download P90 2.1 s, 3 connect failures (the forced 503s) and 3 losses; from production it shows "24h 内暂无客户端遥测" until clients ship.

## Automated checks

- Web `vitest run`: 278 files passed, 1 skipped (3424 tests), twice in a row. One earlier full run had a timing failure in `errorLog.spec.ts` that passed alone and in both later runs.
- Web `vue-tsc --noEmit -p .nuxt/tsconfig.app.json`: passed.
- Mobile `node tooling/test.mjs`: 1372 passed, 2 failed (`pdf-browser`, `pdf-cross-interop`), both because a fresh worktree lacks the generated `assets/pdf/bundle.json`; unrelated to this change.
- Mobile `tsc --noEmit`: no errors other than the same missing generated PDF bundle.
- `openspec validate --all --strict`: 178 passed.

## Gaps

- Mobile was not run on a device or simulator in this change; its routing is covered by the error-log and sync-observability tests, and its page address and telemetry rows by test-stream probes in the exact client format.
- Archiving needs `client-error-diagnostics` archived first (the modified requirements are added there).

## Local review

Bugs, Security and Compliance passes on the diff: no Important findings. Telemetry rows pass through the same property sanitizer (URL query, share and collection code redaction) and identity binding as errors, cannot displace pending errors, and accept only fixed event names and bounded labels; the Mobile page address keeps only the route and the bookmark id.

## Follow-up: `powersync_connection_lost` on Web

On beta (2026-11-26 03:30 UTC) an iPhone Chrome session on `/auth` failed its first credential request (`TypeError: Load failed`) and still recorded `powersync_connection_lost`, because Web counted any connected-to-disconnected status change after `connect()` resolved, even when no stream had connected. Web now records it only for a stream that reached a connected status and then dropped while the browser is online and the page is visible, the same rule Mobile already applies. `powersync-reconnect-backoff.spec.ts` covers an established stream dropping (recorded once), a connect that never came up, a counted stream failure, going offline and a hidden page (none recorded); two of these fail against the previous plugin. Web `local-first` tests: 18 files, 242 passed.
