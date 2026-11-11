# mobile-performance-lifecycle Specification

## Purpose
Keep normal mobile startup, offline acquisition and rich reading responsive as local content grows, while preserving account isolation, recoverable data, continuous image interaction and truthful release evidence.

## Requirements

### Requirement: Completed installation initialization is separate from login

The application SHALL distinguish first initialization, initialized normal startup and interrupted or invalid initialization recovery independently of authenticated state. Normal startup of an initialized installation SHALL use its bound database identity without recursively discovering historical database files or hashing every stored row. Signing out SHALL NOT erase installation initialization history or allow legacy credentials to be imported again. First legacy adoption SHALL retain lossless verification and pending offline transactions. A missing, ambiguous or incompatible established database SHALL enter recovery rather than silently create an empty replacement.

#### Scenario: An initialized user relaunches
- **WHEN** an initialized installation with a valid bound database is cold-launched while signed in or signed out
- **THEN** ordinary startup does not repeat historical directory discovery or full-data adoption checks
- **AND** local data remains behind ownership and identity admission, while signed-out presentation does not resurrect an old account

#### Scenario: First adoption is interrupted
- **WHEN** a process stops before legacy adoption is committed or the established identity cannot be verified
- **THEN** recovery preserves the original database, queued operations and initialization evidence
- **AND** local identity alone does not bypass the required recovery checks

#### Scenario: A new installation relaunches
- **WHEN** a fresh installation has created and bound its first database successfully
- **THEN** later launches use its recorded installation state instead of repeatedly searching for a legacy database

### Requirement: Local presentation and data readiness have a minimal critical path

The application SHALL present the locally selected route without waiting for network readiness and SHALL expose verified cached content without waiting for automatic download planning, auxiliary remote features or optional rendering resources. Startup consumers SHALL reuse compatible identity/settings snapshots and equivalent auxiliary requests within the same account and API origin. Protected network activity SHALL still await valid credentials. Optional initialization SHALL NOT displace required pending-payment recovery or security revocation.

#### Scenario: Network initialization is slow
- **WHEN** a locally authenticated user starts with slow credential refresh, feature discovery or automatic-cache work
- **THEN** the shell and admitted local list remain available independently of those tasks
- **AND** protected requests do not dispatch stale credentials

#### Scenario: Multiple surfaces need the same auxiliary state
- **WHEN** concurrently mounted mobile surfaces request the same account-scoped feature configuration
- **THEN** they share the current compatible acquisition instead of starting equivalent requests
- **AND** account or origin replacement invalidates the result before publication

#### Scenario: Ordinary reading does not use PDF
- **WHEN** the user launches the application or reads an HTML article without opening a PDF
- **THEN** PDF rendering resources are not initialized as a prerequisite for that interaction

### Requirement: Article bodies and optional resources have independent progress

Offline acquisition SHALL make a completed valid article body available without holding its body-acquisition capacity until every image finishes. It SHALL retain an internal resource inventory that distinguishes readable body state from missing or failed optional images. Image failure SHALL NOT discard readable HTML, and successful body acquisition SHALL NOT permanently suppress image repair. Existing personal/collection separation, manual retention, cache limits and image-download preferences SHALL remain effective without new cache-status chrome.

#### Scenario: An image-rich article has a slow image
- **WHEN** its HTML is complete but one image is slow and another eligible article body is pending
- **THEN** the later body can progress independently of that image
- **AND** the first body remains readable while its optional resources are completed

#### Scenario: Image completion is interrupted
- **WHEN** an enabled image download fails or the process stops after the article body is saved
- **THEN** valid completed resources survive and subsequent eligible execution retries only missing or invalid resources
- **AND** disabled image downloading does not start optional image requests

### Requirement: Foreground and automatic acquisition share bounded resource work

Equivalent resource acquisition within the same authorized account, origin, access context and immutable version SHALL be deduplicated across foreground reading, offline fill, gallery and sharing. A foreground consumer SHALL promote compatible scheduled work rather than independently duplicate it. Execution SHALL enforce finite global, per-destination and memory budgets, with reserved foreground progress and fairness for lower-priority work. Releasing one consumer SHALL NOT cancel another legitimate consumer; revoking the owning account or version SHALL invalidate all affected work.

#### Scenario: A user opens content being cached
- **WHEN** foreground reading requests the same compatible resource as a scheduled or active automatic download
- **THEN** it joins or promotes the existing work and receives the result without a duplicate logical download

#### Scenario: One consumer closes
- **WHEN** a gallery closes while another authorized consumer still needs its shared resource
- **THEN** the gallery stops receiving results but the other consumer retains its valid acquisition

#### Scenario: Account changes with pending resources
- **WHEN** an account, origin or immutable document version is replaced
- **THEN** old work cannot publish, commit files or reuse a handle in the replacement scope

### Requirement: Offline task recovery has bounded error-specific retries

Offline acquisition SHALL retain enough local task state to resume missing work after process restart and SHALL schedule retries according to error classification rather than incidental database notifications. Unavailable connectivity SHALL suspend retryable network work until an eligible retry or recovery event. Transient failures SHALL use bounded backoff, rate limits SHALL honor valid server retry guidance, and access/identity failures SHALL remain fail-closed. Pausing or terminating a task SHALL NOT lose already completed valid resources or pending synchronized business operations.

#### Scenario: Connectivity is lost during automatic fill
- **WHEN** transport fails because connectivity is unavailable
- **THEN** the task waits under a bounded recovery policy instead of repeatedly retrying on unrelated local updates
- **AND** reconnecting resumes missing work without requiring previously completed resources to be downloaded again

#### Scenario: Server access is denied
- **WHEN** the current request receives a definitive authorization, access or immutable-identity rejection
- **THEN** it is not treated as ordinary offline fallback and cannot expose a known-revoked resource

### Requirement: Resource storage is atomic and does not block interaction work

Large resource reads/writes, directory enumeration, deletion and transfer encoding SHALL execute outside the interaction-critical application and UI execution paths. Resource transfers SHALL use bounded buffering and enforce configured size limits. New resource files SHALL become valid cache hits only after a complete, current-owner atomic commit. Maintenance SHALL preserve active readers, retained content and unknown legacy local metadata, and SHALL NOT hold a business database write transaction open for slow directory deletion.

#### Scenario: A write is interrupted
- **WHEN** a process, cancellation or storage failure interrupts a new HTML or image write
- **THEN** an incomplete file is not published as the completed resource
- **AND** a prior valid resource remains usable or recoverable

#### Scenario: A large image arrives while scrolling
- **WHEN** an image is downloaded and stored during foreground interaction
- **THEN** its large byte body is streamed through bounded storage work rather than synchronously copied and written through interaction handlers

#### Scenario: Cleanup overlaps reading
- **WHEN** cleanup selects a resource that acquires a live foreground or retained-content reservation
- **THEN** cleanup rechecks ownership and defers that deletion without blocking unrelated local mutations behind filesystem work

### Requirement: Cache planning is independent of unrelated reading metadata

Changing reading positions, AI text or other unrelated local metadata SHALL NOT require retransmitting and parsing every full local record to replan downloads. Equivalent cache-state snapshots SHALL NOT trigger redundant planning, and small local updates SHALL preserve unrelated and unknown fields. UI notifications SHALL retain unchanged row identities where applicable.

#### Scenario: A reading position is saved
- **WHEN** only an article or outline position changes in a large local library
- **THEN** the update does not cause full local-content JSON processing for automatic download planning
- **AND** unrelated list rows and download tasks remain unchanged

### Requirement: PDFs use the ordinary automatic offline policy

PDF bookmarks SHALL enter automatic offline acquisition under the same eligibility, cache-window and retention rules as ordinary articles. The Reader SHALL NOT expose a separate PDF offline-download button or require that action to complete offline acquisition. Internal range prioritization, interruption recovery and full-file integrity validation SHALL remain active, and existing PDFs SHALL remain readable and eligible after PDF import opt-out.

#### Scenario: A PDF enters the automatic cache window
- **WHEN** a synchronized PDF becomes eligible under the ordinary article cache policy
- **THEN** its complete document is acquired automatically without opening a PDF-specific download action
- **AND** the Reader toolbar contains no standalone offline-download control

### Requirement: PDF acquisition avoids redundant full-file transfers

A valid cached PDF with an admitted, non-revoked access context SHALL have a bounded offline-opening path that does not wait for an unavailable network request to exhaust a long timeout. When a server ignores a range request and returns a valid complete response, overlapping requests for that immutable document SHALL share one bounded full-file acquisition and retain its reusable bytes. Range bounds, response lengths, optional supplied identity and complete-file SHA-256 checks SHALL remain enforced; partial bytes SHALL never be reported as offline-complete.

#### Scenario: A cached PDF is opened without connectivity
- **WHEN** the account and cached document are admitted, access has not been revoked, and connectivity is unavailable
- **THEN** the cached descriptor and valid bytes can serve reading without a long failed remote-metadata wait

#### Scenario: The server responds with a complete file
- **WHEN** a server returns a valid full response for a range request and other ranges of the same immutable document are needed
- **THEN** consumers share and reuse that acquisition instead of repeatedly downloading the complete file
- **AND** incomplete or contradictory responses are rejected without contaminating valid cached blocks

### Requirement: Fullscreen images have continuous reusable interaction

Mobile image presentation SHALL share consistent loading, error, identity and decoding policies. Fullscreen paging SHALL continuously track the user's drag and settle to a valid page, including handoff from a zoomed image at its horizontal boundary. Pinch, pan and double-tap transforms SHALL execute independently of application JS processing, use measured image/viewport geometry, and remain interruptible. Only a bounded current/neighbor window SHALL be prepared, with explicit decoded-image budgets. Application-owned offline files SHALL remain authoritative independently of disposable display caches.

#### Scenario: The user drags between images
- **WHEN** a user drags a fitted image toward another page
- **THEN** the page follows the gesture continuously and settles according to displacement and velocity rather than replacing the source only after release

#### Scenario: Zoom and paging overlap
- **WHEN** a user pinches or double-taps an image, interrupts the animation, then pans to an edge
- **THEN** the transformation continues from the actual current geometry and hands off to paging without a jump or stale transform

#### Scenario: The user swipes again before the first page settles in application JS
- **WHEN** a second swipe begins after the first page transition settled on the UI runtime but before application JS observed it
- **THEN** the second swipe continues from the settled position and both transitions take effect, without snapping back to the earlier page

#### Scenario: Small images and revisited gallery pages are shown
- **WHEN** an avatar or list thumbnail renders, or the user returns to a gallery page that recently left the prepared window
- **THEN** the thumbnail displays through the platform image cache without waiting behind fullscreen decodes, and the revisited page reuses its retained decode within a bounded memory budget

#### Scenario: An old image resolves after replacement
- **WHEN** a prior page, source or account finishes loading after replacement
- **THEN** it cannot display over the current image or change the replacement loading/error state

### Requirement: Reader updates and hidden work are bounded

Typing a comment or receiving AI chunks SHALL update the relevant presentation without reinitializing the article/PDF host or unnecessarily rebuilding unrelated reader content. Threaded comments SHALL render a bounded visible range while preserving all interaction and permission behavior. Unchanged Markdown SHALL not be reparsed for position updates; streamed changes SHALL preserve stable content and scroll context. Optional updates and resource work SHALL respect route visibility separately from application foreground state without suspending security revocation, required persistence or cancelled-back recovery.

#### Scenario: The user types during AI streaming
- **WHEN** the comment editor receives input while AI results stream
- **THEN** the document host remains mounted with its position and selection context, and updates are confined to the relevant editor/AI presentation

#### Scenario: The user scrolls an article
- **WHEN** an HTML article is dragged or flung
- **THEN** native header/footer overlays follow every frame while application JS receives bounded scroll samples and the exact settled offset
- **AND** toolbar, selection, header and comment-panel updates do not rerender the article host unless its document, marks, header content or geometry change

#### Scenario: A reader route becomes covered
- **WHEN** another application route covers the reader while the application stays foregrounded
- **THEN** nonessential hidden UI work is suspended or coalesced
- **AND** account revocation and pending persistence remain active and returning to the reader restores current valid state

### Requirement: Motion preserves immediate content and safe completion

Cached readable content SHALL NOT wait for an unconditional animation timer or mandatory skeleton interval. Nonessential preparation SHALL be scheduled around real interaction/transition state. Continuous sheet gestures SHALL not depend on per-frame JS callbacks. Motion SHALL use measured geometry, support interruption and reduced-motion preferences, and retain correct hit testing, keyboard behavior and dismissal completion. Local state actions SHALL provide prompt feedback without unnecessarily waiting for a modal dismissal, while opening another native presentation SHALL still await a safe completion boundary.

#### Scenario: Cached content is ready during navigation
- **WHEN** account-admitted cached content and its restore state are available
- **THEN** it is not held behind a fixed minimum delay, and optional preparation does not needlessly compete with the active transition

#### Scenario: Reduced motion or interrupted dismissal occurs
- **WHEN** reduced motion is enabled or a gesture reverses/cancels an in-progress transition
- **THEN** the surface finishes in a coherent accessible state with no stale completion action or unintended navigation

### Requirement: PDF documents open like articles

A PDF reader SHALL present the article header as soon as it is available and show the ordinary article body skeleton beneath it, with the same layout while its descriptor loads and while its pages initialize, until the page at the restored reading position has painted; the skeleton SHALL then fade out briefly (immediately with reduced motion) instead of exposing empty page slots, a restore jump or an unpainted frame. A bounded fallback SHALL reveal the document if painting is never reported. The reader SHALL NOT show a PDF-specific loading label or centered loading spinner; genuine failures keep the existing retry presentation and assistive technology still receives a non-visual loading status.

#### Scenario: A PDF is opened
- **WHEN** a user opens a PDF bookmark whose pages are not yet ready
- **THEN** the title, metadata, tags and overview appear first and a body skeleton fills the reading area until the pages are ready, without a "Loading PDF" message

#### Scenario: PDF pages finish loading
- **WHEN** the PDF reports ready and its restored visible page paints
- **THEN** the skeleton fades into the painted page without the whole screen flashing, blanking or jumping, and touches reach the document once the fade starts

### Requirement: Reader images offer long-press save and share actions

A still long press on an article image or on the current fullscreen gallery image SHALL open a bottom action sheet with Save to Photos, Share and a separated Cancel. The selected action SHALL start only after the sheet's dismissal completes. Saving SHALL request write-only photo-library access, store a correctly typed copy of the app-owned offline image and report success, permission denial or failure; sharing SHALL present the system share sheet for that copy. Long presses SHALL NOT open the gallery, a tap action, text selection or the system image callout, and stale results after replacement, account change or closing SHALL be discarded.

#### Scenario: The user long-presses an article image
- **WHEN** a user holds an article image still and chooses Save to Photos
- **THEN** the sheet closes, the image is saved to the photo library after write-only permission is granted, and a brief saved notice appears without opening the gallery

#### Scenario: The user shares an image from the gallery
- **WHEN** a user long-presses the current fullscreen image and chooses Share
- **THEN** the system share sheet presents above the gallery with the image after the action sheet has dismissed

### Requirement: Performance delivery is verified on the shipped build

Completion SHALL require passing standard mobile checks and relevant native behavior on the actual deliverable, with Release performance evidence distinguishing first presentation, admitted local-data readiness, download behavior, input responsiveness and memory. The authorized TestFlight delivery SHALL preserve production configuration, signing and main/share identities with monotonically incremented build metadata. Git delivery SHALL use the task branch and a PR to `dev`; upload acceptance, Apple processing and tester availability SHALL be reported separately. Cleanup SHALL remove only task-owned outputs after recording delivery evidence and SHALL preserve operator credentials, shared caches and required recovery/symbolication records.

#### Scenario: Validation or release cannot complete
- **WHEN** a required test, native scenario, signing stage or Apple processing check is unavailable or fails
- **THEN** that task remains explicitly incomplete with its actual evidence and blocker
- **AND** an import, bundle or successful upload request is not substituted for the missing acceptance

#### Scenario: Artifacts are cleaned after delivery
- **WHEN** the validated branch/PR and authorized TestFlight delivery have their evidence recorded and reported
- **THEN** cleanup is limited to this task's obsolete build outputs and caches without erasing shared or operator-owned state

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

On Android, where the push transition runs on the UI thread, the HTML Reader's native document host SHALL be created after the native push transition completes, or immediately when no transition occurs. On iOS, where the push is Core Animation driven, the host MAY be created during the transition. The skeleton SHALL remain over the mounted HTML host until the document reports DOM readiness, its once-only initial position restore has been applied and the restored first screen has painted. It SHALL then be removed, without waiting for external resources or the page load event and without any timeout. A content or native failure SHALL remove it immediately. The saved reading position SHALL be restored once, when the document reports DOM readiness and its first height, and SHALL NOT be adjusted again by the application before the user scrolls. Cached article bodies SHALL be read on a foreground-priority native path that does not wait behind background acquisition, concurrently with the bookmark record lookup. The Reader route's navigation-bar configuration SHALL be final from the first frame (transparent bar, fixed-size trailing slot), so opening the Reader never re-lays out the back button. Static bridge and host scripts SHALL be installed without being rebuilt per article. On Android, document height SHALL be measured by the native host and applied to the outer native scroller without a React layout round trip per height change. On iOS, inset updates SHALL be ignored when unchanged and SHALL NOT reset the scroll offset or stop deceleration while the user is dragging or the view is decelerating.

#### Scenario: A cached article is opened
- **WHEN** the user taps a cached article in the Library
- **THEN** on Android the push transition runs without concurrent WebView creation or document composition
- **AND** the article appears at its restored position without a blank frame or a visible jump from the top

#### Scenario: An article references slow external resources
- **WHEN** a cached article contains images, frames or fonts that load slowly or never finish
- **THEN** the article is presented without waiting for those resources or the page load event
- **AND** the saved position is restored once when the DOM and first height are known
- **AND** the application does not move the position again when late resources change the layout

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

### Requirement: PDF bytes and metadata stay native and local-first

PDF document bytes SHALL be delivered to the PDF reader page by a native same-origin resource handler that answers range requests from the offline engine. Committed local bytes SHALL be served first, and remote ranges fetched with the existing credential, identity and caching rules. Bytes SHALL NOT be transported through the JavaScript application runtime. Foreground PDF reads SHALL NOT wait behind background PDF acquisition. When a PDF is completely downloaded, opening it SHALL use the cached descriptor and SHALL NOT make a metadata network request. An incomplete PDF SHALL keep fetching its descriptor, falling back to the cached descriptor on network or credential failure.

#### Scenario: A downloaded PDF is opened online
- **WHEN** the user opens a PDF whose document is completely cached
- **THEN** no metadata or byte request is sent to the network
- **AND** pages render from the local file without passing bytes through the JavaScript runtime

#### Scenario: A partially cached PDF is read
- **WHEN** the reader requests a range that is not yet cached
- **THEN** the native handler fetches that range at foreground priority, even while background PDF downloads run
- **AND** a request for a different account owner, or a document whose identity changed, is rejected
