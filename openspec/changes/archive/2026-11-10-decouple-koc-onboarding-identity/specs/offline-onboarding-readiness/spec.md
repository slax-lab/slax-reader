# Spec Delta

## Purpose

Make automatic Inbox onboarding depend on authoritative current-account data while allowing a previously synchronized, correctly owned local database to support the same empty-Inbox decision during an API outage.

## ADDED Requirements

### Requirement: Empty Inbox is proven before onboarding

The system SHALL select automatic onboarding only after the active account, extension detection, Inbox query, and subscription query are ready. A local path SHALL additionally require a completed first synchronization, a matching current database owner, successful current queries, and a committed empty Inbox/subscription check. A REST path SHALL require a successful current-session response. Loading, errors, stale responses, and API failures SHALL not prove emptiness.

#### Scenario: Previously synced local account is empty offline
- **WHEN** the current token owns a database whose first synchronization completed, current local queries succeed, and Inbox plus active subscriptions are empty
- **THEN** the account may enter onboarding even when the REST API is unavailable

#### Scenario: New device has not synchronized
- **WHEN** the local database is empty but first synchronization has not completed
- **THEN** the account does not enter onboarding
- **AND** no pending marker is created solely from that empty query

#### Scenario: Local query fails
- **WHEN** the local Inbox or subscription query fails or remains fetching
- **THEN** the readiness result remains unresolved
- **AND** onboarding does not redirect or claim the library is empty

### Requirement: Local ownership is account-scoped

The local readiness decision SHALL require the PowerSync owner to match the current token-derived local account key. A server user ID, cached profile, or KOC promotion state SHALL not substitute for the local owner check. Account changes SHALL invalidate the previous local readiness result.

#### Scenario: KOC identity is unavailable
- **WHEN** KOC identity verification fails but the current local token owner, database owner, sync completion, and committed queries are valid
- **THEN** local onboarding readiness can still resolve independently of KOC state

#### Scenario: Owner changes while confirmation is pending
- **WHEN** the direct empty check resolves after the local owner or token changes
- **THEN** its result is discarded
- **AND** the new account remains unresolved until its own data is ready

### Requirement: Onboarding markers use stable account scope

Pending and dismissed onboarding markers SHALL be namespaced by a stable local account key and SHALL not contain raw tokens. Existing numeric server-user-id markers SHALL remain readable when a verified server ID exists. A dismissed marker SHALL take precedence over a stale pending marker, and storage denial SHALL preserve safe in-memory behavior without applying another account's markers.

#### Scenario: Account-specific marker isolation
- **WHEN** account A has a pending marker and account B becomes active
- **THEN** account B does not enter onboarding because of account A's marker

#### Scenario: Legacy marker compatibility
- **WHEN** a verified account has an existing numeric pending or dismissed marker
- **THEN** the marker remains honored and is migrated or mirrored into the stable account namespace

#### Scenario: Dismissed marker wins
- **WHEN** both pending and dismissed markers exist for the same account
- **THEN** the dismissed state is returned
- **AND** the stale pending marker is removed or ignored

### Requirement: Legacy marker aliases do not become authorization

The system MAY retain a non-secret mapping from a verified opaque local account key to the last server user ID needed to read legacy markers. That mapping SHALL be used only for marker compatibility and SHALL NOT authorize KOC claims, server requests, or current server identity.

#### Scenario: Offline legacy marker read
- **WHEN** the current token matches a previously verified local-account alias but `/v1/user/me` is unavailable
- **THEN** the matching legacy onboarding marker may be mirrored into the stable account namespace
- **AND** the alias cannot make the account server-ready or eligible for a promotion claim
