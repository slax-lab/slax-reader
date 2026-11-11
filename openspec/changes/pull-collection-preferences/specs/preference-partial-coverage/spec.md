## MODIFIED Requirements

### Requirement: User preferences aggregate available source vectors

Article user-preference refresh and request-time subscribed-Collection preference calculation SHALL enumerate all selected eligible sources, skip absent vectors and compute from available valid vectors. They SHALL finish enumeration before publishing an article preference or using a Collection preference for recommendation. Existing weighting, normalization and identity rules SHALL remain unchanged. Article raw preference, centered preference and interest clusters SHALL use the same available source set. Article refresh results and operator summaries SHALL report numeric `coverage.eligible`, `coverage.used`, and `coverage.missing`. The read-only Collection-preference result SHALL retain the same internal coverage counters without exposing vectors or changing the client recommendation response. Eligible SHALL equal used plus missing after successful enumeration.

#### Scenario: One article vector is missing
- **WHEN** eligible history contains valid vectors and one absent article vector
- **THEN** the user article preference is written from valid contributions and reports the skipped source in coverage, without invoking article regeneration

#### Scenario: A subscribed Collection vector is missing
- **WHEN** some eligible Collection vectors are unavailable and others are valid
- **THEN** the request-local Collection preference uses the valid vectors, retains explicit internal partial coverage and does not write a user preference

#### Scenario: Missing source appears on an earlier page
- **WHEN** a page contains only missing vectors but later pages contain valid vectors
- **THEN** enumeration continues through all eligible sources and includes the later valid contributions

### Requirement: Absence never becomes fabricated or destructive success

For materialized article preferences, eligible sources with no available valid vector SHALL produce failure with coverage without overwriting/deleting an existing preference or creating a zero vector; empty article history SHALL retain stale-record deletion. For request-local Collection preferences, no eligible sources or all-absent vectors SHALL return no usable vector with internal coverage, causing the existing cold-start response without reading, overwriting or deleting a legacy stored preference. Operational retrieval errors and invalid vectors SHALL remain errors rather than absent-source counts; article publication failures SHALL remain failures. Collection representation aggregation SHALL retain strict dependency behavior. Cleanup-only legacy tasks are explicit retirement operations, not source-availability computations, and follow vector-bulk-sync rather than this non-destructive article refresh rule.

#### Scenario: All eligible vectors are absent
- **WHEN** all eligible article vectors are absent during article refresh
- **THEN** the old article preference remains untouched and the result explicitly reports no usable preference vectors

#### Scenario: All eligible Collection vectors are absent
- **WHEN** all eligible subscribed Collection vectors are absent during a recommendation read
- **THEN** the read reports no usable preference with internal used count zero and does not use or alter a legacy stored preference

#### Scenario: Eligible history is empty
- **WHEN** no eligible source remains
- **THEN** article refresh deletes stale article-preference records with zero coverage, while a read-only Collection-preference calculation returns no vector with zero coverage and performs no deletion

#### Scenario: Storage read fails
- **WHEN** a source-vector read rejects or returns invalid vector data
- **THEN** refresh or recommendation reports failure without publishing/using a partially accumulated result or misreporting the error as missing data

#### Scenario: Collection representation lacks a member
- **WHEN** a Collection's own aggregate lacks an eligible article vector
- **THEN** its existing strict error behavior remains unchanged by this preference-read change
