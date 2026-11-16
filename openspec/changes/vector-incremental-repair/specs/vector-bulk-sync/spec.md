## ADDED Requirements

### Requirement: Article repair converges downstream through the incremental path

An accepted explicit article repair SHALL arrange owner user and Collection maintenance through the existing idempotent Workflow after article visibility. It SHALL NOT require an operator to rebuild the user's entire history separately or enumerate Collection subscribers. A propagation dispatch failure SHALL remain explicit and must not be reported as complete downstream convergence.

#### Scenario: A previously missing member is repaired
- **WHEN** explicit article repair accepts a new representative
- **THEN** the existing Workflow verifies it and incrementally updates owner projections without subscriber fan-out

#### Scenario: Repair is repeated
- **WHEN** the same article repair is submitted again
- **THEN** current-state maintenance does not add duplicate contribution weight or unnecessarily re-embed unchanged usable sources


## MODIFIED Requirements

### Requirement: Article refresh affects one private article only

`POST /v1/bookmark/vector/refresh` SHALL accept exactly `{user_id, bookmark_id}` with positive safe integers and synchronously process only that private identity using current authoritative state. After native acceptance it SHALL enqueue its receipt on the existing maintenance Workflow for visibility and incremental owner-user/Collection propagation. It MUST NOT re-embed another identity, enumerate subscribers, or claim downstream completion from article acceptance. Invalid bodies remain rejected and dispatch failure remains explicit.

#### Scenario: Two users saved one source
- **WHEN** the request specifies A's identity
- **THEN** only A's article is processed and its existing Workflow updates only A's owner projections, leaving B and subscribers unchanged

#### Scenario: Invalid multi-target body
- **WHEN** the body contains arrays, unknown keys or legacy fields
- **THEN** it is rejected before processing

### Requirement: Each user preference is refreshed directly by user ID

Both preference endpoints SHALL retain the existing `{user_id}` authentication/body contract. Article-preference refresh SHALL publish the current owner aggregate, bootstrapping absent/legacy state once, without rebuilding initialized history or embedding source articles. Collection-preference refresh remains cleanup-only for the retired legacy record; live subscription preference is calculated on demand. Zero usable inputs SHALL clear stale materialized article projections, never create zero vectors.

#### Scenario: User has no eligible subscriptions
- **WHEN** a legacy Collection-preference task is submitted
- **THEN** it clears only the obsolete materialized record without aggregating subscriptions

#### Scenario: Source vector is missing
- **WHEN** eligible inputs include missing and valid vectors
- **THEN** the current aggregate publishes available valid coverage without recursively generating missing sources

### Requirement: The caller sends targets sequentially

The operator caller SHALL use parameterized bounded read-only enumeration and at most one outstanding request. Stages remain article, article-preference and Collection; subscription materialization is retired. Existing identities, scope filters and cursor behavior SHALL remain unchanged. An article repair's downstream Workflow does not authorize re-embedding unrelated articles or subscriber fan-out.

#### Scenario: User has many subscriptions
- **WHEN** subscription materialization is requested
- **THEN** the retired stage is rejected before data or network access

#### Scenario: Earlier request has not completed
- **WHEN** a caller request is in flight
- **THEN** the caller does not start another HTTP task request
