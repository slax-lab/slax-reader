## Purpose

Keep user article preferences and owner Collection vectors current after each article event at a cost that does not grow with the owner's history, while publishing the same values a full recomputation would produce.

## ADDED Requirements

### Requirement: Article events update aggregates incrementally

An article event SHALL update the owner's article preference and the owner's Collection aggregate by removing that article's previously applied contribution and adding its current contribution, without enumerating the owner's eligible history or reading the vectors of articles outside the recent interest window. Interest clusters MAY still read the vectors of the recent action window used for clustering. If the article's own write fails, its previous contribution SHALL be restored rather than dropped. The published raw and centered preference and the published Collection vector SHALL equal a full recomputation from current eligible rows within floating-point tolerance. Existing weights, eligibility rules, normalization, centering and partial-coverage reporting SHALL be unchanged. No article content SHALL be re-embedded to maintain an aggregate.

#### Scenario: A new save is added
- **WHEN** a user with existing preference state saves an article whose vector is written
- **THEN** the preference includes that article with weight one, reports one more eligible and used source, and the user's eligible history is not enumerated

#### Scenario: Star, unstar, re-embed and delete
- **WHEN** a sequence of star, unstar, re-embed and delete events is processed for existing articles
- **THEN** after each event the published preference equals a full recomputation and the user's full history is not enumerated

#### Scenario: The article write fails
- **WHEN** an event removed an article's contribution and the article write then fails
- **THEN** the article's previous contribution is restored and the preference keeps counting it

#### Scenario: The last eligible article is removed
- **WHEN** an event removes the user's only eligible article
- **THEN** the user's preference records and stored aggregate state are deleted

### Requirement: Aggregate state is rebuilt when it cannot be trusted

When an event finds no stored aggregate, an aggregate built with a different embedding mean version, or an applied contribution that no longer matches the stored article vector, maintenance SHALL rebuild that target once from current eligible rows and existing vectors, persist it, and continue incrementally afterwards. Full refresh requests SHALL rebuild and persist the same state. Existing published vectors SHALL remain valid inputs; deployment SHALL NOT require deleting them.

#### Scenario: First event after deployment
- **WHEN** a user without stored state has an article event
- **THEN** the preference is rebuilt from current rows once and the next event for that user is incremental

#### Scenario: Vector replaced outside the event path
- **WHEN** an article vector was replaced by a refresh that did not update the aggregate
- **THEN** the next event for that article rebuilds instead of subtracting the old contribution with the new vector

### Requirement: Concurrent events converge without failing visibility

Concurrent events for one target SHALL serialize their state changes so that no applied contribution is lost or applied twice. An event whose state is no longer the newest SHALL not publish over a newer one. Visibility verification SHALL succeed when the visible record carries the written content or a strictly newer published state.

#### Scenario: Several articles change at once
- **WHEN** events for several articles of one user are processed concurrently
- **THEN** every event succeeds, the stored weights reflect all changes, and the visible preference carries the newest state version

#### Scenario: Visible record is older than the written state
- **WHEN** the visible preference carries an older state than the one an event wrote
- **THEN** visibility verification for that event fails

### Requirement: Owner Collections share one strict aggregate

All Collections of one owner SHALL be published from a single owner aggregate maintained by article events. A published owner with an eligible member that has no available vector SHALL keep failing Collection publication with the missing dependency until the vector exists, after which the next event SHALL publish without a full rebuild.

#### Scenario: Owner with two Collections
- **WHEN** a published owner with two Collections stars an article
- **THEN** both Collections are published with the same vector, which equals a full Collection refresh, without enumerating all members

#### Scenario: Member vector is missing
- **WHEN** a starred member of a published owner has no vector
- **THEN** each of the owner's Collections reports the missing dependency, and after the vector is written the next event publishes them
