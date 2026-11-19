# Design

## Context

See `proposal.md` for motivation. Web is a Nuxt client app whose PowerSync runtime is created in `apps/web/app/plugins/powersync.client.ts` with SharedWorker, Dedicated Worker, main-thread, and REST fallback modes. The Extension runs a background service worker, an offscreen document that embeds the Web bridge page, and Vue extension pages. Both apps already depend on `@commons/frontend-utils`.

A pre-implementation probe exercised `@powersync/web` 2.4.0 against a real PowerSync service with injected faults in all three worker modes:

| Failure | SDK logger (error) | Status `downloadError` / `uploadError` | Application catch |
| --- | --- | --- | --- |
| Sync stream 4xx/5xx, token failure, stream cut | yes, once per retry | yes, once per change | — |
| Upload rejected by the sync API | no (debug only) | `uploadError` only | — |
| Local database initialization failure | no | no | initialization path only |
| Worker script crash | message only, no cause | no | no |

## Goals / Non-Goals

**Goals:** one record format for both apps, PowerSync coverage across the three sources, bounded client cost, and storage that admits only that format.

**Non-Goals:** recovering the cause of a Worker bootstrap crash that the SDK discards, symbolicating minified stacks, and capturing errors in content scripts running on third-party pages.

## Decisions

### Deliver directly to a Basin Pipelines stream

The browser posts JSON batches to the stream's public HTTP ingestion endpoint. A stream schema enforces types and required fields, a pipeline SQL `WHERE` clause enforces value formats and the environment's allowlists, and an Iceberg sink stores admitted rows. Ingestion to a stream is free and needs no Worker request budget. A first-party Worker endpoint or a Queue was rejected because it adds per-request cost and latency for high-volume client logs without adding validation the pipeline cannot do. The endpoint is unauthenticated; CORS limits other sites' browsers only, so the SQL filter is the actual admission control.

### Collector in `packages/frontend-utils`

A framework-neutral module exposes `createErrorCollector({ endpoint, app, release, env, getContext })` with `capture(kind, error, properties)`, `flush()`, and an `install(target)` helper for global listeners. Web and Extension supply their own identity context. Records are normalized client-side to the same limits the pipeline enforces, so a record the client sends is admitted.

### Fingerprint excludes the capture source

The fingerprint hashes `kind`, error name, a digit-normalized message, and the first stack frame. The capture source is stored in `properties.source` but is not part of the fingerprint, so the same PowerSync failure seen by the SDK logger and the status listener merges into one record. Within a page session, records accumulate counts until flushed.

### Privacy and noise filtering

Query strings and fragments are removed from every URL inside messages and stacks, because SDK and fetch errors embed request URLs and some application URLs carry tokens. Nuxt errors with 4xx status codes are pages declaring not-found or forbidden routes on purpose and are skipped; 5xx Nuxt errors are recorded with `status_code`.

### Batching and limits

Flush after 5 seconds of the first queued record, when the queue reaches 20 distinct fingerprints, and on `visibilitychange` to hidden or `pagehide`. Use `fetch` with `keepalive` and a `text/plain` body (no CORS preflight); fall back to `navigator.sendBeacon` when the page is hiding. Cap each page session at 200 distinct fingerprints, message at 16 KiB, stack at 64 KiB, and `properties` at 8 KiB. Delivery errors are swallowed and never captured.

### PowerSync instrumentation

In `powersync.client.ts`: pass a `logger` that forwards level-50 records and preserves console output; register a status listener that captures a new `downloadError` or `uploadError` only when its identity changes; capture `onError` and `unavailable` recovery events, `connect`, `disconnectAndClear`, and lifecycle failures. Behavior and log messages already emitted stay unchanged.

### Configuration

Web reads `CLIENT_ERROR_INGEST_URL` from the build environment into public runtime config. The Extension reads the same variable at build time. An empty value disables collection, so local builds and tests do not send unless configured. The Extension's own origin is a `chrome-extension://` URL and its fetches are not subject to CORS because the manifest grants `https://*/*` host access.

### Environments and storage

| Environment | Account | Bucket and table | Allowed `env` | Allowed origins |
| --- | --- | --- | --- | --- |
| Test | test account | `slax-reader-client-errors-dev`, `client_errors.errors` | `development`, `preview` | `r.slax.dev`, `localhost`, development and preview extension IDs |
| Production | production account | `slax-reader-client-errors`, `client_errors.errors` | `production`, `beta` | `r.slax.com`, `r-beta.slax.com`, production and beta extension IDs |

## Risks / Trade-offs

- [Forged records] → The endpoint is public; the SQL filter limits shape and origin, and agents must treat `user_id` as unauthenticated.
- [Stream schema is immutable] → New fields go into `properties`; a new top-level field requires recreating the stream.
- [Extension IDs live in the pipeline SQL] → A new extension ID requires recreating the pipeline.
- [Pipeline SQL rejects `length`] → Limits use `octet_length`, which counts bytes; client limits are byte-based to match.
- [Worker bootstrap crash cause is lost] → Recorded as the SDK's message only; recovering it needs an application-owned worker factory, deferred.

## Migration Plan

The Cloudflare resources exist before merge. Deploying the Web and Extension builds with `CLIENT_ERROR_INGEST_URL` set starts collection; clearing the value or reverting the change stops it without data migration.
