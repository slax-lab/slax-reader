# Spec Delta

## Purpose

Keep KOC promotion recoverable when a user explicitly follows a promotion journey while making unrelated KOC outages invisible to ordinary product navigation and independent onboarding decisions.

## ADDED Requirements

### Requirement: Ordinary KOC failures are silent

A route has KOC promotion context only when it contains a valid KOC blogger query, has a restored pending invitation, or is completing an active claim/success acknowledgement. When no such context exists, KOC validation, identity, or status failures SHALL resolve to an inactive promotion state that does not render a KOC error message or Retry/Later controls and does not block automatic onboarding.

#### Scenario: Ordinary Inbox with API unavailable
- **WHEN** a user opens `/` or `/bookmarks` without KOC parameters and `/v1/user/me` cannot be reached
- **THEN** no KOC warning, error toast, Retry button, or Later button is shown
- **AND** the onboarding decision continues using independent account and data readiness

#### Scenario: Ordinary Inbox with malformed KOC response
- **WHEN** an ordinary route receives a malformed promotion response from a background KOC check
- **THEN** the response is ignored as unavailable promotion context
- **AND** it cannot mark the user eligible, already received, or blocked from onboarding

### Requirement: Explicit KOC failures remain recoverable

When a valid KOC URL or pending invitation exists, transport, timeout, malformed-status, and temporary identity failures SHALL preserve the pending invitation and expose a retryable KOC state. The explicit flow SHALL remain ahead of automatic onboarding until the user chooses Later, the reward succeeds, or the server returns a definitive unavailable result.

#### Scenario: Explicit KOC URL with API unavailable
- **WHEN** a user opens `/?activity_id=daguang&activity_type=blogger&claim=true` and the promotion API fails
- **THEN** the invitation remains associated with the current account when possible
- **AND** the UI offers Retry and Later without submitting a reward
- **AND** automatic onboarding waits until the user chooses Later or the flow reaches a terminal result

#### Scenario: Pending invitation after reload
- **WHEN** a stored pending KOC invitation is restored and its next status check times out
- **THEN** the invitation remains retryable
- **AND** a bare ordinary visit does not replace it with the ordinary campaign

### Requirement: Pending promotion storage is account-scoped

The system SHALL store validated pending KOC invitations under a versioned local account key without persisting the raw token. It SHALL read the existing numeric server-user-id key only through a currently verified or previously persisted non-secret account alias, and that compatibility lookup SHALL never authorize a claim. Account changes SHALL not restore another account's invitation.

#### Scenario: Same-token API outage restores pending KOC
- **WHEN** a previously validated invitation exists under the current local account and `/v1/user/me` is unavailable
- **THEN** the invitation can be restored from the local account key
- **AND** the flow remains retryable without using a stale server ID for authorization

#### Scenario: Legacy numeric invitation remains compatible
- **WHEN** a legacy numeric pending key exists and a safe account-to-server-ID alias is available
- **THEN** the invitation may be mirrored into the new local account key
- **AND** the alias cannot make a failed identity request succeed or submit a claim

#### Scenario: Account switch isolates pending KOC
- **WHEN** the session changes from account A to account B
- **THEN** account A's pending invitation is not restored for B
- **AND** late validation or status responses from A are discarded

### Requirement: Promotion blocking is context-aware

The promotion gate SHALL accept promotion state, whether the current route has KOC context, and whether account/pending restoration has completed. Initial restoration SHALL block automatic onboarding only until the bounded local restore finishes, even when no invitation is currently known. Resolving, checking, offering, submitting, success acknowledgement, and retryable error SHALL block automatic onboarding only when KOC context is present. An ordinary route with an inactive or silently failed promotion SHALL not wait for a KOC API timeout or remain blocked after local restoration completes.

#### Scenario: Ordinary route has no KOC context
- **WHEN** pending restoration has completed and the shared promotion state is idle or error because a background check failed
- **THEN** the onboarding gate returns allowed for the ordinary route
- **AND** the KOC host renders no failure controls

#### Scenario: Explicit route is checking
- **WHEN** the current route contains a KOC query and eligibility is still being resolved
- **THEN** automatic onboarding remains blocked
- **AND** the KOC host may show its bounded checking state

#### Scenario: Pending restoration is unresolved
- **WHEN** an Inbox route has not yet completed account identity and pending-invitation restoration
- **THEN** automatic onboarding waits for that bounded resolution
- **AND** it cannot redirect before a stored KOC invitation has been checked

#### Scenario: Ordinary route does not wait for KOC timeout
- **WHEN** local account restoration completes with no pending invitation but `/v1/user/me` remains unavailable
- **THEN** ordinary onboarding may continue from independent local or REST readiness
- **AND** the user is not held behind the KOC request timeout

### Requirement: Definitive outcomes do not create false identity or eligibility

A KOC failure, missing server profile, malformed status, or account mismatch SHALL never be interpreted as an eligible reward, an already-received reward, or a verified server account. A definitive invalid blogger or already-received response may clear only the matching pending invitation.

#### Scenario: Malformed status response
- **WHEN** the status endpoint returns a response that fails schema validation
- **THEN** the client keeps the invitation retryable when KOC context exists
- **AND** it does not open the claim modal or clear the invitation as received

#### Scenario: Account changes during retry
- **WHEN** a retry response returns after the current session changes
- **THEN** the response cannot mutate the new account's promotion state or onboarding navigation
