# Mobile Application Parity Spec Delta

## Purpose

Preserve the complete currently implemented Android and iOS mobile product, including platform-specific behavior and all active RSS working-tree features.

## ADDED Requirements

### Requirement: Every existing mobile route remains functional

The application SHALL preserve Login, Inbox, Bookmark detail with personal, collection, and RSS context, Settings, About, Debug, Delete Account, Subscription, and contextual Feedback. Each route SHALL retain its working loading, populated, empty, failure, retry, and dismissal states and existing Chinese and English localization. A route shell or placeholder MUST NOT satisfy parity.

#### Scenario: Route coverage is audited
- **WHEN** acceptance compares the migrated app with the pinned source inventory
- **THEN** every existing route and active subflow is reachable and operates on real data
- **AND** any original unsupported platform capability is distinguished from a migration defect

### Requirement: Authentication and agreements preserve platform behavior

The application SHALL preserve Google sign-in on Android and iOS and Apple sign-in on iOS, agreement acceptance before the pending sign-in action, terms/privacy viewing, loading, cancellation, errors, and successful navigation reset. Existing callback handling and backend token semantics SHALL remain compatible. Android SHALL not show a newly invented Apple sign-in capability.

#### Scenario: Sign-in awaits agreement
- **WHEN** a user selects a provider without having accepted the agreement
- **THEN** the existing terms/privacy flow completes before that pending sign-in resumes
- **AND** cancellation abandons the pending sign-in action

### Requirement: Library and collection flows preserve all actions

Inbox, Starred, and Archived SHALL retain their ordering, date sections, row status, swipe actions, contextual menus, title editing, deletion, add-link validation, pending/failed parsing flow, and continue-reading behavior. Subscribed collection feeds SHALL preserve active-feed selection, unread status, expiry/closed/error states, owner context, and permission restrictions. User-owned write actions MUST NOT become available on read-only collection content.

#### Scenario: A URL is saved without connectivity
- **WHEN** a user submits a valid HTTP or HTTPS URL while offline
- **THEN** a pending bookmark appears optimistically in the library
- **AND** invalid or ambiguous clipboard input retains the original validation behavior

#### Scenario: A subscribed collection becomes unavailable
- **WHEN** the selected collection closes, expires, or disappears
- **THEN** the application displays the appropriate source state or returns to the own feed
- **AND** it does not expose unauthorized owner actions

### Requirement: Active RSS functionality is fully migrated

The application SHALL preserve the RSS Labs setting, subscription creation/rename/removal, all-feed and per-feed selection, refresh progress and rate limits, periodic refresh status, history expansion, retry/end states, and saving entries to bookmarks. RSS reading SHALL retain content/summary fallback, truncation notice, source/title/author/date, original links, image gallery, and save actions in the existing locations.

#### Scenario: A feed refresh is rate limited
- **WHEN** a user refreshes before the permitted time
- **THEN** the original rate-limit feedback is shown
- **AND** existing items and feed selection remain visible

#### Scenario: An RSS entry is saved
- **WHEN** the user saves an entry from its list or reader
- **THEN** bookmark creation follows the existing API behavior
- **AND** matching cached feed entries update their saved state consistently

### Requirement: Settings and account actions retain their safeguards

The application SHALL preserve cache-count choices including unlimited, image download preference, language selection, RSS Labs loading/error/retry, and account deletion. Account deletion SHALL retain the remotely rendered notice, actual scroll-to-bottom prerequisite, confirmation, server denial reasons, progress, error handling, and sign-out on success.

#### Scenario: A user has not finished reading the deletion notice
- **WHEN** the notice has not been scrolled to its bottom
- **THEN** the destructive action remains disabled
- **AND** reaching the bottom still requires the existing confirmation before submission

### Requirement: Existing subscription functionality remains compatible

On iOS the application SHALL preserve its authenticated purchase page, product loading, normal and promotional-offer purchases, cancellation, pending transactions, signed transaction verification, order-to-account association, progress/error/success states, and existing entitlement/restore integration. Android's existing lack of working native purchasing SHALL be documented and SHALL not be presented as an implemented baseline feature.

#### Scenario: An iOS promotional purchase completes
- **WHEN** the authenticated purchase page requests a supported offer and the transaction succeeds
- **THEN** the correct signed transaction and account association reach backend verification
- **AND** success is shown only after the existing verification completes

#### Scenario: A purchase is pending or cancelled
- **WHEN** the platform reports a pending or cancelled transaction
- **THEN** the appropriate source state is preserved
- **AND** the user is not incorrectly granted successful subscription status

### Requirement: Incoming and outgoing shares preserve source flows

iOS SHALL retain an independently operating share extension with the original identity and shared authentication, Safari preprocessing, and collecting/success/error/cancel states without forcing the main application to open. Android SHALL retain text/plain incoming sharing, URL/subject handling, and original collection feedback. Outbound article sharing SHALL preserve existing platform-specific title, text, URL, and image metadata behavior.

#### Scenario: Safari shares while the main iOS application is closed
- **WHEN** an authenticated user shares a supported article
- **THEN** the extension collects it and presents the result within the share flow
- **AND** the main application does not need to launch

### Requirement: Auxiliary behavior is included in completion

Feedback, About, sidebar/logout, cache cleanup, hidden diagnostic entry, environment switching, network/sync diagnostics, and existing analytics/crash reporting SHALL retain their source behavior and platform restrictions. New push registration, global search, arbitrary business deep links, and previously unwired helpers MUST NOT be falsely counted as source parity requirements or substitutes for implemented flows.

#### Scenario: Diagnostic behavior is exercised
- **WHEN** a user opens the hidden diagnostic route and performs a supported cache or environment action
- **THEN** source feedback and lifecycle requirements are retained
- **AND** ordinary production navigation and account state remain correct
