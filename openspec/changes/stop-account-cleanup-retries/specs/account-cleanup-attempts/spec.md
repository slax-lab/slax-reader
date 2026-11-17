# Spec Delta

## Purpose

Bound automatic physical account cleanup to its initial best-effort delivery so cleanup failures cannot repeatedly generate background work or undo access revocation.

## ADDED Requirements

### Requirement: Account cleanup failures are terminal for automatic processing

After an explicit account deletion has committed, its initial background cleanup delivery SHALL attempt cleanup. A cleanup failure SHALL be recorded and the delivery SHALL be consumed without requesting redelivery, re-enqueueing cleanup, or starting another account-cleanup attempt. Processing later valid messages in the same batch SHALL continue after a handled cleanup failure. Residual data SHALL remain untouched by an automatic retry of that failed cleanup attempt.

#### Scenario: Initial cleanup fails after vector work was dispatched
- **WHEN** the initial account cleanup has dispatched vector maintenance and a later cleanup operation fails
- **THEN** the failure is recorded and the queue delivery is acknowledged without re-running cleanup or dispatching that vector batch again because of the failure

#### Scenario: A batch contains a failed cleanup and another deletion
- **WHEN** cleanup for one delivery fails and a later delivery in the batch is valid
- **THEN** the failed delivery is consumed and the later delivery still receives its initial cleanup attempt

### Requirement: Deleted accounts are not scanned for cleanup recovery

Scheduled processing SHALL NOT enumerate deleted accounts to resume, repeat, or repair physical account cleanup. Existing failed accounts, successful accounts, and expired or absent historical completion markers SHALL NOT cause account-cleanup invocations or new vector-maintenance Workflows through such recovery processing.

#### Scenario: A previously failed account remains deleted
- **WHEN** scheduled processing runs after an earlier account cleanup failed
- **THEN** that account is not cleaned again and no vector-maintenance batch is created for account recovery

#### Scenario: A historical completion marker expires
- **WHEN** a previously completed account has no retained completion marker
- **THEN** no periodic account-cleanup recovery is started

### Requirement: Physical cleanup failure preserves account revocation

A handled physical-cleanup failure SHALL NOT restore the deleted account, reinstate its credentials or sessions, bypass existing deleted-account access checks, or report a new cleanup success. Existing account-deletion admission checks and the committed revocation boundary SHALL remain unchanged.

#### Scenario: Database cleanup fails
- **WHEN** physical database cleanup fails after the account has been marked deleted and access revoked
- **THEN** the account remains deleted and inaccessible while residual rows, objects, or vectors may persist without automatic recovery
