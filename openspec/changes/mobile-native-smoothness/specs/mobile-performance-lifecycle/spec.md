## ADDED Requirements

### Requirement: Automatic offline acquisition runs on native workers

Automatic and foreground-promoted offline acquisition SHALL be executed by an app-owned native engine on dedicated platform workers. Network and file work SHALL run on an IO pool, HTML preparation on a CPU pool, and scheduling state on one serial owner. None of these SHALL run on the JavaScript thread or the UI thread. JavaScript SHALL supply the eligible plan (bookmark keys, owner, version, cache limit and image preference) and the current account credentials, and SHALL remain the only writer of the PowerSync database. The engine SHALL report progress in coalesced batches. JavaScript SHALL persist each batch in one transaction and SHALL write an article's download state at most when it starts and when it resolves. Per-image progress SHALL NOT be written to watched database tables. Existing personal/collection separation, manual retention, cache limits, image preference, bounded concurrency, error-specific retries, atomic commits and account revocation SHALL be preserved.

#### Scenario: Automatic caching runs while the user scrolls
- **WHEN** several articles and their images are being cached and the user scrolls the Library
- **THEN** downloading, HTML preparation and file writes do not execute on the JavaScript or UI thread
- **AND** list rows receive at most two download-state changes per article

#### Scenario: Credentials expire during automatic caching
- **WHEN** the engine receives an authorization rejection for the current account
- **THEN** it requests fresh credentials from the JavaScript credential owner and retries only after they are supplied
- **AND** it never refreshes or persists credentials itself

#### Scenario: The account is replaced during acquisition
- **WHEN** sign-out, account replacement or origin replacement occurs while native work is in flight
- **THEN** the engine cancels the old owner's work and discards its late results before any write or publication

### Requirement: Local resource identity uses primary keys without content hashing

The mobile runtime SHALL NOT compute SHA-256 or another cryptographic content hash on startup, catalog publication, offline acquisition, avatar caching or reading paths. Only one-time legacy KMP adoption verification, which runs before an installation is bound and never on a normal launch, MAY retain its existing lossless checksums. Spotlight/App Intents entities and donations SHALL use bookmark primary keys qualified by collection owner where required. Article and image cache identity SHALL use account/owner and bookmark keys. Avatar identity SHALL use the user key and source URL. Article completion SHALL be an atomically committed manifest that records size and the bookmark version. A stale version SHALL be re-acquired rather than validated by hashing.

#### Scenario: A large library is published to Spotlight
- **WHEN** the iOS system catalog is reconciled for hundreds of bookmarks
- **THEN** entity identifiers are derived from primary keys without hashing work proportional to the library size

#### Scenario: A cached article's server version changes
- **WHEN** the bookmark version differs from the committed manifest
- **THEN** the article is re-acquired and the previous file is replaced only by a complete atomic commit

### Requirement: Foreground lifecycle matches native expectations

Only a true background transition SHALL engage the storage-safety pause. Transient iOS `inactive` states such as Control Center, notification banners, authentication sheets and the app switcher SHALL NOT disconnect synchronization, cancel offline acquisition or resubscribe Library data. Returning to the foreground SHALL NOT rebuild the offline plan or re-run full recovery. Non-critical startup work, including system-surface reconciliation and diagnostics, SHALL begin only after the Library has been presented. Preference writes SHALL NOT re-render screens that do not consume the changed values.

#### Scenario: The user opens Control Center over the Library
- **WHEN** the application becomes inactive and active again without entering the background
- **THEN** synchronization stays connected, offline acquisition continues and the Library is not re-queried

#### Scenario: A row is opened while preferences are written
- **WHEN** opening a bookmark records system-surface or continue-reading state
- **THEN** the Library and Reader do not re-render because of that preference write

### Requirement: Reader document host mounts after the route transition

On Android, where the push transition runs on the UI thread, the HTML Reader's native document host SHALL be created after the native push transition completes, or immediately when no transition occurs. On iOS, where the push is Core Animation driven, the host MAY be created during the transition. On both platforms a skeleton SHALL cover the host until the document reports its first content and initial position restore. Cached article bodies SHALL be read on a foreground-priority native path that does not wait behind background acquisition, concurrently with the bookmark record lookup. The Reader route's navigation-bar configuration SHALL be final from the first frame (transparent bar, fixed-size trailing slot), so opening the Reader never re-lays out the back button. Static bridge and host scripts SHALL be installed without being rebuilt per article. On Android, document height SHALL be measured by the native host and applied to the outer native scroller without a React layout round trip per height change. On iOS, inset updates SHALL be ignored when unchanged and SHALL NOT reset the scroll offset or stop deceleration while the user is dragging or the view is decelerating.

#### Scenario: A cached article is opened
- **WHEN** the user taps a cached article in the Library
- **THEN** on Android the push transition runs without concurrent WebView creation or document composition
- **AND** the skeleton fades out only after content is presentable at its restored position

#### Scenario: An article references slow external resources
- **WHEN** a cached article contains images, frames or fonts that load slowly or never finish
- **THEN** the loading cover lifts once the document's DOM and first height are known, without waiting for the page load event
- **AND** if content above the restored position grows before the user interacts, the saved position is reapplied once
- **AND** the article is never kept covered beyond a bounded timeout

#### Scenario: A cached article is opened while background caching runs
- **WHEN** automatic downloads are in progress and the user opens an article that is already cached
- **THEN** its body is read without waiting for the background downloads or a network request
- **AND** the back button stays in place throughout the push transition

#### Scenario: The Reader header grows during a fling
- **WHEN** tags or the AI overview change the header height while the iOS Reader is decelerating
- **THEN** deceleration continues and the visible article text does not jump

#### Scenario: Images load while scrolling on Android
- **WHEN** document height changes repeatedly as images load during an outer-scroller fling
- **THEN** height is applied natively without re-rendering the Reader screen for each change
