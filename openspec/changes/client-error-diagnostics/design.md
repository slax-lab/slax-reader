# Design

## Context

This change merges three proposals: the backend diagnostics on `fix/rss-sync-error-diagnostics`, the Mobile collector on `feat/mobile-error-logs`, and the requester's local `powersync-client-telemetry` (PCT). The first two are committed on their branches; PCT is not in git. The old branches remain untouched.

Relevant current state:

- `packages/frontend-utils/src/errorLog.ts` already provides the shared collector: `createErrorCollector` with `capture`/`flush`, normalization, compact stacks, URL query stripping, share-code redaction, fingerprinting, repeat backoff, per-session bounds and never-throw guards. `ClientErrorApp` is `'web'` only.
- `apps/web/app/plugins/powersync.client.ts` creates the PowerSync database with a wrapping logger, captures error-level SDK records, connector upload errors, init, connect, reset and recovery failures, and calls `db.connect(connector, { params, connectionMethod })` (`:427`). It has no status listener, no offline pause and no reconnect backoff.
- `apps/web/app/utils/request.ts` builds the shared `FetchRequest` with interceptors. `packages/frontend-utils/src/request.ts` throws `RequestError` with a backend `code` but no HTTP status or response headers, so a Ray ID cannot be read today.
- `apps/mobile/src/data/runtime.ts` swallows `opened.connect(...)` rejection at `:98`, retries credential failures with `syncFailures`/`syncRetry` at `:100`–`:103`, disconnects on offline and reconnects on online/foreground, and constructs the PowerSync database at `:286`. `apps/mobile/src/data/connector.ts` owns `fetchCredentials` and `uploadData`. `apps/mobile/src/data/api.ts` retries 5xx twice and surfaces `ApiError`/`DataTransportError`.
- `apps/api` already sets `rayId` in the request context at the edge entry (`entry/edge/index.ts:25`) and restores it from the internal header in core and AI entries. CORS is produced in `middleware/cors.ts`; JSON responses spread `corsHeader` (`utils/responseUtils.ts:15`). `domain/aigc.ts:516` logs the summary failure as a bare `console.error(error)`; `infra/external/vertexAIClient.ts:359` already logs structured provider fields under `[aigc.vertex] chat stream failed`.
- `domain/crawl.ts:1448` emits `bookmark_save_failed` with `error_class=stepName` for post-save step failures. `handler/http/bookmarkController.ts:131` emits it for every save failure, including blocked targets. A search of `docs/` and `openspec/specs/` finds no repository consumer of `bookmark_save_failed`; the external monitor reads `error_class`, and `dbLogs.ts` step-success queries use `bookmark_add_step`.
- `openspec/changes/frontend-error-logs/` is active but not archived into `openspec/specs/`; `openspec/changes/snapshot-save-observability/` adds `source_bookmark_id` to `bookmark_save_failed`.
- On both platforms the streaming sync implementation retries at a fixed `retryDelayMs` (default 5000 ms) with no growth; the Web `/x/ext-bridge` page can therefore retry for hours.
- The Web `/x/ext-bridge` page reads its bridge user from `useUserStore()` (`apps/web/app/pages/x/ext-bridge.vue:32`), hydrates it with `$hydrate()` and returns `userStore.userInfo` for bridge responses (`:332`–`:334`). The getter returns `state.user` (`apps/web/app/stores/user.ts:72`), whose `UserInfo.userId` is numeric (`packages/contracts/src/interface.ts:459`). The page runs in the Extension's iframe, where the collector's cookie read returns nothing, which is why all 436 production records from that page have no user.
- The production API sends `Access-Control-Allow-Origin: *` but no `Timing-Allow-Origin`, and the PowerSync hostname exposes only `Content-Type`; cross-origin Resource Timing therefore reports zero for DNS, TCP and TLS. The preview profile's Web origin is `https://r.slax.dev` (`docs/web/deployment.md:89`), alongside `https://r.slax.com` and `https://r-beta.slax.com`.
- Production recorded 35 `Script failed to load: https://www.googletagmanager.com/gtm.js` records in 13 hours, plus 3 Cloudflare beacon and 1 Stripe failures; most were ad-blocker blocks of third-party scripts, not application faults.

## Goals / Non-Goals

**Goals:**

- One branch, one change, one set of contracts for the failure path across API, Web, Mobile and PowerSync.
- One Ray ID join key across client errors, Cloudflare HTTP analytics and Worker logs.
- One PowerSync phase vocabulary across both lakes.
- Bounded reconnection work after sync failures.
- No UI change, no sync semantic change, no upload-order change, no ext-bridge protocol change.

**Non-Goals:**

- Extension reporting or the Extension save button on `r.slax.com`.
- OpenAI moderation routing.
- Monitor-side alerting, dashboards and the lake self-check.
- Crashlytics changes, source maps, IP collection.
- Historical backfill, Extension bridge telemetry context.

## Capability split

Four capabilities, because they have different owners, destinations and verification:

- `backend-error-diagnostics`: server logs and server event classification, verified in the API.
- `client-error-logs`: Web and Mobile error capture and admission into `client_errors.errors`, verified per client.
- `powersync-reconnect-backoff`: sync lifecycle behavior, which is not observability and would be misnamed inside the telemetry capability.
- `powersync-client-telemetry`: observations in `reader-lake.logs.events` and their join to error records.

`frontend-error-logs` is not archived into `openspec/specs/`, so a MODIFIED delta cannot target it. `client-error-logs` therefore describes the cross-client contract, while the existing change remains the owner of the initial Web capture behavior; this change adds Web API failure capture, context and Ray ID on top and does not restate the initial Web capture requirements.

## Decisions

### Backend diagnostics

Use one shared `errorDiagnostic(error)` helper in `apps/api/src/utils/` returning bounded `name`, `message`, `code` and `meta`, plus `providerDiagnostic(error)` for the AI provider fields. Both call sites and the summary catch use it, so privacy and shape rules do not drift.

- RSS refresh commit: `{ feedId, ...errorDiagnostic(error) }`, no Ray ID, because the commit runs from the five-minute cron. An HTTP refresh can schedule the same job, but the shared background job does not thread a request identifier, and adding one would change orchestration for diagnostics only.
- Sync save: add `ray: ctx.get('rayId') || undefined` and keep the existing user id, count, and single-change `table`/`op`.
- AI summary: replace the bare `console.error(error)` with one fixed-line structured entry containing `providerStatus`, `providerCode`, `reference`, `overloaded`, `timedOut`, a 500-character `message`, and the Ray ID. The existing `[aigc.vertex] chat stream failed` line is unchanged; the summary line is the per-request safety net at the layer that serves the stream. One entry per failed request, not per chunk.
- CORS: add `'Access-Control-Expose-Headers': 'cf-ray'` to `corsHeader`. It applies to JSON, SSE and preflight responses through the existing spread; `responseImage` keeps its own exposed list.

### Bookmark failure classification

- Post-save steps (`content_moderation`, `content_validation`, `fetching`, `parsing`, `post_processing`, and the other step names used by the workflows) emit the new `bookmark_add_step_failed` with `error_class` equal to the step name. `sendAddBookmarkStepEvent` already knows the step and the persisted bookmark, so this is one rename at one emission point.
- `bookmark_save_failed` remains for saves that did not persist. A blocked target is a non-persisting outcome, so it stays in that event with `error_class=unsupported_target`; the controller classifies `BLOCK_TARGET_URL` in the same catch that currently calls `saveFailed`. Invalid input, admission and rate-limit failures keep `bookmark_add`.
- `bookmark_add_step` success/failure records, the step success-rate query and `source_bookmark_id` on `bookmark_save_failed` are unchanged. Historical rows keep the old shape for 30 days; the external monitor must move its step-failure query to the new event and split `unsupported_target` from real save failures. That migration is outside this repository and is named in the migration plan.

### Shared client collector

Widen `ClientErrorApp` to `'web' | 'ios' | 'android'`, and change `capture` to return the record's fingerprint (`string | undefined`) so the telemetry path can reuse it. No record field changes; existing callers may ignore the return value. Mobile passes its own `send`, no `pageUrl`, and `properties.screen`/`properties.ray`; Web keeps `pageUrl` and existing behavior.

Web API failures are captured at the single shared request boundary: `FetchRequest` gains an optional failure observer that `handleRequest` calls once in its catch with `{ method, path, status?, ray?, network, cancelled }`. `handleResult` attaches the HTTP status and the `cf-ray` header to `RequestError` before parsing the body, so a non-JSON 5xx still carries them. Web filters 5xx/network, ignores 4xx, aborts and session replacements, and captures `kind=network`, `phase=request` (an API-record value outside the four-value PowerSync vocabulary), plus context. PowerSync failures feed the same record path: the connector captures a token failure at `fetchSyncCredentials`, where the response and its ray are still available, and claims that failure so the SDK logger does not count it again; `uploadChanges` attaches ray and phase to the error, and `onError` captures it. SDK stream failures expose no response headers, so the logger records them with no ray. Each counting source emits its `powersync_phase` observation immediately after capture, using the fingerprint returned by `capture`.

Web context: `online` from `navigator.onLine`, `foreground` from visibility, `visibility` from `document.visibilityState`, `connection_ms` from a `connectedAt` set by a status listener, and `consecutive_failures` from a per-family counter. The PowerSync counter increments on each captured PowerSync failure and resets on a connected status; the API counter increments on each captured API failure and resets on a 2xx response. Mobile context uses `network.getSnapshot()`, `activity.isForeground()`, the existing `syncFailures`, and the route-name tracker; `connection_ms` comes from a timestamp set when the connection is established and cleared on disconnect, offline, pause or account change; initialization maps to phase `connect` with `stage=init`.

Host timing for Web failures: `performance.getEntriesByType('resource')` is filtered by the failed request's host and, where the browser exposes `responseStatus`, to successful entries; the most recent entry by `startTime` is taken, and `properties.net` records `dns_ms = domainLookupEnd - domainLookupStart`, `tcp_ms = (secureConnectionStart > 0 ? secureConnectionStart : connectEnd) - connectStart`, `tls_ms = connectEnd - secureConnectionStart` when `secureConnectionStart > 0`, `ttfb_ms = responseStart - requestStart`, and `protocol = nextHopProtocol`. Unavailable or negative values and the whole object are omitted. The API and PowerSync hostnames need the `Timing-Allow-Origin` header for these values to be nonzero. Mobile has no Resource Timing and records no `net`.

Third-party script filtering lives in the shared `installGlobalErrorCapture` script branch: a script URL whose hostname is or is a subdomain of `googletagmanager.com`, `google-analytics.com` or `static.cloudflareinsights.com` is skipped, while first-party bundles and `js.stripe.com` remain captured. This is the one intentional change to the Web resource behavior established by the active `frontend-error-logs` change; the rest of that behavior is unchanged.

Ext-bridge identity: `useClientErrorLog` detects `location.pathname === '/x/ext-bridge'`, obtains the page's user store in a guarded call, hydrates it once if needed, and reads `userInfo.userId` as the synchronous `user_id` source. It never reads the bridge message payload or a token for this surface, and the Web adapter adds `properties.surface='ext-bridge'` to every record from that page. Non-bridge pages keep the cookie-derived identity.

The Mobile adapter follows the existing injected-port pattern (`diagnostics` in `createMobileDataRuntime`): a typed `MobileErrorLog` port is wired at composition and implemented under `src/telemetry/`. Screens never import it, and data modules depend only on the port.

### Web and Mobile reconnect backoff

Both clients own the schedule and reuse the existing connection state:

- Web: the plugin registers a status listener for control only (status is still not a counting source), records `connectedAt`, and on an observed stream failure increments the failure count, calls `db.disconnect()` to cancel the SDK's fixed retry, and schedules one `connect()` at `min(5000 * 2^n, 120000)`. On connected status it resets the count and timeout. In shared-worker mode a Web Lock holder owns reconnect control so tabs do not multiply attempts; without Web Locks the shared worker still serializes the connection. `offline` clears the timer and disconnects; `online` and visibility-to-visible call `connect()` immediately. The SDK's `retryDelayMs` stays default; the app's disconnect is what prevents its fast retry.
- Mobile: reuse `syncFailures`, `syncRetry`, `clearSyncRetry` and `connectAccount`. Add a status listener to reset the counter on a connected status, and on a logger stream failure disconnect and schedule through the existing timer with the same 5 s–120 s delay. The `connect()` rejection at `runtime.ts:98` and the credential catch at `:100` share the same delay function. Offline, online and foreground already go through `NetworkAvailability` and `RuntimeActivity`; the change only makes their reconnect immediate and keeps one pending timer.
- Upload failures are not stream failures: the SDK's upload retry and CRUD queue remain untouched, preserving upload order. The ext-bridge page uses the same plugin and follows the same backoff with unchanged messages.

### PowerSync client telemetry

- Phase vocabulary: `token`, `connect`, `stream`, `upload`. Map `credentials` → `token`, `download` → `stream`, `submit`/`acknowledge` → `upload` with `properties.step`.
- Success and timing outcomes go to `/events` as `powersync_phase`, and unexplained losses as `powersync_connection_lost`, through the existing first-party senders. Mobile's `ClientEvent` property type widens to the contracts' JSON value type so durations are numbers; the API already accepts it.
- Failure path: the error is captured first and its fingerprint (returned by `capture`) and Ray ID are passed into the phase outcome. `client_errors.errors` gets one row from the single counting source; `reader-lake.logs.events` gets one phase outcome, never a second error or stack row. The two join on fingerprint and ray (plus observation id and account/device/time). When the collector is disabled or drops the record, the phase outcome still goes out without a fingerprint, and no error row exists.
- Duplicate suppression stays at the phase-episode level; best-effort delivery, stale-account discard and the no-credentials/no-content rule are unchanged from PCT.
- Extension bridge context, backfill and dashboards remain non-goals.

### Operator-side infrastructure

An operator creates, outside this repository:

| Environment | Account | New stream + pipeline | Pipeline target | Admitted `app` | Admitted `env` |
| --- | --- | --- | --- | --- | --- |
| Test | test account | new Mobile stream + pipeline | existing `client_errors_sink` → `client_errors.errors` | `ios`, `android` | `development` |
| Production | production account | new Mobile stream + pipeline | existing `client_errors_sink` → `client_errors.errors` | `ios`, `android` | `beta`, `production` |

Admission SQL rules, applied by each Mobile pipeline before its insert; the Web pipeline keeps its current rules:

- `app IN ('ios','android')`.
- `env` in the environment's list above.
- `kind IN ('error','unhandledrejection','render','powersync','network')`.
- `release` matches `^[0-9]+\.[0-9]+\.[0-9]+(\+[0-9]+)?$`, for example `1.0.33+808`.
- `session_id` matches a UUID shape; `count` is an integer from 1 to 100000.
- `occurred_at` is within the last 7 days and not more than 1 day in the future.
- `octet_length(message) <= 16384`, `octet_length(stack) <= 4096`, `octet_length(properties) <= 8192`; `error_name` matches `^[A-Za-z_$][A-Za-z0-9_$.]{0,63}$` when present.
- `page_url IS NULL`.
- `user_id` is absent or matches `^[0-9]{1,20}$`, the same rule as the production Web pipeline because Slax user ids are numeric and both pipelines write one table; `device_id` is absent or matches `^[A-Za-z0-9_-]{8,128}$`.
- `ua`, when present, is at most 1024 bytes.

`properties.screen` and `properties.ray` are client-bounded inside the `properties` byte limit; no JSON extraction is required for admission. If the engine supports it, the same screen pattern may be added as defense in depth.

Two further operator actions: a Cloudflare Transform Rule on the PowerSync hostname (`slax-reader-powersync-sg-api.slax.com`) exposing both `cf-ray` and `Timing-Allow-Origin` (the Web origins above) for stream-header and Resource Timing support, and confirmation that the new streams need no browser CORS allowlist. The API's `cf-ray` exposure and `Timing-Allow-Origin` are code changes in this branch, not operator steps. The Reader event lake needs no new configuration; `/events` already accepts the envelope and numeric properties.

### Event consumers and versions

- `bookmark_save_failed` consumers outside this repository must add `bookmark_add_step_failed` and treat `unsupported_target` separately. The repository's own step success-rate query reads `bookmark_add_step` and is unaffected.
- Web deploys without a package version. Mobile ships this code, so the requester must decide whether to increment `version`/`buildNumber`. The Extension is untouched; the save-button change is separate.

## Risks / Trade-offs

- [Two active changes describe Web behavior] → `frontend-error-logs` owns the initial Web capture; this change adds to it. Archiving order is called out as an open question rather than silently duplicating requirements.
- [Ray ID is absent for SDK stream failures] → The SDK exposes no response headers; the record omits the ray and the spec says the absence is not reachability evidence for those records.
- [Web shared-worker reconnect control] → A Web Lock holder owns the schedule; without Web Locks the shared worker serializes connections, so attempts cannot multiply beyond one connection.
- [Bookmark event consumers break silently] → The migration notes the new event and class; historical rows keep the old shape for 30 days; the monitor migration is external.
- [Telemetry and error records diverge] → The error fingerprint is returned by the collector and copied into the phase event; both share the ray. A missing fingerprint means the error was disabled or dropped, and the phase event still stands alone.
- [CORS change affects every JSON response] → Only one exposed header name is added; origins, methods, credentials and bodies are unchanged, and media responses keep their list.
- [Backoff delays recovery after a transient failure] → Online and foreground transitions bypass the delay, and a success resets it.

## Migration Plan

1. API deploy: CORS exposure, diagnostic fields, AI summary line and bookmark event classification take effect together. Monitor queries need the `bookmark_add_step_failed` migration; keep the old rows readable for the 30-day overlap.
2. Operator creates the Mobile streams, pipelines and Transform Rule before the Mobile build ships. No table or Web stream change.
3. Web deploy starts API failure capture, context and backoff; reverting the plugin restores the previous retry behavior without data migration.
4. Mobile build starts collection and backoff; an empty ingestion input stops collection immediately.
5. The old branches and PCT remain untouched; this branch is the single delivery vehicle.

## Open Questions

- Whether to increment Mobile `version`/`buildNumber`, and to which values, is a requester decision before delivery.
- Whether `frontend-error-logs` should be archived before this change, so the Web contract has one owner, or both archive together, is a sequencing decision for the requester.
- The external monitor's migration window for `bookmark_add_step_failed` and `unsupported_target` is owned by the monitor repository.
