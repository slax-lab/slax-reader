## REMOVED Requirements

### Requirement: Bounded cost

**Reason**: The business caps on duration, text volume, chunk count, estimated or accumulated spend, daily site spend and daily user starts rejected otherwise eligible work. Cost accounting, provider deadlines, bounded retries and concurrency controls remain.

**Migration**: No data or schema migration. The replacement requirement covers explicit owner recovery of records stopped by a removed cap; historical records are not requeued automatically.

## ADDED Requirements

### Requirement: Generation without business caps

The system SHALL process otherwise eligible podcast episodes without rejecting or deferring them because of media duration, total text length, total chunk count, estimated cost, accumulated per-run or lifetime cost, site daily spend, or user daily starts. Cost accounting SHALL continue. Provider request deadlines, finite retry and repair attempts, concurrency controls, leases, access rules, moderation, and validation SHALL remain enforced.

#### Scenario: Work exceeds former caps
- **WHEN** otherwise eligible work exceeds any former cap (3 hours, 80 chunks, $1 per episode, $30 per day, or 5 new episodes per user per day)
- **THEN** those values do not prevent generation or interrupt accepted work

#### Scenario: Owner retries a cap rejection
- **WHEN** an authorized owner explicitly requests generation or retry of work previously skipped or failed solely because of a removed length or budget cap
- **THEN** the work can be queued again with accumulated spend preserved
- **AND** historical records are not automatically bulk-requeued

#### Scenario: Provider stalls or concurrency is full
- **WHEN** a provider request stalls or available workflow concurrency is exhausted
- **THEN** request deadlines and existing deferred-start behavior still apply

#### Scenario: Sixth new episode of the day
- **WHEN** an owner saves the sixth otherwise eligible new episode in one UTC day
- **THEN** the former daily quota does not prevent the workflow from starting
