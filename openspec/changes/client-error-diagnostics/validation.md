# Validation

## Scope

API, shared packages, Web and Mobile on `feat/client-error-diagnostics`. The Extension source is not modified; it consumes the changed `packages/frontend-utils/src/request.ts` and its tests were run. No visible UI changes, so the `DESIGN.md` §10.1 demo and §10.2 hands-on acceptance do not apply. Mobile version `1.0.34 (809)` was approved by the change requester on 2026-11-24.

## Automated checks

All run on the branch head unless noted; results as of 2026-11-24.

- `pnpm exec openspec validate --all --strict`: 173 passed, 0 failed.
- API (with `HYPERDRIVE_DATABASE_URL`/`LOGS_DATABASE_URL` set to the CI generation-only URLs, after `config:init` and `gen:all`): `pnpm api -- typecheck` passed; `pnpm api -- lint` 0 errors (334 existing warnings); `pnpm api -- test` 282 files, 4534 passed, 166 skipped. Seven new API tests were checked to fail with their change reverted.
- Contracts: `pnpm --filter @slax-reader/contracts typecheck` passed, including the event payload type test.
- Web: `pnpm --filter @apps/slax-reader-dweb typecheck` passed; eslint and Prettier (`--config ../api/.prettierrc.mjs`) clean on touched files; `pnpm web -- test` 3401 passed, 3 skipped before the final rebase onto `origin/dev`. On this machine, under a load average near 900, each later full run timed out a different test this change does not touch (`useSlaxRoutes` “#imports 解析到 fork 版”, `errorLog` oversized properties, and two suite hooks at 30 s); each passes alone. The new backoff, request-capture and Mobile tests were each checked to fail without their fix. The pull request's CI run is the clean full run.
- Extension: `pnpm --filter @apps/slax-reader-extensions compile` passed; `pnpm extension -- test` 27 files, 127 passed.
- Mobile: `pnpm mobile -- check` (architecture, typecheck, tests) 1365 tests, 1360 passed, 0 failed, 5 skipped; `pnpm mobile -- bundle` passed; `pnpm mobile -- config` shows `1.0.34` and build `809` on both platforms.

## Running-environment evidence

Web, 2026-11-24, local `nuxt dev` (development profile) on `http://localhost:3100` in Chrome, against a local stub API/PowerSync on port 8799 (`/v1/sync/token` returns a synthetic credential, the PowerSync stream returns 502, chosen paths return an HTML 500 with a `cf-ray` header, `/events` is recorded). `CLIENT_ERROR_INGEST_URL` pointed at the test Web stream; because that stream's CORS admits only `https://r.slax.dev`, the page's records were captured in the page and replayed to the stream with curl.

- PowerSync stream failure and backoff: attempts after a failure at +5 s, +10 s, +20 s, +40 s. This exercise found that the first failure, logged before `connect()` resolved, left the session marked connected and voided every retry, and that route changes reconnected during the backoff; both were fixed (4e33db05, 917a48de) and re-checked: three route changes during a backoff made no attempt, the next came about 20 s later.
- Offline pause and online resume: no attempt during 15 s offline; one attempt 22 ms after `online`.
- API 500 with ray and `properties.net`: `GET /v1/user/labs failed (500)` and `GET /v1/collection/mine failed (500)`, `status=500`, the stub's `cf-ray`, query-free `path`, `phase=request`, `online`, `foreground`, `visibility`, `consecutive_failures` 1 then 2, `net.protocol=http/1.1`. This found that an HTML 5xx was recorded as a JSON parse error; fixed in 4e33db05.
- Telemetry: `powersync_phase` token success with `duration_ms`, stream failures carrying the error record's fingerprint, and `powersync_connection_lost` reached `/events`.
- Script filtering: a blocked `googletagmanager.com` script produced no record; a failed `js.stripe.com` script and a failed first-party `/_nuxt/` script each produced a `resource` record.
- Ext-bridge attribution: with the token cookie removed and the persisted user store holding user 42, an error on `/x/ext-bridge` was recorded with `user_id=42` and `properties.surface=ext-bridge`.

Storage (test account `52bb…`, R2 SQL on `client_errors.errors`):

- The Web pipelines dropped `kind=network`. Both were recreated with the same stream, sink and rules plus `network` (test `8358c445…`, production `261c4b77…`; backups and SQL in `slax-reader-monitor/docs/pipeline-backup`, commit 56c9584).
- Test: the replayed browser records (two `network`, two `powersync`) were stored with all properties above.
- Production: a beta `network` probe and a beta `error` probe marked `verification=ced-prod-2026-11-24` were both stored.
- Mobile admission (done before implementation, recorded in the same backup README): test pipeline stored only the valid one of eight probes (`app=web`, `env=production`, `kind=console`, `release=latest`, `page_url` set, `user_id=admin`, 15 days old were dropped); production stored android/production and ios/beta and dropped `env=development` and `app=web`, and a Web beta record still landed.
- PowerSync Transform Rule on `slax-reader-powersync-sg-api.slax.com`: from `https://r.slax.com` in Chrome, `cf-ray` was readable and Resource Timing reported nonzero TCP/TLS/TTFB.

Mobile: exercised through the runtime host tests only (see Not verified).

## Requirement evidence

Scenarios and the tests that cover them (Web `apps/web/tests/unit/**`, Mobile `apps/mobile/tests/**`, API `apps/api/test/**`); running-environment coverage is in the previous section. A scenario is listed only where a test asserts it.

- `backend-error-diagnostics` / RSS refresh commit retains cause: the API test asserts feed id, name, message, code, meta, no ray and no URL.
- `backend-error-diagnostics` / Sync save retains cause and Ray ID: single-change table/op, multi-change count, with and without `CF-Ray`.
- `backend-error-diagnostics` / AI summary retains provider fields: provider status/reference, absent fields omitted, one entry per request.
- `backend-error-diagnostics` / Browser clients read Ray ID and timings: JSON and preflight responses expose `cf-ray` and send `Timing-Allow-Origin` for the three Web origins.
- `backend-error-diagnostics` / Bookmark failure events: `bookmark_add_step_failed`, `unsupported_target`, `bookmark_save_failed` for non-persisted saves, `source_bookmark_id` kept.
- `client-error-logs` / Mobile JS and render capture: chained global handler, release-only rejection tracking, render capture, throwing collector contained (`tests/telemetry/native-handlers.test.mjs`); empty endpoint sends nothing (`tests/telemetry/error-log.test.ts`).
- `client-error-logs` / Failed API requests: Web 500 named by request, network error kept, 4xx ignored, streamed 5xx keeps status and ray (`requestCapture.spec.ts`, `requestFailure.spec.ts`); Mobile 500 with ray, `FetchError` network failure, 404, session/environment change and query stripping (`runtime-sync-observability.test.mjs`).
- `client-error-logs` / PowerSync failures once: SDK duplicate window, one counting source per failure, non-stream SDK errors recorded without `phase=stream` or backoff (Web and Mobile).
- `client-error-logs` / Ray correlation and host timing: upload and API ray, SDK stream without ray, `net` present and absent (`clientErrorContext.spec.ts`).
- `client-error-logs` / Third-party script filtering: GTM/GA/Cloudflare skipped, Stripe and first-party recorded (`errorLog.spec.ts`).
- `client-error-logs` / Ext-bridge attribution: store user, empty store, conflicting payload, `surface` property (`clientErrorLog.spec.ts`).
- `client-error-logs` / Normalize and deliver: Mobile release `1.0.34+809`, numeric user id, device id rule, screen, no `page_url`, background flush.
- `powersync-reconnect-backoff`: 5/10/20/40/80/120 s sequence, reset on connected, one pending retry, offline pause, online and foreground resume, no retry after the session ends, a failure before `connect()` resolves, route changes during a backoff (Web); the same sequence, reset, offline and online on Mobile.
- `powersync-client-telemetry` / Phase outcomes: `token` success with `credential_source` `api` then `cache` and one observation per shared fetch (Web `connector.spec.ts`, Mobile runtime test); `connect` success with `connection_kind` `initial` then `reconnect` (Web and Mobile) and `already_connected` when a shared worker is live at start (Web, untested); `stream` success duration (Mobile test; Web observed in the browser); `upload` `submit` and `acknowledge` with batch size (Web connector and Mobile uploader tests); `powersync_connection_lost` (Web browser run).
- `powersync-client-telemetry` / Join without double counting: stream and upload failures carry the error fingerprint (Web and Mobile tests, Web browser run).
- `powersync-client-telemetry` / Attribution and best effort: no observations after sign-out or for a retired account (Mobile test; Web `hasObservableSession` test); throwing observers do not change credential or upload results.

## Not verified

- Mobile on a device or simulator (task 4.8): no iOS/Android device or simulator build was run. Uncaught errors, release rejections, render errors, API failures, PowerSync phases, backoff, offline/online and background flush are covered by host tests of the real runtime and API modules with the SDK and network replaced; Crashlytics behavior was not observed.
- The real API and PowerSync service: no local API stack was available because this worktree has no `deploy/local/.dev.vars` and secret files are not copied. API log fields, the `cf-ray` and `Timing-Allow-Origin` headers and the bookmark events are covered by API tests only; a deployed API response was not inspected.
- Web against the real PowerSync token and upload paths, `upload` phase events, shared-worker mode with several tabs, and a production-mode (`nuxt build`) bundle.
- Delivery of records straight from the browser to the test stream: blocked by that stream's CORS for `localhost`; the captured records were replayed instead.
- `properties.net` with nonzero DNS/TCP/TLS values from the API host: the stub was a loopback HTTP/1.1 server, so these were 0.

## Delivery

- One pull request against `dev` from `feat/client-error-diagnostics`.
- Operator work done: test and production Mobile streams and pipelines, Web pipelines admitting `network`, PowerSync Transform Rule.
- Follow-ups: the monitor reads `bookmark_save_failed`/`error_class` from the new events after merge; `frontend-error-logs` is archived separately.
