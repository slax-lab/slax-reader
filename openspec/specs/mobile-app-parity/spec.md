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
- **AND** only a complete file whose size, final range/length and descriptor identity match is marked fully cached

#### Scenario: A drawer gesture activates over the article list
- **WHEN** the drawer is dragging, open or settling closed
- **THEN** the drawer's backdrop owns touches above the covered list, so the list cannot be scrolled, opened, swiped, long-pressed or reached by accessibility actions through it
- **AND** the list's own scroll capability, scroll offset and row gestures are not toggled, reset or locked by drawer state
- **AND** the list is immediately interactive once the drawer resolves closed, without waiting for the close animation to finish
- **AND** drawer controls, backdrop dismissal and native Back remain functional

#### Scenario: A row is tapped after scrolling or a short horizontal drag
- **WHEN** the user taps a Library row after a fling, after a cancelled row swipe or after a horizontal movement that did not open the drawer
- **THEN** the press either opens the row or is visibly cancelled; it is never shown as pressed while silently discarded
- **AND** the list scrolls normally afterwards

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

### Requirement: Native settings switches preserve setting behavior

Mobile settings SHALL use platform-native switch controls while retaining the existing persisted value, change callback, accessibility label, disabled/loading state and failure handling for each option. Switching one option SHALL NOT change another option or bypass its controller.

#### Scenario: A setting change succeeds or fails
- **WHEN** a user toggles an available setting
- **THEN** the existing setting controller receives the chosen value once
- **AND** server-backed controls remain disabled while pending and reflect the actual result, with existing retry/error feedback on failure

### Requirement: Source selection preserves loaded avatars

Switching Collection or RSS sources within the active account SHALL retain loaded source avatars and the source-strip identity. It SHALL replace article rows and reset their scroll position as before without treating replacement rows as prepends. Actual account replacement SHALL retain existing resource isolation.

#### Scenario: A source selection changes
- **WHEN** the user selects another source in the current Collection or RSS strip
- **THEN** unchanged source avatars remain mounted without a placeholder reload
- **AND** only the selected source and its article data change, with the expected scroll reset

#### Scenario: The active account changes
- **WHEN** the active native resource owner changes
- **THEN** previous-account rows, avatars and captured callbacks cannot populate the replacement account

### Requirement: Feedback opens ready for text entry

Entering the Feedback screen SHALL autofocus its editable input and present the native keyboard, preserving its draft, owner checks, keyboard avoidance and submit behavior.

#### Scenario: Feedback opens from the sidebar
- **WHEN** the user opens Feedback from the Library sidebar
- **THEN** the feedback input receives focus and the keyboard is available without an additional tap

### Requirement: Keyword clearing preserves independent filters

The Search keyword clear control SHALL appear only when the keyword input contains text and SHALL clear only that text. Selected tags and source scope SHALL retain their independent controls. Reader-style tag chips SHALL retain the existing tag-selection callbacks, selected/available eligibility, filtering, multi-tag query semantics and Done dismissal.

#### Scenario: Tags are selected without keyword text
- **WHEN** tags or source scope are active and the keyword field is empty
- **THEN** the keyword clear control is absent

#### Scenario: Keywords are cleared with active filters
- **WHEN** the user presses the keyword clear control
- **THEN** only the keyword is cleared and independent tag/source filters remain selected

### Requirement: Feedback first focus respects keyboard avoidance readiness

Feedback SHALL initially focus its editable content after the native opening transition completes and its keyboard-avoidance surface has a settled measured screen offset. The first keyboard presentation SHALL keep both follow-up and log-attachment options reachable above the keyboard. Subsequent layout measurements SHALL not reopen the keyboard or steal focus. Draft, consent and submission behavior SHALL remain intact.

#### Scenario: Entering Feedback from the sidebar
- **WHEN** the Feedback screen completes its opening transition and settled layout measurement
- **THEN** its input focuses with the correct keyboard-avoidance offset and both consent options remain visible

#### Scenario: Feedback lays out again after dismissing the keyboard
- **WHEN** a later layout measurement occurs
- **THEN** the screen does not automatically focus the input again

### Requirement: Common reader preprocessing is rebuilt from upstream source

Mobile SHALL consume a generated upstream bridge with programmatic anchor-selection suppression and common image, empty-span, details, relative-link, table and iframe processing. Programmatic anchor highlighting SHALL not report a user selection; subsequent user selections SHALL still report normally. Images SHALL preserve authored WeChat sizing, settle already completed requests, recover after source replacement and retain native preview behavior. Spans containing line breaks SHALL remain visible; YouTube contents details SHALL retain their existing expansion state. Relative links SHALL resolve against original-page metadata. Tables SHALL fit short content and allow wide content to scroll without changing annotation-bearing DOM structure. Oversized iframe widths SHALL be constrained. Observers SHALL stop on teardown. Media-specific processors SHALL remain unchanged.

#### Scenario: Original-page metadata arrives after DOM readiness
- **WHEN** Mobile supplies the original page URL through InfoPack
- **THEN** relative links resolve against that URL and WeChat image processing retains authored dimensions even when the image already loaded

#### Scenario: A source-generated bridge replaces the imported script
- **WHEN** the rebuilt bridge is embedded into Mobile
- **THEN** anchor navigation remains suppressed as a user selection, real selection still works and provenance records the actual upstream source/build inputs

#### Scenario: Common content resizes and the Reader closes
- **WHEN** table/image dimensions change and then the Reader is torn down
- **THEN** layout updates preserve DOM paths and horizontal scroll, and their observers and pending frames are released

### Requirement: Native selection cancellation delivers pending annotation actions

Reader SHALL deliver a user-selected text range when native selection takeover cancels the touch after selection debounce has completed. Cancellation before debounce SHALL retain delayed delivery. The same range SHALL not produce duplicate notifications, and subsequent user gestures and programmatic anchor-selection suppression SHALL remain correct.

#### Scenario: Native takeover follows a settled selection debounce
- **WHEN** text is selected while touching the document and native takeover sends touchcancel after debounce has retained a pending range
- **THEN** Reader reports that range once and makes its available annotation actions visible

#### Scenario: Native takeover precedes selection debounce
- **WHEN** native takeover cancels the touch before debounce completes
- **THEN** the eventual user selection is reported once, and later real selections still work

### Requirement: Android comment editing remains above the keyboard

Reader's Android inline comment sheet SHALL avoid the visible native keyboard so its quote, editable draft and Send action remain reachable. Keyboard frame changes and dismissal SHALL restore the correct available viewport without subtracting keyboard height twice when the native window already resized. Existing iOS avoidance, comment persistence, dismissal and sheet motion SHALL remain intact.

#### Scenario: Keyboard opens and changes during comment editing
- **WHEN** the Android comment input focuses and the keyboard opens or changes height
- **THEN** the draft input and enabled Send action remain above the keyboard and can submit without dismissing it first

#### Scenario: Keyboard hides and the comment is reopened
- **WHEN** the keyboard hides and the saved comment is closed and reopened
- **THEN** the sheet regains its available height and the saved comment remains visible
