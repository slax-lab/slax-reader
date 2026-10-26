# bookmark-vector-indexing Specification

## Purpose
Maintain one stable vector index shard mapping per bookmark so repeated or concurrent indexing tasks can locate and update the same vector index.

## Requirements

### Requirement: Atomic shard mapping allocation

The system SHALL allocate at most one vector shard mapping per bookmark. Concurrent allocation attempts for the same bookmark SHALL return the same persisted row identity and bucket without a uniqueness failure caused by competing bookmark mappings.

#### Scenario: First allocation
- **WHEN** indexing requests a mapping for a bookmark without one
- **THEN** the system persists the proposed bucket and returns the mapping's row identity, bookmark ID, bucket, and timestamp

#### Scenario: Competing first allocations
- **WHEN** multiple indexing tasks request an absent bookmark mapping with different proposed buckets
- **THEN** every successful allocation returns the same persisted row identity and winning bucket, exactly one mapping exists, and competing allocations do not fail with a bookmark uniqueness violation

### Requirement: Existing mapping compatibility

The system SHALL preserve an existing mapping's row identity and bucket when indexing runs again, refresh its timestamp, and return the stored mapping. Database failures unrelated to competing bookmark mappings MUST remain observable to the caller.

#### Scenario: Reindexing proposes another bucket
- **WHEN** a bookmark with an existing mapping is indexed with a different proposed bucket
- **THEN** the existing row identity and bucket remain unchanged and its refreshed timestamp is returned

#### Scenario: Database write fails
- **WHEN** the database cannot persist a shard mapping
- **THEN** the allocation fails for the caller rather than returning a fabricated mapping or reporting success
