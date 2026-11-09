## RENAMED Requirements

- FROM: `### Requirement: Bounded cost`
- TO: `### Requirement: Generation without business caps`

## MODIFIED Requirements

### Requirement: Generation without business caps

The system SHALL process otherwise eligible YouTube articles without rejecting or deferring them because of media duration, total text length, total chunk count, estimated cost, accumulated per-run or lifetime cost, site daily spend, or user daily starts. Cost accounting SHALL continue. Provider request deadlines, finite retry and repair attempts, concurrency controls, leases, access rules, moderation, and validation SHALL remain enforced.

#### Scenario: Work exceeds former caps
- **WHEN** otherwise eligible work exceeds any former cap (6 hours, 400,000 characters, 40 chunks, $1 per run, $2 lifetime, $20 per day, or 20 automatic / 5 manual starts per user per day)
- **THEN** those values do not prevent generation or interrupt accepted work

#### Scenario: Owner retries a cap rejection
- **WHEN** an authorized owner explicitly requests generation or retry of work previously skipped or failed solely because of a removed length or budget cap
- **THEN** the work can be queued again with accumulated spend preserved
- **AND** historical records are not automatically bulk-requeued

#### Scenario: Provider stalls or concurrency is full
- **WHEN** a provider request stalls or available workflow concurrency is exhausted
- **THEN** request deadlines and existing deferred-start behavior still apply

#### Scenario: Daily automatic limit
- **WHEN** an owner triggers the 21st otherwise eligible automatic start in a UTC day
- **THEN** generation starts without returning `limit_reached` because of that count

#### Scenario: Save-triggered start over the limit
- **WHEN** an owner saves an otherwise eligible video after 20 automatic starts that day
- **THEN** the former daily quota does not prevent its workflow from starting

#### Scenario: Site-wide budget
- **WHEN** recorded site-wide spend exceeds the former daily budget
- **THEN** generation continues without a budget deferral or a budget-pause alert

#### Scenario: Long video automatic admission
- **WHEN** a video longer than four hours meets the remaining language, speech-density, and readability rules
- **THEN** it is eligible for automatic generation and duration alone does not send it to manual review
