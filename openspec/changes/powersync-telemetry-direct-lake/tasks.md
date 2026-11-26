# Tasks

A separate design document is omitted: the change reroutes existing observations to an existing table through the existing collector, with no new architecture or dependency.

## 1. Operator infrastructure

- [x] 1.1 Replace each environment's Web and Mobile client pipelines with one pipeline on the Web stream that has a Web and a Mobile admission branch, admits `kind = 'telemetry'`, admits `slaxreader://` page addresses on the Mobile branch, and has no `now()` window; delete the Mobile streams and pipelines. Verify with probes per environment: valid Web, Mobile, telemetry and +3 day records stored; wrong-kind, wrong-page and wrong-environment records rejected.

## 2. Collector and clients

- [x] 2.1 Add `telemetry(event, properties, label)` to the shared collector: one `kind = 'telemetry'` row per call, `count = 1`, identity bound at record time, sent with the next flush, at most 100 pending (oldest dropped) and 1000 per session, invalid names or labels dropped. Keep a `slaxreader://` page address as is. Verify with collector unit tests.
- [x] 2.2 Route Web `powersync_phase` and `powersync_connection_lost` through the collector instead of `/events`, and name the failure join key `error_fingerprint`. Verify the PowerSync plugin unit tests.
- [x] 2.3 Route Mobile observations through the error log, record `slaxreader://<route>[/<id>]` as the page address, and send release builds to the single production stream. Verify the Mobile error-log and sync-observability tests and typecheck.

## 3. Verification and review

- [x] 3.1 Run a local Web build against the test stream, sign in, and confirm `telemetry` rows for token, connect and stream with numeric durations in the test `client_errors.errors`, and no `/events` request for these names.
- [x] 3.2 Confirm the monitor excludes `kind = 'telemetry'` from error counts and alerts and shows a PowerSync telemetry card before the Web deploy.
- [x] 3.3 Run affected Web, Mobile and shared checks and `openspec validate --all --strict`; record results and gaps in `validation.md`; complete the local Bugs, Security and Compliance review.
