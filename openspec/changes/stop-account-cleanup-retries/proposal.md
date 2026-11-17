# Proposal

## Why

The account-deletion recovery cron recreates vector-maintenance Workflows whenever database cleanup fails, producing recurring step charges after the original work has finished. The change requester wants failed account cleanup to stop permanently rather than be retried automatically.

## What Changes

- Remove the scheduled deleted-account recovery job, including its generated registration, so previously failed or completed accounts are never replayed by that scan.
- Keep the initial cleanup delivery from an explicit account-deletion request. If cleanup fails, log the failure and consume that queue delivery without requesting redelivery or restarting cleanup.
- Preserve the committed deletion tombstone and immediate credential/session revocation even when physical cleanup remains incomplete.
- Leave residual data in place after failure; do not add recovery storage, retries, a new scheduler, or a repair run.
- Document the cost investigation and verification boundaries. Other capture, media, and vector-maintenance behavior is outside this implementation's scope.

## Capabilities

### New Capabilities

- `account-cleanup-attempts`: One best-effort account cleanup attempt with terminal failure, no scheduled recovery, and preserved account revocation.

### Modified Capabilities

None. Existing snapshot best-effort deletion and access-revocation requirements continue to apply; this capability owns account-cleanup dispatch and failure replay.

## Impact

- API: `handler/cron/userDeletionJob.ts`, `handler/queue/userDeletionConsumer.ts`, generated DI/cron registration, related tests, and account-deletion operational guidance.
- No database migration, dependency change, client/API response change, or UI change is intended.
- Deployment must reach both production and beta to stop both observed producers. This proposal does not deploy, cancel existing Workflows, change shared cron schedules, or delete production data.
- Failed cleanup may retain private database rows, objects, and vectors. The account remains deleted and inaccessible; no automatic physical-erasure guarantee is claimed.

## Non-goals

Do not repair the failed deletion ordering, clean existing residual data, disable unrelated cron tasks, change ordinary Workflow step retry policies, or add a general budget platform. Those require separate scope decisions.

## Review and implementation authorization

On 2026-11-16 the change requester approved implementing the terminal account-cleanup policy and requested a PR on `feat/fix-error-cronjob`. This explicit branch name overrides the default task-name suffix. Read-only dashboard inspection confirmed beta and production share the same production vector indexes; the duplicate account-recovery cron is removed from both builds. Beta's live maintenance Workflow remains necessary for beta-originated mutations and is not deleted or redirected to a different environment's preference state. No production resource deletion or deployment is part of this task PR.
