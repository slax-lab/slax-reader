## MODIFIED Requirements

### Requirement: Initialization covers every eligible identity

Article maintenance SHALL enumerate all eligible saved `(userId, bookmarkId)` pairs through bounded pages and MUST NOT replace history with recent-N sampling or globally deduplicate bookmark IDs across users. Subscribed-Collection preference SHALL require no user-vector initialization or backfill: a request SHALL enumerate all eligible subscriptions belonging to its authenticated user through bounded pages. Active users with subscriptions but no personal saves SHALL remain eligible for Collection recommendations.

#### Scenario: History exceeds multiple pages
- **WHEN** a user has more eligible saves or subscriptions than two page limits
- **THEN** the respective article refresh or request-time subscription calculation visits every selected page and does not label a truncated page as complete

#### Scenario: Two users share one source article
- **WHEN** both users own the same bookmark
- **THEN** each article profile uses its own article representative and neither user's enumeration suppresses the other

#### Scenario: Subscriber has never had a stored preference
- **WHEN** a user without personal saves or a stored Collection preference requests recommendations and has eligible subscriptions with visible vectors
- **THEN** the subscription preference can be computed without a user-profile backfill

### Requirement: Two user preferences remain independent

Saved-article and subscribed-Collection preferences SHALL remain independent and MUST NOT be alpha/beta-combined, copied into each other or exposed through user-neighbor search. The saved-article preference SHALL retain its `user-article` records. The subscribed-Collection preference SHALL be a request-local normalized sum of existing eligible Collection representatives, each normalized and included once with uniform weight; it SHALL NOT be read from or materialized to `u:<userId>:collection`. Own Collections and deleted, inactive or expired subscriptions SHALL be excluded under existing publication and entitlement rules. No per-member personal save SHALL be created.

#### Scenario: One preference is empty
- **WHEN** a user has saves but no eligible subscriptions
- **THEN** the article preference remains usable while the request-local Collection preference is unavailable without a zero vector or a fallback to article preference

#### Scenario: Subscription is cancelled
- **WHEN** the subscription action removes the relationship, or its entitlement expires, and the subsequent query observes that state
- **THEN** the next Collection-preference calculation excludes that Collection without changing personal saves or the Collection aggregate
- **AND** a cancellation flag alone does not override existing entitlement semantics

#### Scenario: Stored subscription preference is stale
- **WHEN** the user index contains an old `u:<userId>:collection` record
- **THEN** its existence and values do not affect the request-local preference

### Requirement: Exact private reads and honest projection state

Saved-article preferences SHALL retain exact authenticated-user native by-ID reads. A Collection-preference calculation SHALL derive its subscription set from the authenticated user and fetch only those eligible Collection IDs, not another user's stored profile. The user index SHALL not require unused query metadata indexes. Missing, invalid or zero-norm results SHALL remain explicitly unavailable or failed according to the available-input rules; no fabricated zero vector is permitted. Operational retrieval failures SHALL NOT be disguised as absent contributions. Existing article publication failures SHALL remain failed and retryable. Recommendation-time preference calculation SHALL perform no vector upsert, delete, embedding call, preference-state write or maintenance dispatch.

#### Scenario: Caller supplies another user ID
- **WHEN** an authenticated user supplies a different user's identity in a recommendation request
- **THEN** it does not authorize reading that identity's subscription set or private preference

#### Scenario: Publication fails
- **WHEN** an article aggregate computation succeeds but native publication fails
- **THEN** the operation reports failure and remains retryable rather than claiming the projection is current

#### Scenario: Collection sources become visible later
- **WHEN** owner maintenance has accepted a source-vector write but it is not yet visible to a recommendation read
- **THEN** the read uses the vectors actually returned and makes no claim of immediate or cross-store snapshot consistency
- **AND** a later request observes newly visible values without subscriber materialization

### Requirement: Committed mutation paths request maintenance

New capture/import maintenance SHALL be admitted in an explicit step of the existing processing/post-processing flow after original content is committed. Base bookmark/relation persistence SHALL NOT dispatch article or preference jobs, and SearchService semantic normalization SHALL NOT hide the admission side effect. Existing-content re-save, Fork and recovery SHALL enter the same post-processing responsibility without unnecessary source fetching.

REST and local-first star/unstar, deletion/restoration and publication changes SHALL request their existing article or owner Collection maintenance after business commit. Archive/unarchive alone SHALL remain neutral. The maintenance Workflow SHALL retain direct named article-processing, visibility and owner-preference/Collection steps. Collection-only events SHALL use the stored owner sharing-group aggregate under preference-incremental-maintenance without refreshing all owner articles or rebuilding usable state. Subscription-only changes SHALL NOT dispatch vector maintenance or materialize a user Collection preference. The existing subscription expiry-status maintenance and business analytics SHALL continue without subscriber-vector dispatch.

Article and Collection update targets MUST NOT enumerate subscribers or refresh their preferences, regardless of Collection-vector changes. Account deletion SHALL keep cleanup of the departing user's article vectors, owner Collection vectors and own legacy preference records, but MUST NOT enumerate other subscribers for preference refresh. No new scheduler, recommendation-time vector write or content/owner chain of child Workflows SHALL be introduced. Heavy maintenance work SHALL remain in the injected Service. Missed source dispatch and cross-store concurrency limitations SHALL remain explicit; this change does not add a queue, trigger, lock or lease platform. Legacy user/Collection-preference jobs SHALL remain consumable as cleanup-only tasks under the vector-bulk-sync compatibility contract.

#### Scenario: Collection content changes
- **WHEN** an article or publication update changes a Collection representation
- **THEN** only the existing owner maintenance runs without subscriber enumeration or preference writes
- **AND** a subscriber's next recommendation calculation uses that representation once it is visible and eligible

#### Scenario: A Collection has many subscribers
- **WHEN** the same Collection update is processed with zero, one or many subscriptions
- **THEN** its Workflow does not add subscriber enumeration or per-subscriber steps

#### Scenario: New bookmark relation precedes content capture
- **WHEN** a pending bookmark relation is created
- **THEN** no article or preference maintenance is dispatched by the base save method
- **AND** successful committed content later reaches the explicit maintenance post-processing step

#### Scenario: Old indexing fails during post-processing
- **WHEN** existing search embedding fails after original content is committed
- **THEN** the explicit new maintenance admission remains independent and does not re-fetch the source

#### Scenario: Subscription-only change
- **WHEN** a user subscribes, unsubscribes or deletes a subscription
- **THEN** the existing business action and analytics complete without a vector-maintenance dispatch
- **AND** subsequent recommendation reads use the updated relationship when visible to their eligibility query

#### Scenario: Subscription expires
- **WHEN** a subscription reaches its end time or the expiry job updates active status
- **THEN** the next eligibility query excludes it, without a subscription-preference Workflow

#### Scenario: Account deletion races with an old request
- **WHEN** a deleted account's earlier target is retried
- **THEN** current authoritative state denies recreation and unrelated users' vectors remain intact
- **AND** deletion still clears that account's own legacy Collection-preference key without refreshing other subscribers
