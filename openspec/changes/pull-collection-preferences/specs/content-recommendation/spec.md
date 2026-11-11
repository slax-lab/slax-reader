## MODIFIED Requirements

### Requirement: Preferences and business exclusions remain separate

Article-preference materialization and request-time Collection-preference calculation SHALL remain independent; the article-feed pause MUST NOT combine profiles or cancel explicit raw/centered article-preference refresh. Collection recommendation SHALL compute its subscription preference from the requesting user's currently eligible Collection representatives on each request, with the available-input behavior specified by preference-partial-coverage. It SHALL retain own/subscribed Collection exclusions, the existing response shape, raw-vector cosine ranking, MMR and existing feedback behavior. Subscription changes MUST NOT create public article candidates. No fabricated zero-vector personalized result or fallback to an old stored Collection preference is permitted. Recommendation requests SHALL NOT initiate embedding, source repair or vector maintenance.

#### Scenario: Subscription succeeds
- **WHEN** the user subscribes through the existing Collection action and the read observes that relationship
- **THEN** the Collection is no longer offered as a new subscription and its visible representative participates in the request-local preference
- **AND** the article feed remains `no_public_candidates` without a separately supplied pool

#### Scenario: No usable preference exists
- **WHEN** the user has no eligible subscriptions or every eligible Collection vector is absent
- **THEN** Collection recommendation returns its existing cold-start response without ANN, zero vectors or a stale stored-profile fallback
- **AND** an article request without a public pool still returns `no_public_candidates` without candidate/model work

#### Scenario: Collection vector changes between requests
- **WHEN** an eligible subscribed Collection's replacement vector becomes visible before the next request
- **THEN** that request computes from the replacement without requiring the subscriber to change a subscription or receive a refresh job

#### Scenario: Ranking stays equivalent
- **WHEN** every eligible subscribed Collection vector is available and eligibility is stable for the request
- **THEN** the query vector equals an independent full normalized equal-weight sum within floating-point tolerance
- **AND** candidate scores, admission, previews and diversification use the existing rules

#### Scenario: Recommendation does not amplify writes
- **WHEN** one user requests Collection recommendations repeatedly
- **THEN** no subscriber vectors, owner aggregates or preference state are written and no maintenance Workflow is created
- **AND** the established recommendation-served analytics remain allowed

#### Scenario: One source read fails
- **WHEN** a Collection-vector read rejects or returns invalid vector data
- **THEN** the request follows the existing error path instead of returning a fabricated cold-start or partially accumulated successful recommendation list
