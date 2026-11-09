## Purpose

Keep user preferences usable when individual source vectors are absent, without hiding incomplete coverage or mistaking service failures for missing data.

## ADDED Requirements

### Requirement: User preferences aggregate available source vectors

Article and Collection user-preference refresh SHALL enumerate all eligible sources, skip absent vectors and compute from the available valid vectors. It SHALL publish only after the selected history has been processed. Existing weighting, normalization and identity rules SHALL remain unchanged. Article raw preference, centered preference and interest clusters SHALL use the same available source set. Refresh results and operator summaries SHALL report numeric `coverage.eligible`, `coverage.used`, and `coverage.missing`, with eligible equal to used plus missing after successful enumeration.

#### Scenario: One article vector is missing
- **WHEN** eligible history contains valid vectors and one absent article vector
- **THEN** the user preference is written from valid contributions and reports the skipped source in coverage, without invoking article regeneration

#### Scenario: A subscribed Collection vector is missing
- **WHEN** some eligible Collection vectors are unavailable and others are valid
- **THEN** the Collection preference is computed from the valid vectors with explicit partial coverage

#### Scenario: Missing source appears on an earlier page
- **WHEN** a page contains only missing vectors but later pages contain valid vectors
- **THEN** refresh continues through the complete eligible history and includes the later valid contributions

### Requirement: Absence never becomes fabricated or destructive success

If eligible sources exist but none has an available valid vector, refresh SHALL report failure with coverage and MUST NOT overwrite or delete an existing preference or create a zero vector. If eligible history itself is empty, existing stale-preference deletion SHALL remain. Operational retrieval errors, invalid vectors and publication failures SHALL remain failures; they MUST NOT be counted as absent source vectors. Collection representation aggregation SHALL retain its existing strict dependency behavior.

#### Scenario: All eligible vectors are absent
- **WHEN** a user has eligible history but every required source vector is absent
- **THEN** the old preference remains untouched and the result explicitly reports no usable preference vectors

#### Scenario: Eligible history is empty
- **WHEN** no eligible source remains
- **THEN** stale preference records are deleted with zero eligible, used and missing counts

#### Scenario: Storage read fails
- **WHEN** a source-vector read rejects or returns invalid vector data
- **THEN** the target reports failure without publishing a partially accumulated result or misreporting the error as missing data

#### Scenario: Collection representation lacks a member
- **WHEN** a Collection's own aggregate lacks an eligible article vector
- **THEN** its existing strict error behavior remains unchanged by this user-preference fix
