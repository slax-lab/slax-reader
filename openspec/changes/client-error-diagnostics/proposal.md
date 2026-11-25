# Proposal

## Why

Three related observability gaps are currently tracked as three proposals: backend failures that discard their cause, client failures that never reach the error lake, and PowerSync timings that never reach the event lake. They share one failure path, one Ray ID correlation key, and one set of phase names, so shipping them separately would duplicate contracts and leave the join keys inconsistent. The change requester asked for one change that covers the backend, Web, Mobile and PowerSync observability work together.

The merged change also fixes two known signal defects: Web PowerSync retries every few seconds for hours without backoff, and `bookmark_save_failed` counts saves that actually persisted, drowning the real failures (1192 of 1305 events in 30 days).

## What Changes

- **Backend causes and Ray ID.** RSS refresh commit, sync save and AI summary failures keep the caught error's diagnostic fields; sync save and AI summary also record the request's Cloudflare Ray ID. RSS refresh commit omits it because the five-minute cron has no request. The API exposes `cf-ray` and `Timing-Allow-Origin` for the Web origins; the operator adds both on the PowerSync hostname.
- **Bookmark failure classification.** Post-save step failures (content moderation, content validation, fetching, parsing, post-processing) move to a separate `bookmark_add_step_failed` event; `bookmark_save_failed` remains for saves that did not persist, with a distinct `error_class` for blocked targets.
- **Shared client error collection.** The shared collector's application type accepts `ios` and `android`, its record format and existing Web path are unchanged, and `capture` now returns the record fingerprint for the telemetry join; callers may pass `properties.ray` without a collector change. Web and Mobile capture uncaught JavaScript errors, unhandled rejections and render errors, failed API requests (5xx and network only), and PowerSync failures with one counting source per failure. Records carry the failure phase, online/visibility/foreground state, connection uptime, consecutive failures, `properties.screen` on Mobile, and `properties.ray` when a response exposed it. Mobile rows enter the same `client_errors.errors` table as Web with `page_url` NULL and use the production Web pipeline's numeric `user_id` rule.
- **Web additions.** Web records failed API requests, reads `cf-ray` from responses through the exposed header, records the most recent `dns_ms`/`tcp_ms`/`tls_ms`/`ttfb_ms`/`protocol` for the failing host in `properties.net` when Resource Timing has an entry, gives PowerSync and network records the same failure-mode context as Mobile, skips blocked third-party analytics/ads script failures, and attributes `/x/ext-bridge` records from the page's user store with `properties.surface=ext-bridge`.
- **PowerSync reconnect backoff.** Web and Mobile back off consecutive sync failures from 5 s exponentially to a 2 min cap, reset on a successful connection, pause while offline, and reconnect immediately when the network returns or the app returns to the foreground. Sync semantics, upload order and the ext-bridge protocol are unchanged.
- **PowerSync client telemetry.** Phase timings and outcomes go to the Reader event lake (`/events`) with one phase vocabulary across Web and Mobile: `token`, `connect`, `stream`, `upload` (mapping the earlier `credentials`, `download`, `submit` and `acknowledge` names). Failures still go to `client_errors.errors`; their reader-lake phase observation carries the same fingerprint and Ray ID so the two records can be joined without counting a failure twice in either table.
- **Operator infrastructure.** New Mobile streams and pipelines insert into the existing `client_errors_sink` and `client_errors.errors` table per environment; a Transform Rule exposes `cf-ray` and `Timing-Allow-Origin` on the PowerSync hostname.
- **Version decision.** Web deploys without a package version; Mobile ships this code and needs a version decision from the change requester before delivery. The Extension is not modified.

## Capabilities

### New Capabilities

- `backend-error-diagnostics`: bounded diagnostic fields and Ray ID on backend failure logs, the CORS Ray ID and cross-origin timing exposure, and persisted-versus-rejected bookmark failure classification.
- `client-error-logs`: Web and Mobile capture, normalization, delivery, failure-mode context, host timing, third-party script filtering, ext-bridge attribution and Ray ID correlation of error records into the shared `client_errors.errors` table, including its per-environment admission.
- `powersync-reconnect-backoff`: bounded reconnection and offline/foreground lifecycle for Web and Mobile PowerSync without changing sync semantics.
- `powersync-client-telemetry`: observed PowerSync phase timings and outcomes in the Reader event lake, with a single phase vocabulary and join keys to the error records.

### Modified Capabilities

None. `frontend-error-logs` is an active, implemented change that is not yet archived into `openspec/specs/`, so its Web capture behavior remains its own contract; this change builds on its collector and adds Web API failure capture, context and Ray ID on top. `snapshot-save-observability` adds `source_bookmark_id` to `bookmark_save_failed` and remains compatible with the classification change.

## Impact

- `apps/api`: `domain/rss.ts`, `handler/http/syncController.ts`, `domain/aigc.ts`, `domain/crawl.ts`, `handler/http/bookmarkController.ts`, `middleware/cors.ts`, and a shared error-diagnostic helper under `utils/`.
- `packages/frontend-utils`: `errorLog.ts` (application type, fingerprint return) and `request.ts` (failure metadata and Ray ID).
- `apps/web`: the client error plugin and collector wiring, the API request wrapper and host timing, the third-party script filter, ext-bridge identity, the PowerSync plugin and connector, and the first-party event sender.
- `apps/mobile`: the error-log adapter and React Native handlers, PowerSync and API instrumentation, reconnect control, telemetry payload typing, and a public ingestion endpoint build input.
- Cloudflare, outside this repository: Mobile streams and pipelines, a PowerSync hostname Transform Rule exposing `cf-ray` and `Timing-Allow-Origin`, and the existing reader-lake route. The Web stream, pipeline, table schema and existing rows are unchanged.
- Event consumers: the external monitor and dashboards must add `bookmark_add_step_failed` and treat `unsupported_target` separately; the repository's own `bookmark_add_step` success-rate query is unaffected.
- No database schema or migration, no API contract break, no Crashlytics change, no alerting change, and no UI-visible change.

## Out of Scope

- The Extension save button on `r.slax.com`, a UI-visible Extension change delivered separately with hands-on acceptance.
- OpenAI moderation routing, already handled in `slax-reader-config` PR #16.
- Monitor-side alerting and the lake self-check, owned by the monitor repository.
- Crashlytics behavior, source-map symbolication, and IP address collection, full or truncated.
