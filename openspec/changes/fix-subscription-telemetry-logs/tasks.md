# Tasks

A separate design document is intentionally omitted: this is a forward-only enum migration and a database-backed regression test, with no runtime code, architecture, dependency, or contract change.

## 1. Approval

- [x] 1.1 Record the requester's 2026-11-23 on-call instruction to make the minimal fix for the `[LogsService] failed to track auto_renew_off` alert and open a PR.

## 2. Implementation

- [x] 2.1 Add a logs migration adding `auto_renew_off`, `cancel` and `refund` to `event_kind`; confirm no runtime source change is needed because `SubscriptionTelemetryService` and `LogsService` already pass these values through.
- [x] 2.2 Add `apps/api/test/infra/subscriptionTelemetryLogs.test.ts`: apply every committed logs migration to in-memory PostgreSQL (PGlite), insert all three events through the real `LogsService`/`LogsRepo` SQL, read them back, and keep the silent-drop guard for an unregistered event name.

## 3. Verification

- [x] 3.1 Run the new database-backed test, the affected telemetry unit test, the API layer-architecture test, API typecheck and lint, and `openspec validate --all --strict`; record exact commands and results in `validation.md`.
- [x] 3.2 Confirm the migration is forward-only and additive (`ALTER TYPE ... ADD VALUE`) so it is compatible with code before and after it, and state the deployed-database gap in `validation.md`.
