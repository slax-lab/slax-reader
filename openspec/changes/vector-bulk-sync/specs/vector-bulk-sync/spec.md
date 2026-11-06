## Purpose

Allow an operator to refresh one identified private article, Collection or user preference at a time using a fixed task-specific secret, with a bounded sequential caller and no dependent refresh cascade.

## ADDED Requirements

### Requirement: Task refresh requires its dedicated secret

Every vector task refresh endpoint SHALL require the configured fixed task secret in the X-Vector-Refresh-Secret header. Each Controller SHALL validate it at entry, before canonical path checks, body parsing or target processing. Missing, empty, malformed or mismatching credentials or server configuration SHALL deny. Reader sessions, API keys, team membership and forwarded user identity MUST NOT substitute for this credential. Secrets MUST NOT appear in URLs, request bodies, logs or responses.

#### Scenario: Task request without a user login
- **WHEN** the operator supplies the correct task header and valid target body without Authorization or X-API-Key
- **THEN** the existing whitelist permits the ordinary route lifecycle and the Controller authorizes the requested action without a Reader user session

#### Scenario: User credentials are not task credentials
- **WHEN** a caller supplies only a valid Reader login, API key or forwarded user identity
- **THEN** no task refresh is performed without the task secret

#### Scenario: Task configuration is absent
- **WHEN** Core has no configured task secret
- **THEN** refresh fails closed and performs no target reads, embedding calls or vector mutations

### Requirement: Task authentication preserves existing middleware

The four refresh paths SHALL be added to the existing whitelist. The whitelist predicate, JWT/API-key processing, rate handling and trusted-Edge identity logic SHALL remain unchanged. The secret check SHALL live in a shared utility called by the four Controllers, not in middleware or a separate dispatcher. Edge SHALL use its existing anonymous forwarding path and preserve the custom header; no task-specific forwarding mode or Edge secret configuration SHALL be required. Unrelated routes SHALL keep their existing authentication. The Controller gate SHALL protect both direct Core and Edge-forwarded requests.

#### Scenario: Direct Core request
- **WHEN** a request reaches a task endpoint directly without a valid task secret
- **THEN** Core rejects it even if a forwarded user identity is present

#### Scenario: Router accepts a trailing slash
- **WHEN** a task endpoint is requested with a trailing slash using a Reader JWT or forwarded user identity without the task key
- **THEN** it is rejected before processing, just like the canonical task path
- **AND** pathname normalization does not authorize unrelated prefix or suffix paths

#### Scenario: Key is sent to an unrelated route
- **WHEN** a task key is sent to an ordinary bookmark or recommendation endpoint
- **THEN** the task key does not bypass that endpoint's normal user authentication

### Requirement: Article refresh affects one private article only

`POST /v1/bookmark/vector/refresh` SHALL accept exactly `{user_id, bookmark_id}` with positive safe integer numeric IDs. It SHALL refresh or clean up that private identity using current authoritative state. Its representative and necessary chunks are one logical article target. It MUST NOT refresh the user's preference, another user's article, owned Collections or subscribers. Old relation-ID inputs, optional preference flags, arrays and generic target lists SHALL be rejected.

#### Scenario: Two users saved one source
- **WHEN** the request specifies A's user ID and the shared bookmark ID
- **THEN** only A's article vector identity is processed, leaving B's vectors and all preferences unchanged

#### Scenario: Invalid multi-target body
- **WHEN** the body contains an array of IDs, unknown keys or the superseded user_bookmark_id/preference fields
- **THEN** the request is rejected before vector processing

### Requirement: Each user preference is refreshed directly by user ID

`POST /v1/bookmark/preference/refresh` and `POST /v1/collection/preference/refresh` SHALL each accept exactly `{user_id}`. The former SHALL refresh only that user's article preference, including its raw and centered records and interest metadata. The latter SHALL refresh only that user's Collection preference. They SHALL aggregate existing eligible source vectors and MUST NOT refresh source articles, Collections, other users or subscription relationships. Empty current histories SHALL clear stale preference records rather than fabricate zero-vector success.

#### Scenario: User has no eligible subscriptions
- **WHEN** the Collection-preference task specifies that user's ID
- **THEN** it clears any stale Collection preference without needing a surviving subscription row

#### Scenario: Source vector is missing
- **WHEN** an eligible article or Collection contribution has no usable vector
- **THEN** the single preference task reports an explicit missing dependency and does not recursively generate that dependency

### Requirement: Collection refresh affects one independent Collection only

`POST /v1/collection/vector/refresh` SHALL accept exactly `{collection_id}` with a positive safe integer numeric ID. It SHALL aggregate that Collection from existing eligible member vectors or remove its obsolete representation according to current state. It MUST NOT fetch source websites, re-embed members or refresh subscribers.

#### Scenario: Collection contains many members and subscribers
- **WHEN** one Collection is submitted for refresh
- **THEN** only its representation is written or removed; members may be read but are not refreshed, and subscribers are not enumerated

### Requirement: The caller sends targets sequentially

The operator script SHALL use parameterized bounded read-only enumeration and at most one outstanding HTTP request. The ordered stages SHALL be article, article-preference, Collection and Collection-preference users. Article enumeration SHALL preserve every eligible private user/bookmark pair. Both preference stages SHALL enumerate each active user at most once per stage, including users without current history, and send user IDs directly.

#### Scenario: User has many subscriptions
- **WHEN** the Collection-preference stage processes a user with several subscriptions
- **THEN** it sends one request for that user, not one request per subscription row

#### Scenario: Earlier request has not completed
- **WHEN** a selected task request is still in flight
- **THEN** the script does not start another HTTP task request

### Requirement: Scope and failure reporting remain explicit

The caller SHALL support selected stage, owner scope, explicit enumeration IDs, exclusive single-stage cursor and enumeration-only dry-run. Article cursors/selection IDs SHALL be relation enumeration keys while the transmitted target remains the raw user/bookmark pair; preference cursors/IDs SHALL be user IDs, and Collection cursors/IDs SHALL be Collection IDs. The script SHALL distinguish these in help and output. It SHALL obtain the task secret only from environment, report failed/pending targets, continue remaining rows and exit nonzero for incomplete work. It MUST NOT add checkpoints, automatic retries, receipt polling or deployment actions.

#### Scenario: Dry-run has no task secret
- **WHEN** the operator performs dry-run with only read-only database configuration
- **THEN** only enumeration and console output occur, with no HTTP, model or index operation

#### Scenario: Provider rejects a selected article
- **WHEN** one article task fails
- **THEN** the script records that target's safe failure, continues later rows and returns a nonzero final exit code

### Requirement: Native outcomes are not overstated

Refresh responses SHALL preserve failed, empty, deleted, written and applicable pending outcomes in the ordinary response envelope. Native write acceptance SHALL not be labelled completed search visibility. Previous login-based route tests and Authorization-Bearer Edge/Core middleware-gate tests MUST NOT be used as evidence for the current whitelist and Controller-entry X-Vector-Refresh-Secret contract. Current acceptance SHALL exercise this revision; historical passing counts SHALL NOT close reopened tasks.

#### Scenario: HTTP success contains failed processing
- **WHEN** the transport succeeds but the target result is failed or pending
- **THEN** the operator reports incomplete work rather than counting it as a completed refresh
