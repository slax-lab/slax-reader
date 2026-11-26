# Proposal

## Why

PowerSync phase timings reach the Reader event lake only through the API's `/events` route, while the errors they describe go straight from the client to `client_errors.errors`. The change requester wants the timings in the same client lake, sent directly by Web and Mobile without the API in the path, so the monitor can read error counts and average PowerSync latency from one table and post a PowerSync telemetry card.

Separately, the client error pipelines filtered on `occurred_at` against `now()`, which Basin Pipelines evaluates once at pipeline creation. Every pipeline therefore dropped all records that occurred more than a day after it was created; production Web lost its records from 2026-11-25 08:51 UTC until the pipelines were replaced. The replacement merged Web and Mobile into one stream and pipeline per environment, so Mobile must send to that stream.

## What Changes

- The shared client collector gains `telemetry(event, properties, label)`. Each call becomes its own `client_errors.errors` row with `kind = 'telemetry'`, `count = 1`, the same identity, release, environment and page context as error records, and its numeric properties intact. Observations are never merged, counted or backed off like errors, and they are bounded per flush and per session.
- Web and Mobile send `powersync_phase` and `powersync_connection_lost` through the collector instead of `/events`. The phase vocabulary, properties and emission points are unchanged, except that the failure join key is named `error_fingerprint` so it cannot be confused with the row's own `fingerprint` column.
- Mobile records carry `page_url` as `slaxreader://<route>[/<id>]`, keeping only the record id of routes that show one record (`slaxreader://reader/<bookmarkId>`). `properties.screen` remains.
- Mobile release builds send to the single production client stream (the Web stream endpoint).
- Operator infrastructure, already applied: each environment has one client stream and one pipeline with a Web branch and a Mobile branch, both admitting `kind = 'telemetry'`, the Mobile branch admitting `slaxreader://` page addresses, and no `now()` window. The separate Mobile streams and pipelines are deleted.

## Capabilities

### Modified Capabilities

- `powersync-client-telemetry`: observations go to `client_errors.errors` as `telemetry` rows sent directly by the client.
- `client-error-logs`: the collector records telemetry rows, Mobile carries a `slaxreader://` page address, and admission is one pipeline per environment without a creation-time window.

## Impact

Web PowerSync plugin and shared error collector, Mobile data runtime, error-log adapter, navigation route reporting and build configuration. Consumers that count client errors must exclude `kind = 'telemetry'`; the monitor makes that change, and adds a PowerSync telemetry card, before this ships. The `/events` route and the Reader event lake are unchanged and simply stop receiving these two event names.

## Sequencing

`client-error-diagnostics` (merged, not yet archived) adds the requirements this change modifies, so it is archived first and this change after it.

## Non-goals

Backfilling earlier `/events` observations, changing the phase vocabulary or emission points, Extension telemetry, and recovering records the old pipelines dropped.

## Version decision

Mobile ships this code; whether to increment its `version` or `buildNumber` is the change requester's decision before delivery. Web deploys without a package version.
