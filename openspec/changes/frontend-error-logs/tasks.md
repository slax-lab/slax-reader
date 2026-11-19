# Tasks

## 1. Collector

- [x] 1.1 Add the error collector to `packages/frontend-utils` with record normalization, fingerprinting, per-session limits, batching, and best-effort delivery. Verify with unit tests covering grouping counts, URL query stripping, size limits, the session cap, hidden-page flush, a disabled collector without an endpoint, and swallowed delivery failures.

## 2. Web

- [x] 2.1 Add the `CLIENT_ERROR_INGEST_URL` public runtime value and a client plugin that installs global error, unhandled rejection, `<script>` load failure, and Vue error capture with Web identity context. Verify with a unit test that script failures are captured and image failures are ignored.
- [x] 2.2 Instrument `powersync.client.ts` with the SDK logger, status listener, recovery events, and application failure paths without changing existing sync behavior or console output. Verify with unit tests that changed download and upload errors are captured once per change and that recovery `onError` is captured.

## 3. Extension

- [x] 3.1 Read `CLIENT_ERROR_INGEST_URL` at build time and install the collector in the background service worker, offscreen document, and extension pages with Extension identity context. Verify with a unit test of the Extension context and a build that includes the configured endpoint.

## 4. Verification

- [x] 4.1 Run Web and Extension lint, typecheck, and unit tests, and `openspec validate --all --strict`.
- [x] 4.2 Exercise a local Web build against the test ingestion endpoint: trigger an uncaught error, a rejection, a failed script, a Vue error, and a PowerSync upload failure; confirm admitted rows and dropped malformed rows in the test table. Record results and gaps in `validation.md`, and complete the local Bugs, Security, and Compliance review.
