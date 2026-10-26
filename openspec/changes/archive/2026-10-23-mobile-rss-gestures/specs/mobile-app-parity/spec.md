# Spec Delta

## MODIFIED Requirements

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
