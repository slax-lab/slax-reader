# Spec Delta

## MODIFIED Requirements

### Requirement: Library and collection flows preserve all actions

Inbox, Starred, and Archived SHALL retain the source-ordered flat list without date section headers, row status, star/archive swipe actions, contextual menus, title editing, direct deletion from the Library context menu without an added confirmation, add-link validation, pending/failed parsing flow, and continue-reading behavior. Reader, comment, and account-deletion confirmations SHALL retain their existing behavior. Subscribed collection feeds SHALL preserve active-feed selection, unread status, expiry/closed/error states, owner context, and permission restrictions. User-owned write actions MUST NOT become available on read-only collection content.

#### Scenario: A URL is saved without connectivity
- **WHEN** a user submits a valid HTTP or HTTPS URL while offline
- **THEN** a pending bookmark appears optimistically in the library
- **AND** explicit invalid submissions and ambiguous multi-link clipboard input retain validation
- **AND** opening the add-link form with no valid clipboard URL stays empty and silent without overwriting subsequent typing

#### Scenario: The application starts before local data is ready
- **WHEN** local logged-in state is known while account ownership, refresh, sync or initialization remains pending
- **THEN** Login or the authenticated shell is presented immediately, without waiting for network readiness or adding a global loading transition; admission failures retain localized recovery
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

