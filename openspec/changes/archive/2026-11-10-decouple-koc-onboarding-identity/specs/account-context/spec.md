# Spec Delta

## Purpose

Provide one account context for local ownership, server identity, and account-scoped UI state so KOC availability, bookmark readiness, and onboarding cannot borrow identity from one another or from stale requests.

## ADDED Requirements

### Requirement: Local and server identity have separate trust levels

The system SHALL expose an opaque local account key derived from the current session token only for namespacing local browser and database state. It SHALL NOT persist a raw JWT or raw email as an account key. It SHALL expose a server user ID only after a successful current-session `/v1/user/me` response with a valid positive integer ID. A local account key or cached profile SHALL NOT authorize a server promotion claim or represent a verified server identity.

#### Scenario: API identity succeeds
- **WHEN** the current token receives a valid `/v1/user/me` response
- **THEN** the account context contains the token-scoped local key and the verified server user ID
- **AND** server-dependent flows may use the server user ID

#### Scenario: API identity fails
- **WHEN** `/v1/user/me` is unavailable, malformed, unauthorized, or times out
- **THEN** the context retains only the local scope when it can be derived safely
- **AND** it does not manufacture a server user ID or server authorization result

### Requirement: Account changes invalidate stale work

The system SHALL advance an account generation whenever the session token changes, is cleared, or is replaced by another account. A response or callback created under an older generation SHALL NOT update the current account context, onboarding markers, local ownership binding, promotion state, or navigation.

#### Scenario: Late identity response after logout
- **WHEN** a `/v1/user/me` response arrives after the session token has been cleared
- **THEN** the response is discarded
- **AND** no user profile or local owner is attached to the cleared session

#### Scenario: Late response after account switch
- **WHEN** account A's identity response arrives after account B is active
- **THEN** account B's context remains unchanged by account A's response
- **AND** account A's pending or dismissed onboarding state is not applied to B

### Requirement: Context status is explicit

The account context SHALL distinguish an empty context, a locally scoped but server-unverified context, a server-ready context, and a stale context. Consumers SHALL be able to require the status appropriate to their operation instead of treating a missing server ID as a generic KOC error.

#### Scenario: Local offline startup
- **WHEN** the current token has a valid local key but the API is unavailable
- **THEN** the context is locally scoped and server-unverified
- **AND** local data consumers may continue only if their ownership and synchronization checks also pass

#### Scenario: No session
- **WHEN** no usable session token exists
- **THEN** the context is empty
- **AND** neither local onboarding nor KOC promotion is treated as authenticated

#### Scenario: Same-token server outage
- **WHEN** a previously verified session later cannot refresh `/v1/user/me`
- **THEN** the server user ID is unavailable for new server-dependent operations
- **AND** the local account scope remains usable for owner-checked offline data
