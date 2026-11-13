# Spec Delta

## Purpose

Gives every user a default public collection of starred bookmarks that is always available to view and share without an enablement flow, while defining provisioning, discovery, and empty-state behavior.

## ADDED Requirements

### Requirement: Default public collection for every active user

The system SHALL provide exactly one starred collection for every active user without requiring the user to enable or configure it. The collection SHALL have a stable public code, a default display name derived from the user's name, and open visibility by default. Provisioning or reading the collection SHALL NOT require a minimum number of starred bookmarks, a name or description form, or a visibility confirmation. Existing public codes SHALL remain unchanged.

#### Scenario: New user discovers collections

- **WHEN** a new active user accesses their collection information with no starred bookmarks
- **THEN** the user has an open collection with a usable public address and an automatically generated default name
- **AND** no enablement or setup action is required

#### Scenario: Existing user without a collection

- **WHEN** the one-time rollout backfill encounters an active user without an existing collection
- **THEN** the system inserts the default collection without requiring user input
- **AND** subsequent reads return the same public code without creating or changing a collection

#### Scenario: Existing collection identity

- **WHEN** default-public behavior is introduced for a user who already has a collection
- **THEN** its existing public code and address remain valid and unchanged

### Requirement: Provisioning initializes collection discovery

The system SHALL dispatch the existing collection vector-maintenance target when registration inserts a new collection. Registration retries that return an existing collection, including a row recovered after a concurrent unique conflict, SHALL NOT dispatch a duplicate maintenance target. The one-time backfill SHALL use the existing collection vector-refresh mechanism for newly inserted open collections so collection search, recommendations, and subscriber preference aggregation use the same initialization behavior as the previous enablement flow.

#### Scenario: Newly registered collection

- **WHEN** registration inserts a default collection
- **THEN** the system dispatches collection vector maintenance for that collection

#### Scenario: Backfilled collection

- **WHEN** the one-time backfill inserts default collections
- **THEN** the existing collection vector-refresh mechanism processes the newly inserted open collections from the pre-backfill ID cutoff

#### Scenario: Existing or concurrently recovered collection

- **WHEN** registration returns an existing collection or recovers the row inserted by a concurrent request
- **THEN** that registration result is not treated as a new insertion and does not independently dispatch collection vector maintenance

### Requirement: Default provisioning preserves existing collection visibility

The rollout SHALL provision an open collection for users who do not have one without sending collection-specific notifications, requiring advance consent, or providing a provisioning-specific opt-out. Every existing collection SHALL preserve its current open or closed status, including collections previously closed by their curators. Existing codes, names, descriptions, ownership, visibility, and subscriptions SHALL remain intact during rollout and ordinary provisioning.

#### Scenario: Previously closed collection

- **WHEN** the rollout or ordinary provisioning encounters a collection that its curator previously closed
- **THEN** that collection remains closed with its existing public address and content
- **AND** the owner is not asked to confirm or notified specifically about default provisioning

#### Scenario: Collection already open

- **WHEN** the rollout or ordinary provisioning encounters an already open collection
- **THEN** its public identity, visibility, and user-configured metadata remain unchanged

#### Scenario: Visibility changed after rollout

- **WHEN** an owner closes a collection after rollout
- **THEN** the collection remains closed and is not automatically reopened by ordinary reads, later authentication, or provisioning retries

### Requirement: Starred bookmarks define public collection content

An open collection SHALL present the owner's current starred bookmarks without a separate publication action. Starring a saved bookmark SHALL make it available through the collection, and removing its star SHALL remove it from the collection. Saving a bookmark without starring it SHALL NOT add it to the collection. Collection subscription and sharing behavior SHALL continue to operate on this same content.

#### Scenario: Star and unstar

- **WHEN** an owner stars a saved bookmark and later removes its star
- **THEN** the bookmark appears in the owner's open collection after starring and no longer appears after unstarring

#### Scenario: Saved but not starred

- **WHEN** an owner saves a bookmark without starring it
- **THEN** the bookmark remains outside the owner's public collection

#### Scenario: Empty public collection

- **WHEN** a visitor directly opens the public address of an open collection with no starred bookmarks
- **THEN** the collection address remains valid and presents an empty-collection state rather than an enablement or not-found state

### Requirement: Direct Web discovery and sharing

The Web starred-bookmark surface SHALL present the owner's collection and a direct copy/share action regardless of starred-bookmark count. The entry SHALL be available on supported narrow and wide Web viewports. The Web flow SHALL NOT present an initial enablement prompt, setup form, enablement success state, or 10-star threshold. A previously closed collection MAY present the original single-line mini entry with a direct reopen action, but it SHALL NOT require repeating initial setup or show a full guidance card. Copying the address SHALL NOT change collection content or visibility.

#### Scenario: User with fewer than ten stars

- **WHEN** a signed-in Web user with zero or more starred bookmarks opens the starred-bookmark surface
- **THEN** the user can discover the collection and copy its public address without enabling it

#### Scenario: Narrow Web viewport

- **WHEN** a signed-in user opens the starred-bookmark surface at a supported narrow viewport
- **THEN** a usable collection discovery and sharing entry remains available

#### Scenario: Repeat sharing

- **WHEN** an owner copies the collection address more than once
- **THEN** each action copies the same public address and does not reopen a collection that the owner closed after rollout

### Requirement: First-star cue introduces the collection without interruption

After a user's successful starring action on Web, the system SHALL present a lightweight, non-blocking cue near the triggering star control when the action locally changes the starred count from zero to one or when that local count is unavailable. A known nonzero starting count SHALL NOT trigger the cue. The cue SHALL NOT be presented more than once per account in the same browser. It SHALL identify the starred collection and offer a path to the starred bookmark list rather than opening the public collection directly. The starred-list collection area SHALL explain that stars automatically form a recommendations page with a shareable link, establishing the collection's purpose and permanent entry. The cue SHALL replace the ordinary star-success feedback, remain visible for about four seconds, use a normal-weight action, and fall back to the global Toast only when control anchoring is unavailable. It SHALL serve feature discovery rather than public-visibility disclosure or consent, and SHALL NOT block the starring action or require confirmation.

#### Scenario: First successful star

- **WHEN** a Web user successfully stars a bookmark for the first time
- **THEN** the star is saved normally and a non-blocking collection discovery cue becomes visible
- **AND** the user may dismiss or ignore the cue without affecting the bookmark or collection

#### Scenario: First-star cue establishes the permanent entry

- **WHEN** the user follows the first-star cue
- **THEN** the user reaches the starred bookmark list rather than the public collection page
- **AND** the collection area explains that stars automatically form a recommendations page with a shareable link

#### Scenario: Later starring actions

- **WHEN** the same user stars another bookmark after receiving the first-star cue
- **THEN** no additional first-star cue is presented

#### Scenario: Local count unavailable

- **WHEN** a user successfully stars a bookmark before the local starred count is available and the account has not received the cue in that browser
- **THEN** the cue is presented once without waiting for server statistics

#### Scenario: Starring again after the collection was emptied

- **WHEN** a user who already received the cue unstars every bookmark and then stars one again in the same browser
- **THEN** the cue is not presented again

### Requirement: Owner-controlled visibility after rollout

After rollout, an owner SHALL be able to close and reopen the collection using the existing management controls. A closed collection SHALL be unavailable to ordinary public visitors, and reopening SHALL restore the same public address and current starred content. Closing or reopening SHALL NOT require repeating an initial setup flow.

#### Scenario: Owner closes a collection

- **WHEN** an owner closes a collection after rollout
- **THEN** ordinary visitors can no longer read its public contents and later owner reads do not silently reopen it

#### Scenario: Owner reopens a collection

- **WHEN** an owner reopens a closed collection after rollout
- **THEN** its previous public address serves the current starred bookmarks again without a new setup form
