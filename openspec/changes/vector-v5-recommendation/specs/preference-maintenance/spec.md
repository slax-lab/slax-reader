## Purpose

Materialize independent saved-article and subscribed-Collection preferences from current eligible business history, reusing existing Collection ownership without new persistence structures.

## ADDED Requirements

### Requirement: Initialization covers every eligible identity

Maintenance SHALL enumerate all eligible saved `(userId, bookmarkId)` pairs and active existing subscriptions through bounded pages. It MUST NOT replace history with recent-N sampling or globally deduplicate bookmark IDs across users. Active users with only subscriptions or with no history SHALL still have both preference targets considered.

#### Scenario: History exceeds multiple pages
- **WHEN** a user has more eligible saves or subscriptions than two page limits
- **THEN** refresh visits the complete selected history and does not label a truncated page as a complete profile

#### Scenario: Two users share one source article
- **WHEN** both users own the same bookmark
- **THEN** each profile uses its own article representative and neither user's enumeration suppresses the other

### Requirement: Article preference is derived from current saved state

Article preference SHALL be recomputed from the user's current eligible article representatives as their normalized sum weighted by engagement actions, ZoRRO's history term at `λh = 0`: one action for the save and one more while the identity is starred. The weight is that count; no other weight is permitted. Each saved identity contributes once regardless of chunks, images or PDF pages. Repeated refresh SHALL replace the result without adding duplicate weight. Unstar, delete, restore and content replacement SHALL affect the next recomputation; archive alone SHALL remain neutral. The system MUST NOT introduce applied-contribution or raw-vector-sum tables.

#### Scenario: Repeated star and refresh
- **WHEN** a star operation or refresh request is repeated
- **THEN** the resulting profile equals recomputation from one current saved relation rather than repeated additions

#### Scenario: Archive without other mutation
- **WHEN** a user archives an eligible saved article
- **THEN** its preference contribution remains unchanged

#### Scenario: Star adds one engagement action
- **WHEN** a user stars an eligible saved article
- **THEN** that identity contributes twice its unstarred representative to the preference sum, and unstarring restores a single contribution

### Requirement: Article preference carries PinnerSage interest clusters

Article-preference refresh SHALL also compute the user's PinnerSage clusters as `design.md` 6.2 defines: Ward clustering by Algorithm 1 over the distinct articles of the user's engagement actions from the last 90 days (at most the 2,000 most recent actions), with `α` calibrated as recorded in `validation.md`, medoid representatives, and importance with `λ = 0.01` per day summed over every action in a cluster. It SHALL store at most 100 `[medoidBookmarkId, importance]` pairs on the same `user-article` record and include them in write verification. It MUST NOT add tables, a scheduler or a separate index. The full-history profile is not replaced by this windowed input. Once representation centering (`design.md` 6.6) is enabled, clustering uses centered representatives with the centered-space `α_c`, and the same refresh writes and verifies the centered profile record `u:<id>:article:centered` next to the raw profile.

#### Scenario: No recent actions
- **WHEN** a user has no eligible save within 90 days, or none merges within `α`
- **THEN** the stored cluster list is empty and recommendation uses the other candidate sources

#### Scenario: A medoid save is deleted
- **WHEN** the save that is a cluster's medoid is deleted
- **THEN** the next article-preference refresh recomputes clusters without it

### Requirement: Collection aggregation uses existing owner-member rules

A Collection SHALL aggregate current eligible article representatives belonging to its existing owner and membership policy. Public eligibility SHALL additionally follow the existing publish/share/read boundary. Removal, content replacement and access revocation SHALL cause recomputation without source-managed identities, synthetic owners or new membership tables. Chunk count MUST NOT multiply member influence.

#### Scenario: Owner removes the last eligible member
- **WHEN** a Collection has no eligible current member
- **THEN** refresh reports an empty aggregate and does not retain an old vector as current

#### Scenario: Different owners save the same source
- **WHEN** A's and B's Collections contain the same underlying bookmark
- **THEN** each aggregate reads its owner's private representative and removal from A does not delete B's article vectors

### Requirement: Two user preferences remain independent

Saved-article and subscribed-Collection preferences SHALL have separate IDs and respectively use `user-article` and `user-collection` namespaces in the user index. They MUST NOT be alpha/beta-combined, copied into each other or exposed through user-neighbor search. Collection preference SHALL include active eligible subscriptions with uniform weight, exclude own Collections and inactive/expired subscriptions, and not create personal saves per member.

#### Scenario: One preference is empty
- **WHEN** a user has saves but no eligible subscriptions
- **THEN** the article preference remains usable while the Collection preference is explicitly empty or unavailable without a zero vector

#### Scenario: Subscription is cancelled
- **WHEN** an active subscription is cancelled or expires
- **THEN** Collection preference recomputation removes that signal without changing unrelated personal saves or the Collection's member aggregate

### Requirement: Exact private reads and honest projection state

User preferences SHALL be read by exact authenticated-user IDs and preference kind using native by-ID reads. The user index SHALL not require unused query metadata indexes. Missing, invalid or zero-norm results SHALL remain explicitly unavailable; failed publication SHALL remain failed and retryable by recomputation, not be claimed committed in a nonexistent database ledger.

#### Scenario: Caller supplies another user ID
- **WHEN** an authenticated user requests preference data for a different identity
- **THEN** that identity does not authorize a private profile read

#### Scenario: Publication fails
- **WHEN** aggregate computation succeeds but native storage fails
- **THEN** the operation reports failure and a later refresh recomputes from current state instead of claiming the failed projection is current

### Requirement: Committed mutation paths request maintenance

New capture/import maintenance SHALL be admitted in an explicit step of the existing processing/post-processing flow after original content is committed. Base bookmark/relation persistence SHALL NOT dispatch article or preference jobs, and SearchService semantic normalization SHALL NOT hide the admission side effect. Existing-content re-save, Fork and recovery SHALL enter the same post-processing responsibility without unnecessary source fetching.

REST and local-first star/unstar, deletion/restoration, publication and subscription changes SHALL request maintenance after their own business commit. Archive/unarchive alone SHALL remain neutral and SHALL not dispatch preference work. The maintenance Workflow SHALL express direct named steps: article processing and visibility before the owner's article preference and independent owned Collection processing; Collection publication metadata before that Collection's representation; subscription-only work only recomputes the actor's Collection preference. Article and Collection update targets MUST NOT enumerate subscribers or refresh any subscriber preference, irrespective of whether the Collection vector changed. Explicit user refresh, subscription/cancellation/expiry actions and separately scoped account-deletion cleanup remain available; no new refresh scheduler or implicit recommendation-time write is introduced. It MUST NOT relay content/owner tasks through chains of child Workflows. Heavy work SHALL use the shared injected Service. Account/save deletion SHALL remove only affected private vectors. Missed dispatch and concurrent refresh limitations SHALL be reported without introducing a queue, trigger, lock or lease platform.

#### Scenario: Collection content changes
- **WHEN** an article update or Collection publication update changes a Collection representation
- **THEN** the independent Collection vector is refreshed and verified without enumerating subscribers or recomputing their Collection preferences
- **AND** existing user Collection preferences remain unchanged until a user action or explicit refresh requests their recomputation

#### Scenario: A Collection has many subscribers
- **WHEN** the same Collection update is processed with zero, one or many subscriptions
- **THEN** the update's Workflow does not add subscriber enumeration or per-subscriber steps

#### Scenario: New bookmark relation precedes content capture
- **WHEN** a pending bookmark relation is created
- **THEN** no article or preference maintenance is dispatched by the base save method
- **AND** successful committed content later reaches the explicit maintenance post-processing step

#### Scenario: Old indexing fails during post-processing
- **WHEN** the existing search embedding fails after original content is committed
- **THEN** the explicit new maintenance admission remains independent and does not re-fetch the source

#### Scenario: Subscription-only change
- **WHEN** a user subscribes or unsubscribes
- **THEN** maintenance recomputes only that user's Collection preference from currently eligible Collection vectors, without rebuilding article or Collection vectors

#### Scenario: Account deletion races with an old request
- **WHEN** a deleted account's earlier target is retried
- **THEN** current authoritative state denies recreation and unrelated users' vectors remain intact
