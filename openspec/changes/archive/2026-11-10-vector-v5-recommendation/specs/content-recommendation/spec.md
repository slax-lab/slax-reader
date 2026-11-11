## Purpose

Preserve bounded Collection recommendations and private vector identity while keeping the article feed empty until an operator-supplied public article pool exists. Collection publication does not automatically publish its members into an article feed.

## ADDED Requirements

### Requirement: Article feed requires a separately supplied public pool

Until an operator-supplied public article pool exists under a separately established contract, article recommendation SHALL return an empty list with reason `no_public_candidates`. It MUST NOT call article ANN, latest/popular candidate queries, candidate hydration or model inference. An ordinary save, starred or published/readable Collection membership, a shared bookmark row, foreign ownership or stale vector metadata MUST NOT supply or authorize that pool. No new pool endpoint, script, automatic admission rule or production cleanup is included in this correction. Article-marker write/filter requirements belong to `vector-v5-runtime`, not a second delta.

#### Scenario: Published Collection has relevant members
- **WHEN** an article-feed request arrives without a separately supplied public pool, even with a valid preference and public Collection members
- **THEN** the result is empty with `no_public_candidates`
- **AND** ANN, latest/popular queries, candidate hydration and model-call counts remain zero

#### Scenario: Old article marker remains in the index
- **WHEN** a stored article or chunk still has historical recommendable metadata
- **THEN** it does not admit a public article candidate or trigger cleanup as part of the request

### Requirement: Collection recommendation retains its visibility boundary

Collection recommendation SHALL continue to query the fixed Collection index using its existing `recommendable` filter and current authoritative publication/read admission. The article-feed pause MUST NOT remove or repurpose Collection `recommendable`, change mean-member aggregation, or disable Collection recommendation. Collection recommendation is not Collection natural-language search; private V5 query/search constraints are owned by `vector-v5-runtime`.

#### Scenario: Collection visibility changes after recall
- **WHEN** a Collection closes or loses current eligibility before the response
- **THEN** final Collection admission omits it without relying only on index metadata

### Requirement: Private identity and bounded outcomes remain intact

The paused article consumer MUST NOT collapse `(userId, bookmarkId)` ownership, export a full vector corpus or infer a public pool from another user's vectors. Collection retrieval SHALL retain bounded native recall, authoritative hydration and truthful empty/failure outcomes. Required private article representatives/chunks remain one identity for aggregation; this does not reactivate article-feed retrieval.

#### Scenario: Two users share an original
- **WHEN** both users have independent private vectors for one bookmark
- **THEN** the article-feed pause leaves both stored identities unchanged and exposes neither through automatic public admission

### Requirement: Preferences and business exclusions remain separate

Article and Collection preference materialization SHALL remain independent; the article-feed pause MUST NOT combine profiles or cancel explicit raw/centered article-preference refresh. Collection recommendation SHALL retain own/subscribed Collection exclusions and truthful missing-preference behavior. Subscription changes MUST NOT create public article candidates. No fabricated zero-vector personalized result is permitted.

#### Scenario: Subscription succeeds
- **WHEN** the user subscribes through the existing Collection action
- **THEN** the Collection is no longer offered as a new subscription
- **AND** the article feed remains `no_public_candidates` without a separately supplied pool

#### Scenario: No usable preference exists
- **WHEN** Collection recommendation lacks its relevant preference vector
- **THEN** it reports its cold-start or empty state truthfully
- **AND** an article request without a public pool still returns `no_public_candidates` without candidate/model work

### Requirement: Consumers reuse existing actions without new source products

Recommendation consumers SHALL reuse existing bookmark, Fork/PDF and Collection actions with current authorization and response contracts. They MUST NOT introduce source-managed Collections, machine ingestion, daily editions, feedback-driven ranking, feedback storage outside the existing first-party event pipeline, synthetic users or unapproved client UI. This capability's consumer implementation remains separate from foundation/config cleanup but uses the same minimal service contract.

#### Scenario: Existing client saves a recommended item
- **WHEN** the normal save or subscription request is sent without new source/daily fields
- **THEN** its existing validation and business operation remain applicable and maintenance follows the resulting committed state

### Requirement: Historical article algorithms remain paused

The article ZoRRO ranker, PinnerSage/profile ANN retrieval, latest/popular channels and article MMR described in `design.md` section 6 SHALL be treated as paused historical design, not active article-feed behavior. The previous candidate union from automatic public Collection membership is superseded. Historical formulas, calibration measurements and algorithm tests may remain as provenance, but MUST NOT authorize candidate reads, model calls, a new pool endpoint/script or a feed restart in this revision. Existing preference clustering/materialization and Collection recommendation are not cancelled by this pause.

#### Scenario: Historical ranking code or vectors remain available
- **WHEN** an article-feed request has existing preferences, vectors or historical algorithm assets but no separately supplied public pool
- **THEN** it still returns `no_public_candidates` without executing candidate retrieval or ranking

### Requirement: Collection diversification implements MMR

Collection lists SHALL retain MMR with `λ = 0.7` over the 50 best-ranked admitted candidates, with `Sim1 = Sim2 = cosine` as defined in `design.md` 6.4. MMR MUST NOT select a candidate outside that ranked list. Article MMR remains paused historical design.

#### Scenario: Near-duplicate Collection candidate
- **WHEN** the second-best Collection candidate is nearly identical to the first selected item and a less relevant candidate is dissimilar
- **THEN** selection follows the existing MMR criterion with `λ = 0.7`, not a new ranking rule

### Requirement: Collection ranking uses the mean-member representation

Collection candidates SHALL be scored by cosine between the user Collection preference and the Collection's mean-member representation, then diversified by MMR. Recent member previews SHALL only be displayed and MUST NOT change score or order.

#### Scenario: Preview articles resemble the user
- **WHEN** a Collection's three most recent members are close to the user preference but its mean-member vector is not
- **THEN** its rank follows the mean-member cosine

### Requirement: Existing centered preferences remain independent of feed availability

The article-feed pause MUST NOT change existing raw/centered article-preference materialization, clustering metadata or versioned mean assets described in `design.md` 6.6. Collection ranking SHALL retain raw vectors. Article request-time centered ZoRRO/MMR scoring and article retrieval remain paused historical design, not an active requirement to fetch candidates. This correction does not authorize mean regeneration or calibration.

#### Scenario: Centered profile already exists
- **WHEN** an article request has a raw/centered user profile but no supplied public pool
- **THEN** it returns `no_public_candidates` without candidate retrieval or scoring
- **AND** profile storage and explicit preference refresh remain independent of that empty feed response

### Requirement: Recommendation feedback is recorded through the existing event pipeline

Each recommendation response SHALL carry an `impressionId` and `algorithm` identifier, and the service SHALL record the served list as a `recommendation_served` event through the existing first-party event pipeline. `POST /v1/recommendations/feedback` SHALL accept authenticated, strictly validated `impression`, `click`, `save`, `subscribe` and `dismiss` events for items of an impression and record them as `recommendation_feedback` events. The interface MUST NOT add tables or change ranking.

#### Scenario: Served list and feedback can be joined
- **WHEN** a user receives recommendations and reports an impression and a click on one item
- **THEN** the pipeline holds one served record and two feedback records with the same impression ID, enough to compute that impression's AUC

#### Scenario: Invalid feedback body
- **WHEN** a body has an unknown action, a malformed impression ID or more than 50 events
- **THEN** the request is rejected and no feedback event is recorded
