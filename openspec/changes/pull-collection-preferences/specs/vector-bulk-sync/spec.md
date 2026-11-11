## MODIFIED Requirements

### Requirement: Each user preference is refreshed directly by user ID

`POST /v1/bookmark/preference/refresh` and the retained `POST /v1/collection/preference/refresh` SHALL each accept exactly `{user_id}` and preserve dedicated-secret authentication and canonical-path/body validation. The former SHALL refresh only that user's article preference, including raw/centered records and interest metadata, from existing eligible article vectors with available-input coverage. The latter SHALL be cleanup-only: it SHALL remove only `u:<userId>:collection` if present, never enumerate subscriptions, read source vectors or generate a preference, and include reason `collection_preference_on_demand`. It SHALL return `empty` without a mutation if the legacy key is absent, or report the actual deletion/visibility/failure outcome if present; it MUST NOT claim `written` or fabricate aggregation coverage. Neither route SHALL refresh source articles, owner Collections, other users or subscription relationships. Empty article history SHALL clear stale article preferences without a zero vector. Already-created user/Collection-preference Workflow targets SHALL remain recognized and perform the same retirement behavior rather than re-materialization.

#### Scenario: User has no eligible subscriptions
- **WHEN** the legacy Collection-preference task specifies that user's ID
- **THEN** it cleans only that user's legacy key if one exists without needing or enumerating subscription rows
- **AND** its reason identifies retirement, not a new preference calculation

#### Scenario: Source vector is missing
- **WHEN** an article-preference refresh has absent sources
- **THEN** it follows the available-input and all-missing rules of preference-partial-coverage and never recursively generates a dependency
- **AND** a cleanup-only Collection-preference task does not inspect or depend on source-vector availability

#### Scenario: Legacy key is already absent
- **WHEN** a valid authorized legacy task finds no `u:<userId>:collection` record
- **THEN** it returns `empty` with the retirement reason and makes no vector mutation

#### Scenario: Legacy deletion is not visible
- **WHEN** the cleanup delete is accepted but the record is still visible
- **THEN** the endpoint reports pending and the Workflow uses its existing visibility/retry behavior, not successful completion

#### Scenario: Old Workflow resumes
- **WHEN** a queued or resumed user/Collection-preference job executes the new implementation
- **THEN** it executes a retirement-specific step rather than treating a cached historical materialization result as cleanup
- **AND** it never upserts a subscription preference or refreshes any dependency

### Requirement: The caller sends targets sequentially

The operator script SHALL use parameterized bounded read-only enumeration and at most one outstanding HTTP request. Its default ordered stages SHALL be article, article-preference and Collection; there SHALL be no subscription-materialization stage. Article enumeration SHALL preserve each eligible private user/bookmark pair. Article-preference enumeration SHALL visit each selected active user at most once, including users without article history, and send user IDs directly.

#### Scenario: Default bulk refresh
- **WHEN** the caller runs without a selected stage
- **THEN** it processes article, article-preference and Collection targets in that order and performs no subscription-stage enumeration or HTTP request

#### Scenario: User has many subscriptions
- **WHEN** a selected user has many subscriptions
- **THEN** that fact adds no subscription-preference targets to the bulk refresh

#### Scenario: Earlier request has not completed
- **WHEN** a selected task request is still in flight
- **THEN** the script does not start another HTTP task request

### Requirement: Scope and failure reporting remain explicit

The caller SHALL support selected supported stage, owner scope, explicit enumeration IDs, exclusive single-stage cursor and enumeration-only dry-run. Article cursors/selection IDs SHALL remain relation enumeration keys while transmitted targets remain raw user/bookmark pairs; article-preference cursors/IDs SHALL remain user IDs and Collection cursors/IDs SHALL remain Collection IDs. Explicit `--kind subscription` SHALL fail before database/network access with reason `subscription_preference_on_demand`; help SHALL explain request-time calculation and the cleanup-only legacy endpoint. The script SHALL obtain the task secret only from environment, report failed/pending targets, continue remaining supported rows and exit nonzero for incomplete work. It MUST NOT add checkpoints, automatic retries, receipt polling, live cleanup or deployment actions.

#### Scenario: Dry-run has no task secret
- **WHEN** the operator performs a supported-stage dry-run with only read-only database configuration
- **THEN** only enumeration and console output occur, with no HTTP, model or index operation

#### Scenario: Provider rejects a selected article
- **WHEN** one article task fails
- **THEN** the script records that target's safe failure, continues later rows and returns a nonzero final exit code

#### Scenario: Retired stage is selected
- **WHEN** `--kind subscription` is supplied with or without other flags
- **THEN** the caller reports its retirement and exits nonzero without opening a database connection, loading credentials or sending an HTTP request

### Requirement: Native outcomes are not overstated

Refresh responses SHALL preserve failed, empty, deleted, written and applicable pending outcomes in the ordinary response envelope. Native write acceptance SHALL not be labelled completed search visibility. Legacy cleanup results SHALL carry their retirement reason and SHALL NOT be described as materialized Collection preferences. Existing refresh authentication evidence SHALL continue to exercise the whitelist plus Controller-entry X-Vector-Refresh-Secret gate; older login/Bearer-based evidence SHALL not replace it. Historical passing counts SHALL NOT close reopened implementation tasks.

#### Scenario: HTTP success contains failed processing
- **WHEN** the transport succeeds but the target result is failed or pending
- **THEN** the operator reports incomplete work rather than counting it as a completed refresh

#### Scenario: Legacy cleanup succeeds
- **WHEN** the retained endpoint completes cleanup of a legacy subscription-preference record
- **THEN** its deleted/empty result and retirement reason distinguish cleanup from preference materialization
