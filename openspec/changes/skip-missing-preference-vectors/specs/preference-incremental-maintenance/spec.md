## Purpose

Keep user article preferences and owner Collection vectors current after each article event at a cost that does not grow with the owner's history, while publishing the same values a full recomputation would produce.

## ADDED Requirements

### Requirement: Article events update aggregates incrementally

An article event SHALL update the owner's article preference and the owner's Collection aggregate by removing that article's previously applied contribution and adding its current contribution, without enumerating the owner's eligible history, reading the recent action window or reading the vectors of other articles. If the article's own write fails, its previous contribution SHALL remain counted. The published raw and centered preference and the published Collection vector SHALL equal a full recomputation from current eligible rows within floating-point tolerance. Existing weights, eligibility rules, normalization, centering and partial-coverage reporting SHALL be unchanged. No article content SHALL be re-embedded to maintain an aggregate.

#### Scenario: A new save is added
- **WHEN** a user with existing preference state saves an article whose vector is written
- **THEN** the preference includes that article with weight one, reports one more eligible and used source, and neither the user's eligible history nor the recent action window is read

#### Scenario: Star, unstar, re-embed and delete
- **WHEN** a sequence of star, unstar, re-embed and delete events is processed for existing articles
- **THEN** after each event the published preference equals a full recomputation, and a re-embed or delete subtracts the handed-over previous vector without a rebuild

#### Scenario: The article write fails
- **WHEN** an article event's vector write fails
- **THEN** the aggregate is not changed and the article's previous contribution stays counted

#### Scenario: The last eligible article is removed
- **WHEN** an event removes the user's only eligible article
- **THEN** the user's preference records are deleted and the user's stored aggregate state is cleared

### Requirement: Aggregate state is rebuilt when it cannot be trusted

When an event finds no stored state, state built with a different embedding mean version, or an applied contribution that matches neither the current nor the handed-over previous article vector, maintenance SHALL rebuild that user's state once from current eligible rows and existing vectors, persist it, and continue incrementally afterwards. Full refresh requests SHALL rebuild and persist the same state. Existing published vectors SHALL remain valid inputs; deployment SHALL NOT require deleting them.

#### Scenario: First event after deployment
- **WHEN** a user without stored state has an article event
- **THEN** the preference is rebuilt from current rows once and the next event for that user is incremental

#### Scenario: Vector replaced outside the event path
- **WHEN** an article vector was replaced by a refresh that did not hand over the previous vector
- **THEN** the next event for that article rebuilds instead of subtracting the wrong contribution

### Requirement: Interest clusters are carried between rebuilds

Interest clusters SHALL be recomputed only when a user's state is rebuilt, from the same available article set as the raw and centered preference. An incremental event SHALL publish the stored clusters unchanged, except that a cluster whose medoid article is no longer counted SHALL be removed.

#### Scenario: A save does not recluster
- **WHEN** an incremental event adds a new article
- **THEN** the published clusters equal the stored clusters and no recent-action or recent-vector read occurs

#### Scenario: A medoid is deleted
- **WHEN** an incremental event removes the medoid article of a stored cluster
- **THEN** that cluster is no longer published

### Requirement: One user's maintenance is serialized

Maintenance calls for one user SHALL be processed one batch at a time, so that no applied contribution is lost or applied twice. Calls for different users SHALL NOT wait for each other. Calls that arrive while a batch runs MAY be combined into the next batch. Visibility verification SHALL succeed when the visible record carries the written content or a strictly newer published state, and a failed verification SHALL apply again and republish the current state.

#### Scenario: Several articles change at once
- **WHEN** events for several articles of one user apply concurrently
- **THEN** every event succeeds, the stored weights reflect all changes, the calls are combined into fewer batches than events, and the visible preference carries the newest state

#### Scenario: Visible record is older than the written state
- **WHEN** the visible preference carries an older state than the one an event wrote
- **THEN** visibility verification for that event fails, and applying again republishes the current state

### Requirement: Owner Collections share one strict aggregate

All Collections of one owner SHALL be published from a single owner aggregate maintained by article events. A published owner with an eligible member that has no available vector SHALL keep failing Collection publication with the missing dependency until the vector exists, after which the next event SHALL publish without a full rebuild. A Collection event SHALL rebuild the owner's aggregate so account share-setting changes are applied.

#### Scenario: Owner with two Collections
- **WHEN** a published owner with two Collections stars an article
- **THEN** both Collections are published with the same vector, which equals a full Collection refresh, without enumerating all members

#### Scenario: Member vector is missing
- **WHEN** a starred member of a published owner has no vector
- **THEN** each of the owner's Collections reports the missing dependency, and after the vector is written the next event publishes them
