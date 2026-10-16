# Mobile Performance Lifecycle Spec Delta

## Purpose

Keep normal mobile startup, offline acquisition and rich reading responsive as local content grows, while preserving account isolation, recoverable data, continuous image interaction and truthful release evidence.

## ADDED Requirements

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

A PDF reader SHALL present the article header as soon as it is available and show the ordinary article body skeleton beneath it until the PDF document reports ready, both while its descriptor is loading and while its pages initialize. The reader SHALL NOT show a PDF-specific loading label or centered loading spinner; genuine failures keep the existing retry presentation and assistive technology still receives a non-visual loading status.

#### Scenario: A PDF is opened
- **WHEN** a user opens a PDF bookmark whose pages are not yet ready
- **THEN** the title, metadata, tags and overview appear first and a body skeleton fills the reading area until the pages are ready, without a "Loading PDF" message

### Requirement: Sidebar motion settles over the remaining distance

The library sidebar SHALL settle with a short emphasized-decelerate motion whose duration scales with the distance remaining after a drag, remain interruptible from its in-flight position, and honor reduced motion.

#### Scenario: The user releases a partially opened sidebar
- **WHEN** a drag leaves the sidebar most of the way open and the user releases it
- **THEN** it completes in proportionally less time than a full open, and a reversed gesture continues from the actual current position

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
