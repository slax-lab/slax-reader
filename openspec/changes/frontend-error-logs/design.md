# Design

## Context

See `proposal.md` for motivation. Web is a Nuxt client app whose PowerSync runtime is created in `apps/web/app/plugins/powersync.client.ts` with SharedWorker, Dedicated Worker, main-thread, and REST fallback modes. The Extension's offscreen document embeds the Web `/x/ext-bridge` page for PowerSync. Web already depends on `@commons/frontend-utils`.

A pre-implementation probe exercised `@powersync/web` 2.4.0 against a real PowerSync service with injected faults in all three worker modes:

| Failure | SDK logger (error) | Status `downloadError` / `uploadError` | Application catch |
| --- | --- | --- | --- |
| Sync stream 4xx/5xx, token failure, stream cut | yes, once per retry | yes, once per change | — |
| Upload rejected by the sync API | no (debug only) | `uploadError` only | — |
| Local database initialization failure | no | no | initialization path only |
| Worker script crash | message only, no cause | no | no |

## Goals / Non-Goals

**Goals:** one record format for both apps, PowerSync coverage across its failure sources, bounded client cost, and storage that admits only that format.

**Non-Goals:** recovering the cause of a Worker bootstrap crash that the SDK discards, symbolicating minified stacks, and capturing errors in content scripts running on third-party pages.

## Decisions

### Deliver directly to a Basin Pipelines stream

The browser posts JSON batches to the stream's public HTTP ingestion endpoint. A stream schema enforces types and required fields, a pipeline SQL `WHERE` clause enforces value formats and the environment's allowlists, and an Iceberg sink stores admitted rows. Ingestion to a stream is free and needs no Worker request budget. A first-party Worker endpoint or a Queue was rejected because it adds per-request cost and latency for high-volume client logs without adding validation the pipeline cannot do. The endpoint is unauthenticated; CORS limits other sites' browsers only, so the SQL filter is the actual admission control.

### Collector in `packages/frontend-utils`

A framework-neutral module exposes `createErrorCollector({ endpoint, app, release, env, getContext })` with `capture(kind, error, properties)`, `flush()`, and an `installGlobalErrorCapture(collector, target)` helper for global listeners. Web supplies its identity context. Records are normalized client-side to the same limits the pipeline enforces, so a record the client sends is admitted.

### Fingerprint excludes the capture source

The fingerprint hashes `kind`, error name, the message with digit runs of four or more normalized (so identifiers and timestamps merge while HTTP status codes such as 401 and 500 stay distinct), and the first stack frame. The capture source is stored in `properties.source` but is not part of the fingerprint, so the same PowerSync failure seen by the SDK logger and the status listener merges into one record. Within a page session, records accumulate counts until flushed.

### Privacy and noise filtering

Query strings and fragments are removed from absolute, protocol-relative, and root-relative URLs inside messages and stacks, including Safari and Firefox `fn@url:line:col` frames, keeping stack `line:column` positions, without RegExp lookbehind (unsupported before Safari 16.4, while the Web app supports Safari 15.4), because SDK and fetch errors embed request URLs and some application URLs carry tokens. Nuxt errors with 4xx status codes are pages declaring not-found or forbidden routes on purpose and are skipped; 5xx Nuxt errors are recorded with `status_code`. Share (`/s/<code>`) and collection (`/c/<code>`) codes grant read access to their content, so `page_url` replaces them with `:code` (and a collection member id with `:id`); the route shape is enough to locate the failing page.

### Compact stack, not the full stack

A record keeps a compact stack of every frame within 4 KiB (512 bytes per frame). Each frame is reduced to its function name and position, for example `Object.uploadChanges (HkvhJBOe.js:17541:24)`; the origin and directory of bundles under `/_nuxt/` are dropped because every bundle is served from there, while other locations (third-party scripts, extensions, `<anonymous>` built-ins, `[native code]`) keep their text because it says whose code ran. Immediate repeats from recursion collapse into one line with `×N`. When the cap is reached, the last line reports how many frames were cut. The raw stack repeats the origin and path on every line, so the compact form fits the whole call path of an ordinary error in a fraction of the space. The fingerprint uses only the first frame, so grouping does not depend on the depth. The SDK's own log text is not copied into `properties`; the error message already carries it.

### Batching and limits

A page-hide flush cannot await identity during unload, so it reuses the identity resolved by the previous flush. Each batch is split into request bodies below 60 KiB, under the 64 KiB keepalive and `sendBeacon` limit. Flush 5 seconds after a new fingerprint is queued, when 20 new fingerprints are queued, and on `visibilitychange` to hidden or `pagehide`. A repeat of a fingerprint already delivered in this page session only increments the pending record's `count` and `properties.last_occurred_at`; it is delivered once its interval has passed, which starts at one minute and doubles after each delivery up to one hour. Each delivered record carries `properties.session_count`, the session's running total for that fingerprint. Hiding the page delivers held repeats. A per-flush count alone was not enough: an error recurring every 40 seconds produced one `count=1` record per occurrence, 1084 rows in ten hours for one page. Use `fetch` with `keepalive` and a `text/plain` body (no CORS preflight); fall back to `navigator.sendBeacon` when the page is hiding. Cap each page session at 200 distinct fingerprints, message at 16 KiB, the compact stack at 4 KiB (512 bytes per frame), and `properties` at 8 KiB. Delivery errors are swallowed and never captured.

### PowerSync instrumentation

In `powersync.client.ts`: pass a `logger` that hands every record to the SDK's own `createConsoleLogger()`, so console output is identical, and additionally records level-50 records; register a status listener that tags a new `downloadError` or `uploadError` only when its identity changes, without counting it again; count rejected uploads through the connector's `onError`, since the SDK logs them only at debug level; capture `onError` and `unavailable` recovery events, `connect`, `disconnectAndClear`, and lifecycle failures. Behavior and log messages already emitted stay unchanged.

### Configuration

Each Web build profile in `nuxt.config.ts` names its ingestion endpoint: `preview` the test stream, `beta` and `production` the production stream, and `development` none, so local builds and tests do not send. `CLIENT_ERROR_INGEST_URL` in the build environment overrides the profile value for local builds; the release deploy passes only its allowlisted build configuration, so deployed builds always use the profile value. An empty endpoint disables collection.

### Extension excluded

The Extension sends no records, and both pipelines admit only `app=web` and Web origins. The Extension's PowerSync bridge is the Web `/x/ext-bridge` page loaded in an offscreen iframe, so its failures are Web records under the Web origin.

### Environments and storage

| Environment | Account | Bucket and table | Allowed `env` | Allowed origins |
| --- | --- | --- | --- | --- |
| Test | test account | `slax-reader-client-errors-dev`, `client_errors.errors` | `development`, `preview` | `r.slax.dev`, `localhost` |
| Production | production account | `slax-reader-client-errors`, `client_errors.errors` | `production`, `beta` | `r.slax.com`, `r-beta.slax.com` |

## Risks / Trade-offs

- [Forged records] → The endpoint is public; the SQL filter limits shape and origin, and agents must treat `user_id` as unauthenticated.
- [Stream schema is immutable] → New fields go into `properties`; a new top-level field requires recreating the stream.
- [Pipeline SQL rejects `length`] → Limits use `octet_length`, which counts bytes; client limits are byte-based to match.
- [Worker bootstrap crash cause is lost] → Recorded as the SDK's message only; recovering it needs an application-owned worker factory, deferred.

## Migration Plan

The Cloudflare resources exist before merge. Deploying the Web build starts collection; emptying a profile's endpoint in `nuxt.config.ts` or reverting the change stops it without data migration.
