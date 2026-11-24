# Validation

## Scope

## Automated checks

- Shared packages: `packages/frontend-utils` collector and request tests; `packages/contracts` typecheck and event payload test.
- API: `pnpm api -- test test/script/layerArchitecture.test.ts`, affected handler/domain suites, `pnpm api -- typecheck`, lint.
- Web: request wrapper, error plugin, PowerSync plugin and telemetry tests; `pnpm web -- test`, typecheck, lint.
- Mobile: `pnpm mobile -- check` (architecture, typecheck, tests), `pnpm mobile -- bundle`, lint.

## Running-environment evidence

- API: deploy a local or preview build and exercise a sync save failure with a `CF-Ray` header, a summary provider failure, a blocked-target save and a post-save step failure; confirm the log fields and event names, and confirm `cf-ray` exposure plus `Timing-Allow-Origin` on a JSON and a preflight response.
- Web: exercise a local production-mode build: an API 500 with ray and `properties.net`, a network failure, a PowerSync stream failure with the 5s→2min backoff, an upload rejection with ray, an offline pause, an online and visibility resume, a `powersync_phase` event joined to its error row, a blocked Google Tag Manager script, a Stripe script failure, a first-party bundle failure and an ext-bridge error with a user; confirm no visible UI change.
- Mobile: exercise a development build against the test stream: uncaught error, release-style rejection, render error, API 500 with ray, PowerSync token/connect/stream/upload failures, backoff, offline pause and online/foreground resume, and a `powersync_phase` event with the same fingerprint and ray; confirm Crashlytics behavior is unchanged.
- Storage: confirm both pipelines write to `client_errors.errors`, the Mobile row has `page_url` NULL, valid records are admitted, and invalid records (`app=web`, non-NULL `page_url`, wrong env, unknown kind, oversized fields) are dropped.

## Requirement evidence

- `backend-error-diagnostics` / RSS refresh commit retains cause: failing commit log captured with feed id, name, message, code, meta, no ray and no URL.
- `backend-error-diagnostics` / Sync save retains cause and Ray ID: single-change, multi-change, with and without `CF-Ray`.
- `backend-error-diagnostics` / AI summary retains provider fields: status/reference, timeout/overloaded, non-provider error, no-ray execution, one entry per request.
- `backend-error-diagnostics` / Browser clients read Ray ID and timings: JSON and preflight headers, `Timing-Allow-Origin` origins, media list unchanged.
- `backend-error-diagnostics` / Bookmark failure events: post-save step event, blocked target class, real save failure, background step without context, unchanged `bookmark_add_step` and `source_bookmark_id`.
- `backend-error-diagnostics` / Bounded and payload-free: payload-like error property and raw provider response excluded.
- `client-error-logs` / Mobile JS and render capture: uncaught, rejection, render, native crash, no endpoint.
- `client-error-logs` / Failed API requests: Web and Mobile 500, network, 404, abort, retry-success, sync exclusion, no payload leakage.
- `client-error-logs` / PowerSync failures once: upload, repeated stream, token, connect, init, shared worker, healthy sync, offline pause, consecutive counts.
- `client-error-logs` / Ray correlation: response present, no response, PowerSync upload, SDK stream without headers.
- `client-error-logs` / Host timing: earlier entry with DNS/TCP/TLS/TTFB/protocol, slow handshake visible, no entry omitted, Mobile omits `net`.
- `client-error-logs` / Third-party script filtering: GTM/GA/Cloudflare blocked with no record, Stripe and first-party recorded.
- `client-error-logs` / Ext-bridge attribution: signed-in store user, conflicting bridge payload, empty store, surface property.
- `client-error-logs` / Normalize and deliver: repeat counts, long recurrence, Mobile screen, Web page URL, account change, background flush, unreachable endpoint, capture failure, deep stack.
- `client-error-logs` / Admission: production→test, cross-client rejection, non-NULL page URL, unknown kind, missing screen, field bound, numeric `user_id` rule, `release=1.0.33+808`, both clients in one table.
- `powersync-reconnect-backoff` / Exponential backoff: 5/10/20/40/80/120 sequence, reset on success, upload rejection, ext-bridge, shared worker.
- `powersync-reconnect-backoff` / Offline and foreground: offline pause, online resume, foreground resume, account change cancels retry.
- `powersync-client-telemetry` / Phase outcomes: token cache/network, connect/reconnect, stream download, upload submit/acknowledge, connection lost.
- `powersync-client-telemetry` / Join without double counting: failure fingerprint and ray in both tables, stream without ray, one error row only, success has no error row.
- `powersync-client-telemetry` / Attribution and best effort: persistent status error once, stale account discarded, sender unavailable.

## Not verified

## Delivery
