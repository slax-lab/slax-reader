# Spec Delta

## Purpose

Let users save online and already-open local PDFs from the browser extension's existing actions, with explicit permission, authentication, privacy, and processing-state boundaries.

## ADDED Requirements

### Requirement: Existing save actions support PDF viewer tabs without regressing HTML

The extension SHALL support saving from Chrome built-in PDF viewer tabs through its toolbar action and Alt+Y command, and through its existing page context-menu action where the browser exposes that menu. HTTP(S) tabs with a working HTML collector SHALL retain normal collection. A bounded unavailable-collector fallback SHALL offer URL saving in a injected overlay on the original page reusing the existing collection feedback, including extensionless PDF sources. Normal PDF save feedback MUST NOT open a new tab or separate browser window. URL suffixes and path hints MUST NOT authoritatively classify a document as PDF, bypass a working HTML collector, or trigger PDF Labs rejection.

#### Scenario: Online PDF viewer has no content script
- **WHEN** a user invokes an existing save action on an online PDF viewer whose collector is unavailable
- **THEN** a in-page collection overlay automatically handles the original source instead of silently returning or trying to serialize the viewer HTML

#### Scenario: Extensionless viewer URL
- **WHEN** a user invokes toolbar save or Alt+Y on an HTTP(S) PDF viewer URL without a `.pdf` suffix
- **THEN** the unavailable-collector fallback submits that source through the same URL-save flow

#### Scenario: HTML at a PDF-looking URL
- **WHEN** a normal HTML page at a `.pdf`-looking URL has a working collector
- **THEN** its existing HTML collection flow remains in use without a PDF-specific gate based on the URL

#### Scenario: Collector becomes ready within the bounded wait
- **WHEN** the HTML collector acknowledges readiness while a save action is waiting
- **THEN** the existing collection UI opens and no fallback submission is created

#### Scenario: Unsupported scheme
- **WHEN** a save action targets a browser-internal, other-extension, data, or blob URL
- **THEN** the extension shows an unsupported-source explanation and does not submit that URL or use it as a privileged fetch target

### Requirement: Online saves preserve the source and report acceptance honestly

The extension SHALL submit the original HTTP(S) source URL, preserving its query, to the existing URL-save API without viewer HTML or source-site cookies. The backend SHALL remain authoritative for PDF response detection and acquisition. A URL-save acceptance without a bookmark UID SHALL be presented as queued/submitted, not a readable or fully processed PDF; the extension SHALL provide navigation to the bookmark list without inventing a detail identifier. It SHALL explain the public-fetch limitation and explain that protected PDFs can be downloaded, opened in Chrome, and saved through the local flow.

#### Scenario: PDF URL contains query parameters
- **WHEN** a PDF source has a query required to retrieve the file
- **THEN** URL submission retains that query and does not replace it with a browser viewer or extension-page URL

#### Scenario: URL accepted without a bookmark identifier
- **WHEN** the URL-save response contains an empty `bmId`
- **THEN** the collection overlay reports submission for processing and offers the bookmark list, without claiming successful PDF processing or constructing a detail URL

#### Scenario: Login-protected online download
- **WHEN** the source requires browser login cookies unavailable to the server
- **THEN** the extension explains that server capture may fail, explains how to open a downloaded PDF in Chrome and invoke the local save flow, and never forwards source-site cookies or silently downloads with those credentials

#### Scenario: Server rejects URL submission
- **WHEN** the URL API returns an authentication, Labs, network, or validation error
- **THEN** the collection overlay exposes the corresponding safe error and recovery action without claiming that the bookmark was saved

### Requirement: An already-open local PDF can be acquired with browser-authorized file access

The extension SHALL save the PDF already open at the initiating `file:` source by reading that file in a supported extension context when browser-managed file access and effective file-scheme permission allow it. It MUST NOT require reselection as the only way to save an already-open local PDF. Without file permission, where Chrome prevents source-page injection, the toolbar action bubble SHALL show “Allow access to file URLs” guidance with a bundled real Chrome settings screenshot, localized steps, browser extension-settings access, and retry. It MUST NOT claim that requesting an optional permission enables the browser-managed toggle or bypass browser security.

#### Scenario: Local file access is off
- **WHEN** a user invokes save on an already-open local PDF while file access is disabled
- **THEN** the extension does not read the source, shows screenshot-backed permission guidance in the toolbar action bubble before any file acquisition and offers settings and retry, explaining that the already-open file cannot be read without this setting

#### Scenario: Permission is enabled and the extension reloads
- **WHEN** the user enables file URL access and the browser closes the collection overlay or clears its session context
- **THEN** the previously displayed guidance tells the user to return to the original PDF and invoke toolbar or Alt+Y again, which rechecks access and reads the source directly without a file picker or persistent source path

#### Scenario: Operation context survives settings
- **WHEN** the user returns from settings without losing the save operation
- **THEN** explicit retry revalidates the original source and permissions before reading it

#### Scenario: Local filename includes spaces or non-ASCII characters
- **WHEN** an allowed local PDF source has encoded spaces or non-ASCII characters in its name
- **THEN** the extension reads the intended file and derives a safe human-readable basename without transmitting its directory path

#### Scenario: Permission or file disappears
- **WHEN** file access is revoked, the file is removed, or the browser refuses the read
- **THEN** the extension shows a recoverable read/permission error, offers permission guidance or retry, and does not report a successful save

### Requirement: Local upload uses the existing bounded raw PDF contract

The extension SHALL accept one nonempty PDF file at most 50 MiB, enforce a bounded read with timeout/cancellation, and validate the PDF signature in the first 1024 bytes before upload. The server's independent validation SHALL remain authoritative. Upload SHALL use the existing endpoint with a raw File body, `Content-Type: application/pdf`, and a sanitized basename-only filename query; multipart, JSON, and base64 bodies MUST NOT replace that contract. A successful upload SHALL retain existing private-by-default semantics and expose the returned bookmark UID using the backend's positive numeric encoded bookmark ID contract. Saved-file status MUST NOT imply completed text extraction.

#### Scenario: Valid local PDF upload
- **WHEN** an authenticated, PDF-enabled user uploads valid bytes within the limit
- **THEN** the request body exactly matches those bytes, the filename is only a basename, and a valid success response enables navigation to the returned bookmark UID's reader

#### Scenario: Exact size boundary
- **WHEN** a valid file is exactly 50 MiB
- **THEN** the extension permits upload while rejecting an otherwise valid file one byte larger

#### Scenario: Invalid or empty file
- **WHEN** a chosen or directly read file is empty or lacks the required PDF signature
- **THEN** the extension shows validation feedback and does not upload it as a PDF

#### Scenario: Read exceeds its size or time budget
- **WHEN** local acquisition exceeds the byte limit or times out
- **THEN** the extension stops the read, releases retained data, and shows a safe retryable failure rather than continuing an unbounded read

#### Scenario: Signature-bearing document cannot be processed
- **WHEN** a signature-bearing file is later rejected or cannot be parsed by the existing server/reader
- **THEN** the extension does not assert successful extraction and the existing document error behavior remains authoritative

#### Scenario: Upload response is incomplete
- **WHEN** an apparent upload response lacks the expected nonempty bookmark UID or positive numeric encoded bookmark ID
- **THEN** the extension reports an invalid result without fabricating a reader link or marking the operation saved

### Requirement: Authentication and PDF Labs eligibility remain authoritative

The extension SHALL use the existing current-account session and client headers. Local upload controls SHALL be available only after loaded Labs state enables PDF, and direct local reads/uploads SHALL not start for disabled or unknown eligibility. The extension MUST NOT enable Labs automatically or provide its own enable control; users opt in through the PDF bookmarks switch in Web Settings Labs. Online URL saves SHALL not be PDF-gated from URL hints; server detection SHALL enforce existing acquisition policy. Users without PDF opt-in SHALL remain unable to acquire new PDFs until they turn on PDF bookmarks in Web Settings, while access to existing PDFs SHALL remain unchanged.

#### Scenario: Login is required
- **WHEN** the save flow has no valid session or receives an authentication failure
- **THEN** it retains a visible login-required state, offers the existing login flow, and requires an explicit retry after reauthentication without losing the pinned source

#### Scenario: PDF Labs is disabled
- **WHEN** an account has no PDF opt-in
- **THEN** local upload remains unavailable, the extension explains that PDF saving is unavailable for the account, and it neither silently opts in nor claims the account is already eligible; the user can turn on PDF bookmarks in Web Settings Labs

#### Scenario: Labs state cannot be loaded
- **WHEN** the extension cannot establish that PDF is enabled for local upload
- **THEN** it does not read/upload the local source or expose an enabled upload entry and offers an explicit state-refresh retry

#### Scenario: Eligibility changes after the local check
- **WHEN** the backend rejects an upload with `LAB_FEATURE_DISABLED` after the extension loaded enabled state
- **THEN** the extension stops, displays blocked feedback, and does not retry around the gate

#### Scenario: PDF is detected only after URL acceptance
- **WHEN** a queued extensionless URL is later identified as PDF for a disabled account
- **THEN** existing backend capture policy can mark acquisition failed and the extension's initial acknowledgement remains only a submission claim

#### Scenario: Account changes while a file is pending
- **WHEN** the user logs out or changes account during a pending local operation
- **THEN** retained file data is discarded and a fresh explicit attempt is required before saving to the new session

### Requirement: Save operations remain bound to their initiating source

A save operation SHALL remain bound to the initiating tab and navigation, not whichever tab is active after login, settings, or focus changes. Repeated actions on the same source while its operation is active SHALL reuse one visible source overlay and cause at most one active submission. Source changes before submission SHALL invalidate the operation. After submission, results MUST NOT update another navigation's bookmark state or mark a viewer/collection overlay as a ready HTML collector. Worker restarts SHALL not silently replay a submission. Operation metadata SHALL be session-only, bounded, and expired; file bytes and tokens MUST NOT be persisted.

#### Scenario: Focus changes to another tab
- **WHEN** the user switches tabs while login, settings, or file work is pending
- **THEN** retry still targets the pinned original source rather than the newly active tab

#### Scenario: Source navigates or closes before submission
- **WHEN** the source tab changes navigation or closes before reading/submitting completes
- **THEN** the extension stops with source-changed feedback and does not submit the replacement page or file

#### Scenario: Source navigates after submission
- **WHEN** a submitted save completes after the source tab navigates
- **THEN** the result remains attached to its original operation and does not update the replacement page's saved indicator

#### Scenario: Rapid repeated actions
- **WHEN** toolbar, Alt+Y, or context-menu save is invoked repeatedly for the same active source operation
- **THEN** the existing collection overlay is reused and only one upload or URL submission is active

#### Scenario: Worker restart or abandoned operation
- **WHEN** the worker restarts or the collection overlay is closed or expires
- **THEN** surviving operation identity is reconciled without automatic replay, interrupted work requires explicit retry, and stale metadata/file references are released

### Requirement: Privileged acquisition protects file paths and credentials

The extension MUST accept privileged PDF operation messages only from its own exact allowed collection overlay bound to an existing operation. Extension ID alone SHALL NOT authorize content-script senders. Messages MUST NOT accept arbitrary fetch URLs or substitute caller-provided source identities. Full local paths and file URLs MUST NOT be sent to the API, analytics, logs, page URLs, or persistent storage; the bounded session metadata required to address the selected source SHALL remain restricted to trusted extension contexts. PDF binary data SHALL only be transmitted to the configured Slax upload endpoint during an explicit eligible save, with existing private-file access semantics unchanged.

#### Scenario: Website or content script attempts a forged operation
- **WHEN** an untrusted sender submits an operation ID, source URL, or tab ID to a privileged handler
- **THEN** the extension rejects it without reading a file, making a fetch, or exposing operation metadata

#### Scenario: Save page identity is invalid
- **WHEN** a different extension page, unbound save-frame identity, missing operation, or expired operation requests access
- **THEN** the request is rejected without privileged side effects

#### Scenario: Local-path privacy
- **WHEN** a local save succeeds or fails
- **THEN** outbound requests contain only the permitted basename and raw PDF bytes, and logs/analytics/page URLs contain no local URL, directory path, raw binary, session token, or source-site cookie

### Requirement: Feedback, cancellation, and retries remain visible and accessible

The injected source-page collection overlay SHALL remain visible across focus changes and provide localized preparing, permission, authentication, submitting, queued, saved, cancelled, and error states as applicable. Controls SHALL have accessible names and visible keyboard focus, status changes SHALL be announced, and layout SHALL remain usable with long filenames and narrow windows in the existing compact collection-feedback presentation documented in DESIGN.md. The missing-file-permission action bubble follows the browser’s normal popup lifetime, and its instructions SHALL explain returning to the source after settings changes. Retry SHALL be explicit and revalidate source, permissions, session, and eligibility. Cancellation SHALL release local resources and abort outstanding work where possible without falsely promising rollback of a server-accepted save.

#### Scenario: User cancels during upload
- **WHEN** the user cancels an in-flight upload
- **THEN** the extension aborts the client operation where possible, releases retained bytes, and explains that an already accepted server save may still finish

#### Scenario: Network failure and retry
- **WHEN** an upload or URL request fails in transit and the user chooses retry
- **THEN** the extension revalidates the operation, starts at most one new request, and distinguishes an uncertain previous outcome from confirmed success

#### Scenario: Keyboard and localized feedback
- **WHEN** the collection overlay is operated by keyboard in either supported locale at a narrow window width
- **THEN** status and recovery controls remain readable, labelled, focus-visible, and usable without relying on hover or color alone

#### Scenario: One action starts saving
- **WHEN** a user invokes the extension on an online PDF or a local PDF with file access enabled
- **THEN** the collection popup automatically calls the existing backend save flow, reports progress and its actual result, and does not require another Save click or open a full-page save tab

#### Scenario: Settings illustration explains the required permission
- **WHEN** file URL access is disabled for a local source
- **THEN** the popup includes a code-drawn illustration of the Allow access to file URLs switch with a locale-appropriate label and descriptive accessible name, localized instructions to enable it, and an action opening this extension's details

#### Scenario: Permission guidance has a clear visual hierarchy
- **WHEN** the permission bubble appears in either supported locale
- **THEN** it shows one heading, concise numbered setup steps with the switch illustration under the step that uses it, a prominent settings button and a secondary retry action, with visible keyboard focus and guidance to return to the original PDF after enabling access

#### Scenario: Original PDF page hosts the collection feedback
- **WHEN** an online PDF or a file-access-enabled local PDF is saved
- **THEN** the existing injected source-page overlay reports progress and results, no separate tab or window is created, and inline success feedback closes after the normal two-second interval

#### Scenario: Overlay enters and leaves with the page-save motion
- **WHEN** the injected collection overlay opens or closes on a PDF page
- **THEN** it fades and slides in from above and out again over 250 milliseconds like the page-save popup, ignores pointer input while leaving, may be replaced by a new overlay during that exit, and is removed immediately when the user prefers reduced motion or the page is torn down

#### Scenario: Feedback text is readable
- **WHEN** any PDF save state is displayed
- **THEN** its status and action text reach at least 4.5:1 contrast on the white surface, the close control and action buttons have hit areas of about 32 pixels, and the page-save popup's own palette is unchanged

#### Scenario: A website copies a visible operation ID
- **WHEN** a website embeds its own copy of the save document with that operation ID
- **THEN** the sibling frame cannot claim or submit because only the isolated source controller can confirm the actual collection iframe

### Requirement: Confirmed uploads retain success and metadata titles

The extension SHALL accept the existing numeric bookmark ID and nonempty bookmark UID as a confirmed local upload result. It SHALL NOT replace confirmed success with uncertain-request feedback solely because subsequent extension state synchronization fails. Local collection display SHALL prefer normalized XMP dc:title, then document-info Title, then a confident first-page heading resolved by the backend, then the filename without its PDF suffix. Filename upload metadata SHALL remain the original safe basename. The backend SHALL persist and return the metadata title before acknowledging a new local upload, with full text extraction remaining asynchronous and user aliases unchanged. Metadata failures SHALL fall back without blocking valid-file saving.

#### Scenario: Backend returns its numeric bookmark ID
- **WHEN** a local upload returns a positive numeric bookmark ID and nonempty bookmark UID
- **THEN** the original overlay reports saved and exposes the reader UID instead of uncertain-request feedback

#### Scenario: Synchronization fails after confirmed upload
- **WHEN** upload has been confirmed and the extension completion message fails
- **THEN** the overlay retains the saved result without issuing another upload

#### Scenario: Metadata title differs from the filename
- **WHEN** a local PDF contains a nonempty normalized XMP or document-info title
- **THEN** collection displays that title, upload sends the original basename, and the saved list title is persisted before acknowledgement

#### Scenario: Metadata cannot be read
- **WHEN** a valid signature-bearing file has unavailable or empty title metadata and no confident first-page heading
- **THEN** collection and initial saved title fall back to the filename without its PDF suffix while file saving remains available

An explicit repeat upload of identical bytes also repairs a legacy filename-derived stored title when embedded metadata is available, without replacing the original file, resetting extraction state, or touching the user alias. No bulk backfill is performed.

### Requirement: Online saves resolve visible titles when metadata is empty

The backend SHALL retain XMP and document-info title priority. When these titles are absent, it SHALL use a confidently identified selectable first-page heading before the filename fallback. It SHALL ignore rotated margin identifiers, page numbers and body text as title candidates, and SHALL combine adjacent aligned title lines. Ambiguous or unavailable heading text SHALL leave the filename fallback available without blocking PDF saving. Cached explicit saves SHALL refresh the title from original stored bytes without replacing the file or changing user aliases.

#### Scenario: The supplied metadata-empty arXiv document
- **WHEN** the supplied PDF at https://arxiv.org/pdf/2406.00845 is captured
- **THEN** the stored title is the complete two-line first-page heading rather than its numeric URL basename or rotated arXiv identifier

#### Scenario: Metadata remains authoritative
- **WHEN** usable title metadata differs from the first-page heading
- **THEN** the existing XMP/document-info precedence remains in use

#### Scenario: Cached PDF has an older filename title
- **WHEN** an explicit save reuses an already stored PDF with a discoverable title
- **THEN** the title is refreshed from its immutable original while bytes, extracted text and user alias remain unchanged
