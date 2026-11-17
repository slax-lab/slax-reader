# Design

## Context

See proposal.md for the requested terminal-failure policy. The current implementation has two replay paths: UserDeletionJob scans deleted accounts every five minutes, and UserDeletionConsumer rethrows cleanup failures before the generated queue handler acknowledges the message. cleanupUserData dispatches article, Collection, and preference Workflows before database deletion, so every replay repeats that dispatch under new UUIDs. The cron's success marker expires after 31 days and its cursor eventually wraps, allowing successful accounts to re-enter cleanup too.

The initial HTTP action commits the deleted-account state and revokes access separately from physical cleanup. The queue dispatcher acknowledges a message after its consumer returns. Generated DI and cron registration are owned by the normal backend generator.

## Goals / Non-Goals

**Goals:** Remove both application-driven account-cleanup replay paths using existing handlers and acknowledgement behavior. Keep normal account revocation and unrelated cron/queue flows intact.

**Non-Goals:** No exactly-once platform, cleanup ledger, TTL replacement, queue-wide policy change, schema migration, generic circuit breaker, or production data repair. Ordinary finite retries inside an already-created Workflow are not account-cleanup replay and are unchanged by this change.

## Decisions

1. Delete UserDeletionJob and regenerate registration with the documented backend generator. Removing this specific job leaves other handlers on the shared five-minute cron working. Disabling that shared Cloudflare trigger would also disable payment/media recovery and is therefore unsuitable.
2. Retain the queue consumer's initial cleanup call. Its catch logs the failure and returns, allowing the existing per-message dispatcher to acknowledge it and continue. Do not change the shared queue handler or suppress unrelated consumer failures.
3. Keep the service's existing failure propagation and operation order. The queue boundary owns the terminal policy; changing the service would hide failures from direct callers and tests. Repairing deletion ordering is a separate change under the requester's direction to leave failed cleanup alone.
4. Preserve deletion tombstones, credential revocation, session disconnection, and deleted-account read/write checks. Physical cleanup and account access remain distinct. No state is restored when cleanup is abandoned.

## Risks / Trade-offs

- Residual personal data and vectors can remain after failure. The policy deliberately trades automatic physical-erasure completion for bounded background work; the existing deleted-account access boundary must still hold.
- At-least-once queue transport can independently redeliver after infrastructure interruption. This change prevents application-requested retry on a handled cleanup failure; it does not promise transport exactly-once execution or introduce deduplication storage.
- Workflows already created before rollout can finish their existing finite work. Removing their producer does not cancel them or erase existing step charges.
- Both beta and production currently produce cleanup Workflows. Updating only one environment leaves the other producer running.
- Restoring the removed cron during rollback would resume historical cleanup and costs. Rollback requires an explicit release decision acknowledging that consequence.

## Migration Plan

No database migration or cleanup run. After proposal review, implement and verify in an isolated runtime, regenerate backend artifacts, and deliver one task PR to dev. Release through the existing human-controlled promotion process to beta and production. Then compare new vector-maintenance admissions and account-recovery logs over at least two former five-minute intervals; record legitimate new user operations separately. Do not disable the shared cron, edit secret configuration, replay old deliveries, or delete residual records as verification.
