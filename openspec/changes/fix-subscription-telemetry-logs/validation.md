# Validation

## Scope and approval

The requester asked in the on-call thread on 2026-11-23 to make the minimal fix for the `[LogsService] failed to track auto_renew_off` alert and open a PR. The alert was reported once at 18:05 from `SubscriptionJob.recoverPayments`; the monitor's sample and the Worker logs show the same stack ending at `LogsRepo.insertLog`.

## Root cause

`SubscriptionTelemetryService.deliver` passes the subscription action (`auto_renew_off`, `cancel` or `refund`) as the `user_logs.event_name`. That column is the PostgreSQL `event_kind` enum, which contained none of the three values. PostgreSQL rejected every insert with `invalid input value for enum event_kind: "<action>"`, and `LogsService.track` catches and logs the failure by design, so payment recovery succeeded while the telemetry rows were dropped.

## Running-environment evidence

The new test `apps/api/test/infra/subscriptionTelemetryLogs.test.ts` applies every committed migration under `apps/api/prisma/logs_migrations` to in-memory PostgreSQL (PGlite) and writes through the real `LogsService`/`LogsRepo` SQL:

- With this change: `auto_renew_off`, `cancel` and `refund` each inserted and read back as one row with `user_id = 7`, `status = success` (`pnpm api -- test test/infra/subscriptionTelemetryLogs.test.ts`: 2 tests passed).
- Negative control: temporarily hiding the new migration directory and rerunning the test reproduced the production failure exactly: `invalid input value for enum event_kind: "auto_renew_off"` (also `cancel`, `refund`), zero rows, and the test failed on `expected [] to deeply equal [...]`. The directory was restored before committing.

The deployed logs database was not touched: this container has no PostgreSQL access and production is read-only. Deployment will apply the migration through `pnpm api -- migration:deploy:logs`; the migration only adds enum values, so it is compatible with code before and after it.

## Automated checks

- `pnpm api -- test test/infra/subscriptionTelemetryLogs.test.ts`: 2 passed, including the unchanged silent-drop guard for an unregistered event name.
- `pnpm api -- test test/domain/subscriptionTelemetry.test.ts test/script/layerArchitecture.test.ts`: 68 passed.
- `pnpm api -- gen:model`: passed with placeholder loopback database URLs; generated clients changed only under ignored `node_modules`.
- `pnpm api -- typecheck`: passed after generating the Prisma clients.
- `pnpm api -- lint`: 0 errors, 335 pre-existing warnings.
- `pnpm exec prettier --check test/infra/subscriptionTelemetryLogs.test.ts`: passed.
- `pnpm exec openspec validate --all --strict`: 169 passed, 0 failed.
- `git diff --check`: passed.

## Gaps and boundaries

- No deployed Worker or database was changed; the migration's effect in beta and production is a deployment step outside this PR.
- The real cron run that produced the alert was not replayed against production. The same `LogsService`/`LogsRepo` insert path and the same committed migrations are exercised locally on a real PostgreSQL engine.
- Telemetry rows already rejected before the migration stay lost; the proposal excludes a backfill because those rows were never persisted.
- No CLI, Extension, Mobile, contract, dependency, or shipped-asset change, so no package-version decision applies.

## Local review

Completed the three `REVIEW.md` passes on this branch on 2026-11-23. No Important findings.

- Bugs: the migration adds exactly the three event names the telemetry code can emit; `LogsService` and `SubscriptionTelemetryService` are untouched, so best-effort recording and payment outcomes are unchanged. The test needs no rollback because it runs on a disposable in-memory database, and the unregistered-event guard confirms the insertion path still reports missing enum values.
- Security: no new dependency, secret, network destination, user data, or log payload. The migration is additive and forward-only.
- Compliance: the diff matches `openspec/changes/fix-subscription-telemetry-logs`; the delta scenarios are covered by the new test and the unchanged telemetry unit test; the deployed-database gap is declared above; the PR targets `dev` and does not merge, deploy, or apply a remote migration.
