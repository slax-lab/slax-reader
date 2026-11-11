# Spec Delta

## Purpose

Ensure automatic Inbox onboarding uses resolved current-account data and remains consistent when users finish, skip, reload, or return to cached pages.

## ADDED Requirements

### Requirement: Automatic onboarding requires authoritative ready data

The system SHALL automatically select onboarding only after the authenticated account, extension detection, current Inbox query, and collection-subscription query are successfully resolved. Local data SHALL additionally require verified database ownership and completion of first synchronization for that account. Cached profiles and local UUID fallback profiles MUST NOT establish verified account identity. Loading, query failures, and stale responses MUST NOT establish emptiness.

#### Scenario: Slow nonempty REST response
- **WHEN** a returning user's first bookmark response is pending and later returns bookmarks
- **THEN** the application does not redirect to onboarding while awaiting that response

#### Scenario: Successful empty response
- **WHEN** current Inbox and collection-subscription queries successfully return empty results, extension detection completes without installation, and onboarding has not been dismissed
- **THEN** the account is eligible for automatic onboarding subject to the promotion gate

#### Scenario: Query failure or obsolete response
- **WHEN** a bookmark or collection query fails, returns malformed data, or belongs to a superseded account/filter/query
- **THEN** it does not trigger onboarding or set a pending-onboarding marker

#### Scenario: New-device first synchronization
- **WHEN** the local database initially has no rows but the account's first synchronization is incomplete
- **THEN** the empty local result does not trigger onboarding

#### Scenario: Previously synced offline account
- **WHEN** first synchronization previously completed and current local queries resolve without error while offline
- **THEN** those local results can support the ordinary onboarding decision

### Requirement: The existing audience is evaluated on the active Inbox

Automatic onboarding SHALL remain limited to the active Inbox surface with an empty current Inbox, zero noncancelled collection subscriptions, no detected extension, and no dismissed-onboarding state. It SHALL NOT add a new-registration restriction or equate Inbox emptiness with absence of all historical bookmarks. Inactive cached pages MUST NOT initiate redirects.

Search, source-filtered lists, selected collection feeds, and RSS SHALL NOT qualify as the plain personal Inbox for automatic onboarding.

#### Scenario: Old account with empty Inbox
- **WHEN** an old account meets the resolved Inbox conditions
- **THEN** it can enter onboarding regardless of its registration age
- **AND** archived-only history does not by itself change this existing audience rule

#### Scenario: User is on another surface
- **WHEN** a cached bookmarks page observes changed empty data while another page or the RSS surface is active
- **THEN** it does not redirect the user to onboarding

#### Scenario: Promotion is unresolved
- **WHEN** the active Inbox meets onboarding conditions but its non-deferred KOC claim is unresolved or awaiting acknowledgement
- **THEN** automatic onboarding waits until that flow permits continuation

#### Scenario: A filtered view is empty
- **WHEN** a search, source-filtered view, or selected collection feed has no results
- **THEN** its empty result does not trigger automatic Inbox onboarding

### Requirement: Onboarding completion is shared and durable per account

Skipping or completing onboarding SHALL publish a single per-account completed state before returning to the root Inbox /. All active and cached consumers SHALL observe that state. Existing stored completion markers SHALL remain honored, and completion SHALL take precedence over stale pending markers. The no-pending fallback SHALL also target /. Return navigation MUST preserve validated campaign and deferral parameters when durable invitation storage is unavailable.

#### Scenario: Onboarding exits use the root path
- **WHEN** onboarding finishes, is skipped, or exits because the account has no pending-onboarding state
- **THEN** it returns to / rather than introducing /bookmarks into the journey
- **AND** any URL fallback retains its campaign and deferral state through a subsequent reload

#### Scenario: Skip with cached bookmarks
- **WHEN** a user skips onboarding and returns to a cached bookmarks page
- **THEN** that page observes completion and does not immediately redirect back to onboarding

#### Scenario: Both completion and pending are stored
- **WHEN** an account has both a dismissed marker and a stale pending marker
- **THEN** the dismissed state wins and the stale pending marker is repaired

#### Scenario: Restored pending does not bypass data readiness
- **WHEN** a pending marker exists before current data has resolved
- **THEN** a new automatic redirect waits for authoritative readiness
- **AND** nonempty data or detected installation makes the stale pending state obsolete

#### Scenario: Account-specific completion
- **WHEN** the active account changes
- **THEN** its onboarding state is loaded independently without applying another account's completion or pending state

#### Scenario: Direct onboarding resume
- **WHEN** a user directly reloads an existing onboarding session
- **THEN** the tutorial can resume after the KOC presentation gate resolves
- **AND** this does not establish that the account's Inbox is empty

#### Scenario: Local ownership or startup storage cannot be verified
- **WHEN** storage access or account cleanup fails during PowerSync startup
- **THEN** the application remains usable through the REST path without treating the unowned local database as ready

#### Scenario: Identity response belongs to an old session
- **WHEN** a server identity response arrives after the login session changes
- **THEN** it cannot bind an invitation, update the new account profile, or authorize onboarding
