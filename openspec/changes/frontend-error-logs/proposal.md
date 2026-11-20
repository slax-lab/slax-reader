# Proposal

## Why

Web failures are invisible after release: uncaught exceptions, rejected promises, Vue render errors, failed script chunks, and PowerSync failures only reach the visitor's console. PowerSync failures in particular are caught and logged by the application or retried inside the SDK, so a sync outage, an upload rejection, or a local database initialization failure leaves no queryable trace. The change requester wants these errors in a data lake that agents can query, without adopting an external monitoring dashboard.

## What Changes

- Add a shared browser error collector that normalizes errors into a fixed record format, groups repeats by fingerprint with an occurrence count, batches records, and delivers them directly to a Cloudflare Basin Pipelines stream over HTTP.
- Capture uncaught errors, unhandled promise rejections, Vue application errors, and failed `<script>` resource loads in the Web app. Other resource failures (images, stylesheets, media) and `console` output are not captured.
- Capture PowerSync failures in the Web app with one counting source per failure: the SDK logger at error level for sync-stream failures and worker crashes, the connector's rejected uploads, and the application's own initialization, connection, reset, and lifecycle failure paths.
- Do not report Extension errors. The Extension's PowerSync runs inside the Web `/x/ext-bridge` page, whose errors are Web records.
- Attribute each record to the application, release, environment, page origin and path, a per-page session, and the user and device identifiers already available to the client.
- Configure one ingestion endpoint per build environment; builds without a configured endpoint do not collect.
- Provision per-environment streams, SQL-filtered pipelines, and Iceberg tables in the test and production Cloudflare accounts, where the pipeline admits only records matching the format and the environment's allowed origins.

## Capabilities

### New Capabilities

- `frontend-error-logs`: Collection, normalization, deduplication, delivery, and server-side format admission of Web error records, including PowerSync failure capture.

### Modified Capabilities

None. PowerSync initialization, recovery, and synchronization behavior in `web-local-sync` is unchanged; this change only observes its failures.

## Impact

- New collector module in `packages/frontend-utils`, consumed by Web.
- Web: a client plugin for global and Vue errors, and instrumentation in `apps/web/app/plugins/powersync.client.ts`.
- Build configuration: one public ingestion endpoint value per Web environment.
- Cloudflare: new R2 buckets, Basin Catalog tables, streams, sinks, and pipelines in the test account and the production account. Existing lake buckets and pipelines are untouched.
- No API, database schema, migration, dependency, or visible UI change. Telemetry delivery is best effort and never alters sync, authentication, or rendering.

## Non-goals

- Extension, Mobile, and server-side Worker errors, and source map symbolication.
- Alerting, dashboards, or a user-facing error surface.
- Image, stylesheet, media, or `console` capture.
- Changing PowerSync behavior or the separate `powersync-client-telemetry` phase timing work.
