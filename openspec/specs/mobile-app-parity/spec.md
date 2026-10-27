# mobile-app-parity Specification

## Purpose
Preserve the complete currently implemented Android and iOS mobile product, including platform-specific behavior and all active RSS working-tree features.

## Requirements

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

Inbox, Starred, and Archived SHALL retain the source-ordered flat list without date section headers, row status, star/archive swipe actions, contextual menus, title editing, direct deletion from the Library context menu without an added confirmation, add-link validation, pending/failed parsing flow, and continue-reading behavior. Reader, comment, and account-deletion confirmations SHALL retain their existing behavior. Subscribed collection feeds SHALL preserve active-feed selection, unread status, expiry/closed/error states, owner context, and permission restrictions. User-owned write actions MUST NOT become available on read-only collection content.

The Library row status indicator SHALL occupy a stable slot and present a stable state while automatic caching runs. Concurrent downloads MUST NOT make indicators oscillate between uncached, downloading, and cached states; a download that completes before its downloading state has been presented SHALL change the indicator directly from uncached to cached. Status updates MUST NOT move rows or change list order.

#### Scenario: A URL is saved without connectivity
- **WHEN** a user submits a valid HTTP or HTTPS URL while offline
- **THEN** a pending bookmark appears optimistically in the library
- **AND** explicit invalid submissions and ambiguous multi-link clipboard input retain validation
- **AND** opening the add-link form with no valid clipboard URL stays empty and silent without overwriting subsequent typing

#### Scenario: The application starts before local data is ready
- **WHEN** local logged-in state is known while account ownership, refresh, sync or initialization remains pending
- **THEN** Login or the authenticated shell is presented immediately, with localized data loading or upgrade failure rather than a global blank wait
- **AND** cached content waits for verified account/migration admission and protected requests wait for valid credentials without exposing a previous account

#### Scenario: The user scrolls a collection feed
- **WHEN** the library list is dragged vertically
- **THEN** the collection selector scrolls offscreen with the list header
- **AND** horizontal collection selection, item anchoring and saved-position restoration remain functional

#### Scenario: Collections arrive while the library is initially at the top
- **WHEN** subscribed collections are available initially or arrive after the article rows while the user remains at the top
- **THEN** the populated selector is visible by default rather than being scrolled away by article anchoring
- **AND** later synchronization does not reset a deliberately scrolled list or a restored Reader-return position

#### Scenario: There are no subscribed collections
- **WHEN** the collection list is empty
- **THEN** the entire collection selector strip, including the own-feed shortcut, is omitted
- **AND** its former fixed height is not reserved above the article rows

#### Scenario: A subscribed collection becomes unavailable
- **WHEN** the selected collection closes, expires, or disappears
- **THEN** the application displays the appropriate source state or returns to the own feed
- **AND** it does not expose unauthorized owner actions

#### Scenario: Several automatic downloads run at once
- **WHEN** multiple library rows are cached concurrently
- **THEN** each row keeps its status indicator in the same position and the list does not reorder
- **AND** an indicator never oscillates between uncached, downloading, and cached states
- **AND** a download that finishes before its downloading state was presented goes directly from uncached to cached without a visible intermediate flash

#### Scenario: An initialized account has local library rows
- **WHEN** the same account relaunches with admitted cached articles, profile and Collection records
- **THEN** those records render before network refresh or sync completes without a blocking spinner
- **AND** refresh does not clear useful rows or briefly report a false empty library
- **AND** a genuine empty or deleted result replaces obsolete data

#### Scenario: Avatar resources are available from a prior launch
- **WHEN** the same admitted account opens the Library offline after process termination
- **THEN** its cached self and Collection avatars render from durable local resources
- **AND** online refresh can replace a changed avatar without clearing the valid current image first
- **AND** account/origin replacement or cache cleanup revokes the old resource identity

#### Scenario: An eligible PDF is visible in the library
- **WHEN** a PDF belongs to the configured automatic-cache window while the app is active
- **THEN** automatic acquisition can start without opening Reader or pressing a PDF-specific download action
- **AND** opening Reader promotes and reuses compatible in-flight or committed byte ranges
- **AND** only a complete integrity-verified file is marked fully cached

#### Scenario: A drawer gesture activates over the article list
- **WHEN** the drawer is dragging, open or settling closed
- **THEN** the underlying list cannot scroll, open rows, swipe actions, long-press menus or receive accessibility actions
- **AND** input is restored only after completed dismissal, including cancelled or interrupted gestures
- **AND** drawer controls, backdrop dismissal and native Back remain functional

#### Scenario: A large library synchronizes while scrolling
- **WHEN** the user scrolls a large populated library while sync or automatic PDF caching progresses
- **THEN** background progress does not repeatedly remount unchanged rows or reset the visible anchor
- **AND** star/archive/delete actions remain immediate and the list retains its source ordering

#### Scenario: The user scrolls through the complete selected Library list
- **WHEN** the admitted account opens Inbox, Starred, Archived or a permitted Collection list containing many matching articles
- **THEN** the complete ordered local list is available without a page-size cap, continuation cursor or scroll-triggered article loading
- **AND** deep scrolling and Reader return preserve the list position and existing actions
- **AND** performance optimization does not remove rows from the selected list

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

Feedback, About, sidebar/logout, cache cleanup, hidden diagnostic entry, environment switching, network/sync diagnostics, and main-app analytics/crash reporting SHALL retain their source behavior and platform restrictions. By explicit user decision, the standalone `app.slax.reader.share` extension SHALL NOT integrate Firebase telemetry or require Firebase configuration/linkage; this exception MUST NOT remove main-app Analytics or Crashlytics or alter the extension's collection, shared-authentication and App Group behavior. New push registration, global search, arbitrary business deep links, and previously unwired helpers MUST NOT be falsely counted as source parity requirements or substitutes for implemented flows.

#### Scenario: Diagnostic behavior is exercised
- **WHEN** a user opens the hidden diagnostic route and performs a supported cache or environment action
- **THEN** source feedback and lifecycle requirements are retained
- **AND** ordinary production navigation and account state remain correct
