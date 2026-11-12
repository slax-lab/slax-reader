## ADDED Requirements

### Requirement: Available contributions govern incremental publication

User and owner Collection projections SHALL use available valid eligible article contributions and report eligible, used and missing counts. Missing or malformed individual vectors SHALL NOT block valid contributions. When no valid contribution remains, stale projections SHALL be removed rather than treated as current or replaced with a zero vector. Operational retrieval and identity errors SHALL remain failures. This requirement supersedes earlier strict owner-Collection dependency and preserve-stale-on-zero coverage behavior.

#### Scenario: Partial Collection coverage
- **WHEN** a Collection has 617 eligible members and 614 available valid vectors
- **THEN** it publishes the aggregate of those 614 with missing count three, and a later repaired member is added incrementally

#### Scenario: Last valid member is removed
- **WHEN** remaining eligible members have no available valid vectors
- **THEN** obsolete user and Collection projections are removed without a fabricated zero vector or repeated content-failure retries

#### Scenario: One stored vector is malformed
- **WHEN** another eligible vector is valid
- **THEN** the malformed contribution is isolated and counted as unavailable while the valid contribution remains usable

### Requirement: Ordinary owner maintenance remains local to changed contributions

Once current owner state exists, ordinary save, star, unstar, share, replacement, deletion and repair SHALL update the affected contribution without full-history enumeration, old-vector recovery from the remote index, or full-member timestamp aggregation. Relation-only changes SHALL NOT depend on reading or embedding source content. Absent or incompatible owner state MAY bootstrap once. Explicit operator rebuild SHALL be separate from ordinary refresh.

#### Scenario: Old vector has been replaced
- **WHEN** a changed article's old remote vector is unavailable
- **THEN** maintenance subtracts its stored applied contribution and adds the current one without enumerating user history

#### Scenario: Share changes while original is missing
- **WHEN** an existing representative is available and only relation sharing or star weight changes
- **THEN** the owner projection updates without source-object reads or provider calls

#### Scenario: Publication time changes
- **WHEN** a member is changed or removed
- **THEN** the published Collection time reflects current contributing members without a full-member SQL aggregate

### Requirement: Interest metadata follows bounded incremental actions

The stored recent-action window SHALL update with saves, stars, deletions and repaired contributions, expire actions outside the existing window, and use the existing bounded clustering algorithm. It SHALL NOT freeze new actions until an unrelated full rebuild or scan full saved history during ordinary maintenance.

#### Scenario: A new interest is saved
- **WHEN** a new eligible article vector is applied to initialized owner state
- **THEN** its committed action enters the bounded recent window and interest metadata is recomputed from that window without a history scan

#### Scenario: A recent member is deleted
- **WHEN** the member is removed
- **THEN** its actions are removed and remaining recent members determine the clusters


## MODIFIED Requirements

### Requirement: Article preference is derived from current saved state

Article preference SHALL equal the normalized sum of available valid current eligible representatives, weighted once for a save and once more while starred. Initialized owner state SHALL retain applied contributions in its existing local store and update only changed identities. Replays SHALL replace rather than duplicate contributions. Unstar, delete, restore and replacement SHALL affect the next incremental update; archive alone SHALL remain neutral. No PostgreSQL vector-sum tables or new coordination platform is introduced.

#### Scenario: Repeated star and refresh
- **WHEN** a star event or publication is repeated
- **THEN** the resulting profile equals the current weighted aggregate without repeated additions or a history scan

#### Scenario: Archive without other mutation
- **WHEN** an eligible saved article is archived
- **THEN** its preference contribution remains unchanged

#### Scenario: Star adds one engagement action
- **WHEN** an eligible saved article is starred and later unstarred
- **THEN** its contribution changes from one to two and back to one without re-embedding

### Requirement: Article preference carries PinnerSage interest clusters

Article maintenance SHALL use the existing PinnerSage algorithm over available eligible actions in the existing 90-day, 2,000-action window, retaining at most 100 medoid/importance pairs and existing centering/calibration. Initialized state SHALL update article action timestamps locally and recompute only this bounded window, not freeze clusters or scan full saved history. Raw and centered profiles SHALL use the same available contributions.

#### Scenario: No recent actions
- **WHEN** no usable recent actions remain
- **THEN** interest metadata is empty without fabricating a vector

#### Scenario: A medoid save is deleted
- **WHEN** a medoid's save is deleted
- **THEN** the next incremental maintenance recomputes the bounded clusters without that article

### Requirement: Collection aggregation uses existing owner-member rules

A Collection SHALL aggregate available valid representatives under its existing owner/share/read boundaries, with uniform per-article influence and explicit partial coverage. Changes SHALL use the local applied contributions and indexed member publication times, without enumerating all owner members on ordinary publication. Missing members SHALL NOT prevent publication from other valid members.

#### Scenario: Owner removes the last eligible member
- **WHEN** no usable member remains
- **THEN** the old Collection projection is removed without a zero vector

#### Scenario: Different owners save the same source
- **WHEN** A and B save one source
- **THEN** each Collection uses its own private article identity and removal from A leaves B intact

### Requirement: Exact private reads and honest projection state

Preference reads SHALL preserve authenticated identity and native by-ID boundaries. Malformed individual source vectors SHALL be isolated from valid peers; operational retrieval failures and unexpected identities SHALL remain errors. No usable contributions SHALL cause explicit unavailability or removal of stale materialized projections rather than retaining a stale current profile. Failed publication SHALL remain retryable from the stored current aggregate without a routine full-history rebuild.

#### Scenario: Caller supplies another user ID
- **WHEN** an authenticated reader supplies a foreign identity
- **THEN** that identity does not authorize a private profile read

#### Scenario: Publication fails
- **WHEN** the aggregate is committed locally but its native projection write fails
- **THEN** retry republishes current state and verifies it without adding duplicate weights or rebuilding history


### Requirement: Initialization covers every eligible identity

Absent or incompatible owner state SHALL bootstrap all eligible saved identities through bounded pages without recent-N sampling or global bookmark deduplication. Once initialized, ordinary owner events SHALL only reconcile changed identities. Subscription preferences SHALL be read from current eligible Collection vectors at request time and MUST NOT require a materialized subscriber record.

#### Scenario: History exceeds multiple pages
- **WHEN** an uninitialized owner has more than two pages of saves
- **THEN** bootstrap includes all selected eligible rows and subsequent updates do not repeat that enumeration

#### Scenario: Two users share one source article
- **WHEN** two users save one source
- **THEN** their aggregates retain separate private identities

### Requirement: Two user preferences remain independent

Saved-article preference SHALL retain its authenticated user-article raw and centered identities. Subscribed-Collection preference SHALL be a request-local uniform aggregate of currently active eligible subscriptions, excluding own and inactive/expired Collections, without personal saves per member or materialized subscriber updates. These preferences MUST NOT be combined or copied into each other.

#### Scenario: One preference is empty
- **WHEN** a user has saved articles but no eligible subscriptions
- **THEN** article preference remains independent while Collection preference returns no usable vector

#### Scenario: Subscription is cancelled
- **WHEN** a subscription is cancelled or expires
- **THEN** the next request-local calculation excludes it without writes or article maintenance

### Requirement: Committed mutation paths request maintenance

Content capture and repair SHALL enter the existing maintenance Workflow after content commit or native acceptance, preserving current eligibility and owner identity. Star/unstar, individual share changes and deletion SHALL dispatch relation-only events after business commit, without requiring source readiness or embedding. Restore and new content continue through content processing. Collection status/default-share events SHALL publish existing group sums without rereading member bodies, member vectors, full-member timestamp SQL or recomputing owner interests. Archive alone remains neutral. Accepted article results SHALL be verified before applying owner state; each publication's write and visibility steps SHALL be independently retryable. No owner update SHALL enumerate subscribers or materialize their preferences. Account deletion SHALL prevent old jobs from recreating profiles.

#### Scenario: Collection content changes
- **WHEN** an article contribution changes
- **THEN** available owner aggregates update without subscriber enumeration or full-history rebuild

#### Scenario: A Collection has many subscribers
- **WHEN** the same owner event runs with different subscriber counts
- **THEN** the number of owner operations does not grow with subscriber count

#### Scenario: New bookmark relation precedes content capture
- **WHEN** a pending relation is created
- **THEN** content maintenance waits for committed content, while explicit later relation cleanup is not blocked by source status

#### Scenario: Old indexing fails during post-processing
- **WHEN** legacy search indexing fails after source commit
- **THEN** existing new-vector admission stays independent without origin refetch

#### Scenario: Subscription-only change
- **WHEN** a user subscribes, cancels or expires
- **THEN** request-time reads reflect current eligibility without dispatching vector maintenance

#### Scenario: Account deletion races with an old request
- **WHEN** an old publication is retried for a deleted account
- **THEN** current account state removes obsolete projections and clears owner state rather than recreating it
