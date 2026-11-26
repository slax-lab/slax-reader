# Proposal

## Why

Subscription payment telemetry writes the subscription action as the `user_logs.event_name` value. `user_logs.event_name` is the PostgreSQL `event_kind` enum, and that enum has no `auto_renew_off`, `cancel` or `refund` value. PostgreSQL rejects each insert, and `LogsService.track` catches and logs the failure by design, so payment recovery succeeds while those telemetry rows are silently lost.

On 2026-11-23 the monitor reported `[LogsService] failed to track auto_renew_off` from `SubscriptionJob.recoverPayments`. The same code path enqueues `cancel` for a deleted subscription and `refund` for a refund; both hit the same missing enum values.

## What Changes

- Add `auto_renew_off`, `cancel` and `refund` to the logs `event_kind` enum with a forward-only migration. The migration only widens the enum, so it is compatible with code before and after it.
- Keep `LogsService.track` and payment recovery unchanged: telemetry remains best-effort, and a logs write failure must not fail a payment operation.
- Add database-backed integration coverage that inserts all three events through `LogsService` and reads them back, so a future enum gap fails a test instead of only the monitor.

## Capabilities

### New Capabilities

- `subscription-lifecycle-telemetry`: Durable recording of cancellation, auto-renew-off and refund telemetry in `user_logs`.

### Modified Capabilities

None.

## Impact

- API: one logs migration and one integration test. No runtime source, contract, client, dependency, or generated artifact changes.
- No production data rewrite and no backfill: the rows rejected before the migration were never persisted.
- The migration must be applied to the logs database before code that records these events ships; the current code already records them, so no ordering risk is added by this change.

## Non-goals

- No change to GA4 reporting, dashboard queries, payment recovery retries, or `LogsService` failure handling.
- No recovery or reconstruction of telemetry rows already dropped.

## Approval and delivery

The requester asked in the on-call thread on 2026-11-23 to make the minimal fix for this alert and open a PR. Delivery is a task pull request targeting `dev`; no deployment, remote migration, or production write is part of it.
