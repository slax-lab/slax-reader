# Spec Delta

## ADDED Requirements

### Requirement: Bounded concurrent article generation

The system SHALL process independent transcript chunks concurrently with at most five active chunks per article run.
It SHALL preserve source order, complete cue coverage, existing article access rules, and validation before publication.
Chunk context SHALL remain deterministic and SHALL NOT depend on another chunk's completion order.

#### Scenario: Multiple chunks are ready
- **WHEN** an article has at least five uncached chunks and sufficient budget
- **THEN** five chunks can start before any of those chunks completes
- **AND** no sixth chunk runs concurrently with them

#### Scenario: Results complete in another order
- **WHEN** later chunks finish before earlier chunks
- **THEN** the published article keeps source order and covers every source cue exactly once

#### Scenario: Translation follows editing
- **WHEN** the target language differs from the transcript language
- **THEN** each translation uses its own completed edit
- **AND** another chunk can proceed without waiting for that translation

### Requirement: Concurrent failure and budget safety

The system SHALL include active model-call reservations when it checks the run and lifetime spending limits.
It SHALL settle active work before finishing a failed run and SHALL retain successful chunk results for retry.
It SHALL NOT publish incomplete results or reset spending because processing becomes concurrent.

#### Scenario: Active calls reserve the remaining budget
- **WHEN** another call's reservation temporarily consumes the remaining budget
- **THEN** a waiting call rechecks the budget after settlement
- **AND** it does not spend against the same unreserved balance

#### Scenario: One chunk fails
- **WHEN** a chunk exhausts its retries while sibling chunks remain active
- **THEN** the run waits for those siblings before recording its final outcome
- **AND** it starts no later batch and preserves completed chunk caches

#### Scenario: A workflow resumes
- **WHEN** execution resumes with completed durable steps and stored chunk results
- **THEN** those completed calls are not charged or generated again
- **AND** new calls account for persisted spend and active reservations

#### Scenario: Existing article is ready
- **WHEN** a reader opens an existing ready article after deployment
- **THEN** the system retains that article without regeneration
