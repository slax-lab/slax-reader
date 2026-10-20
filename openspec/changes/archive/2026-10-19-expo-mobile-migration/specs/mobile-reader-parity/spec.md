# Mobile Reader Parity Spec Delta

## Purpose

Preserve the existing rich article and RSS reading experience, especially accurate text selection, historical annotations, media, and offline content.

## ADDED Requirements

### Requirement: Article presentation preserves source content and states

The reader SHALL preserve the existing article HTML, scoped styles, title/date/original-link/tags, AI overview, scroll-responsive tools, and source error/refresh feedback. Following the user's explicit performance-first revision, initial loading feedback SHALL reflect actual unavailable content rather than an artificial mount delay; cached readable content and known headers SHALL become available without a mandatory skeleton interval. Personal and shared collection articles SHALL retain their distinct ownership context. A plain-text or paragraph-only rendering MUST NOT substitute for source rich content.

#### Scenario: Cached content is opened
- **WHEN** a valid account-owned cached article is available
- **THEN** content preparation does not wait for a fixed animation timer, optional AI/profile loading, or unrelated cache bookkeeping
- **AND** saved position, annotations and account isolation remain correct

#### Scenario: A cached outline is scrolled
- **WHEN** only the outline scroll position changes
- **THEN** the application does not reparse its unchanged Markdown or replace the document content
- **AND** the latest position is retained for lifecycle persistence

#### Scenario: A mixed-content article opens
- **WHEN** an article contains images, lists, links, code, formulas, tables, or supported embedded content
- **THEN** it retains the source rendering and applicable interactions
- **AND** app-shell styles do not inadvertently rewrite embedded article presentation

### Requirement: Arbitrary selection and historical marks remain accurate

Users SHALL retain arbitrary text selection, cross-paragraph handle dragging, copy, highlight creation/removal, and comment creation with correctly placed contextual controls. Existing node-path/offset and contextual-text annotations SHALL resolve to the correct content after migration; overlapping stroke/comment appearance and clicking an existing mark SHALL retain source behavior.

#### Scenario: A user selects across paragraphs
- **WHEN** selection spans multiple text nodes and paragraphs
- **THEN** the exact selected range can be copied, highlighted, or commented on
- **AND** scrolling, safe-area offsets, and selection handles do not misplace the action menu

#### Scenario: Historical marks are restored
- **WHEN** a saved article contains legacy path-based or approximate-text marks
- **THEN** those marks attach to the intended text
- **AND** migration does not silently discard the source range or replace it with whole-paragraph selection

### Requirement: Comments retain threading and permissions

The reader SHALL preserve quoted excerpts, profiles/timestamps, threaded replies, expansion, own-comment deletion confirmation, reply prefixes, keyboard/focus handling, discard confirmation, copy/line actions, nonempty validation, and the existing 1500-character limit. Shared collection permissions SHALL govern mark visibility, profile display, and creation/deletion independently of personal-bookmark permissions.

#### Scenario: A user replies to a shared-collection comment
- **WHEN** the source permissions allow that reply
- **THEN** the reply attaches to the correct thread and author context
- **AND** a denied action remains unavailable even when a panel is already open

### Requirement: Tags and article actions preserve optimistic behavior

The reader SHALL preserve assignment/removal, creation, autocomplete and existing-name reuse, title editing, star/archive/delete where allowed, manual caching, outbound sharing, original opening, and contextual feedback. Pending local edits SHALL merge correctly with streamed remote state.

#### Scenario: A tag is created while synchronization is delayed
- **WHEN** the user creates or assigns a tag before the remote stream catches up
- **THEN** the tag appears with the source optimistic behavior
- **AND** a later stream update does not drop, duplicate, or undo that edit

### Requirement: AI and outline panels retain streaming and cache behavior

The reader SHALL preserve overview/key-takeaway streaming, cached/offline results, expanded summary panels, Pro-gated outline generation, Markdown rendering, collapse/expand/hide states, outline anchor jumps, panel scroll restoration, and source metrics. Pending operations and errors SHALL remain visible and cancellable with the original navigation behavior.

#### Scenario: Cached AI content is read offline
- **WHEN** cached overview or outline content exists without connectivity
- **THEN** that content remains readable
- **AND** uncached requests show the source offline state rather than fabricated results

### Requirement: Images and video transcripts retain interactions

The reader SHALL preserve cache-aware fullscreen image paging, count, dismissal, pinch/pan/double-tap zoom, and supported embedded video playback. YouTube transcript panels SHALL retain current-cue positioning and cue-to-seek/play actions without reloading the article or losing reading state.

#### Scenario: A transcript cue is selected
- **WHEN** the user selects a cue in an article with supported YouTube content
- **THEN** the embedded player seeks and plays at that cue
- **AND** the source scrolling and transcript state remain consistent

### Requirement: Reading positions and cached resources survive lifecycle changes

The reader SHALL retain separate article and outline positions, source debounce behavior, immediate flushing on exit/background, continue-reading context, and cached article/image delivery. Resource interception SHALL preserve cancellation and safe original-content fallback. Platform-specific scrolling coordinates SHALL be translated correctly rather than copied between Android and iOS.

#### Scenario: The reader backgrounds before a debounce expires
- **WHEN** the user scrolls and immediately backgrounds or leaves the page
- **THEN** the latest position is persisted
- **AND** reopening the same personal or collection article restores the intended position and context

### Requirement: PDF uses the existing native Reader shell

The application SHALL render PDF bookmarks in its existing Reader route using locally bundled PDF.js and its matching worker/assets, without remote Web pages, Vue/Nuxt runtime, or a native PDF SDK. PDF and native title/tags/overview widgets SHALL share the existing HTML Reader's platform scroll model: one WK scroll owner with measured native header/insets on iOS, and one outer native scroller containing header and document-height non-scrolling WebView on Android. There SHALL NOT be a capped independent header scroller or separate PDF vertical viewport. PDF SHALL fit available Reader width by default without a PDF page/zoom/Fit toolbar. PDF text selection SHALL come from document text layers and retain document identity, page and unscaled quadrilaterals. Native comments, replies, permissions and synchronization SHALL remain the source of truth.

#### Scenario: A PDF passage is annotated
- **WHEN** a user selects PDF text across lines or rendered pages and highlights or comments
- **THEN** its exact text and page segments are saved through existing mark records
- **AND** Web and Mobile restore the same range after reopening, zoom, rotation and page eviction

#### Scenario: A PDF comment is selected
- **WHEN** the user selects a saved note
- **THEN** the corresponding page and passage are revealed
- **AND** removing a highlight preserves associated comments and existing ownership rules

### Requirement: PDF downloads extend the foreground cache queue

The application SHALL use the existing foreground download queue for automatic PDF caching under the same eligibility, cache-window and retention policy as ordinary articles, with prioritized reader range requests. Following the user's performance-change instruction, no standalone PDF offline-download button SHALL be exposed or required. Requested blocks SHALL be deduplicated and validated against the immutable document version. Files and task metadata SHALL be isolated by environment, account and bookmark access context. Only a completely downloaded, size/hash-verified document SHALL be recorded as offline-complete. The PDF Reader SHALL NOT show offline/completion badges or partial-cache rows; state remains internal. No OS background transfer service SHALL be introduced.

#### Scenario: Reading overlaps prefetch
- **WHEN** PDF.js requests bytes already cached or scheduled by prefetch
- **THEN** the queue reuses valid blocks or joins/promotes existing work instead of independently downloading the same block

#### Scenario: Download is interrupted
- **WHEN** connectivity is lost, the application backgrounds or restarts
- **THEN** valid completed blocks survive and missing ranges resume on foreground
- **AND** a partial file is not reported as a complete offline download

#### Scenario: Account changes during download
- **WHEN** an account or environment is replaced while a PDF request is pending
- **THEN** old tasks and resource handles are revoked and late responses cannot write or display in the new scope

### Requirement: PDF metadata and bytes have native-client contracts

Mobile SHALL consume the existing authenticated `/v1/bookmark/metadata` response's nested `data.pdf` descriptor and existing `/v1/bookmark/pdf` binary delivery without introducing a backend route or changing server range behavior. The client SHALL validate descriptor document SHA-256/size, response media type, Content-Range and actual length, and handle binary successes and HTTP errors without decoding PDF as HTML/JSON. A missing ETag on valid 200/206 delivery SHALL NOT cause rejection; any supplied ETag is an optional additional consistency check, not a mandatory server capability. Only full size- and SHA-256-verified bytes SHALL be marked offline-complete.

#### Scenario: A resumed document has a different identity
- **WHEN** the authorized metadata identity changes or completed bytes fail its full-file hash
- **THEN** incompatible partial bytes are invalidated rather than combined or labelled complete

#### Scenario: Existing range delivery omits ETag
- **WHEN** the existing backend returns valid PDF 206 bytes matching the requested range and descriptor total size without ETag
- **THEN** the mobile client accepts the range without requiring a new endpoint, conditional-response feature or deployment
- **AND** complete-file SHA-256 remains required for verified offline completion; range checks alone are not represented as cryptographic block verification

### Requirement: PDF acquisition and AI retain Labs behavior

Mobile SHALL expose the existing PDF Labs opt-in and allow one local PDF upload up to 50 MiB through the existing raw upload endpoint. Existing PDFs SHALL remain readable after opt-out. PDF URL saves SHALL use the normal capture flow. AI SHALL use existing server-extracted text and retain pending, empty and failed eligibility internally without inventing OCR. Ordinary PDF reading SHALL NOT show an AI-preparation/extraction notice or unsolicited extraction error panel; missing text SHALL NOT block pages. Explicit AI actions SHALL remain truthful through the existing app action presentation. PDF Reader headers SHALL display the article title rather than extra filename/raw-URL metadata; filename and raw URL MUST NOT become header-title fallbacks. The explicit original-link action may remain. The import picker may still identify its selected file.

#### Scenario: A local PDF is uploaded
- **WHEN** an opted-in user picks a valid local PDF and upload succeeds
- **THEN** the new bookmark appears through normal synchronization and opens in the same Reader
- **AND** cancellation, invalid size, missing connectivity and failed upload do not report success

#### Scenario: A scan has no text
- **WHEN** a scanned PDF has no selectable or extracted text
- **THEN** pages remain readable while selection and text-based AI accurately reflect that limitation
- **AND** ordinary reading shows no AI-preparation notice, extraction-error panel or PDF cache-status badge

### Requirement: PDF scrolling uses one host geometry contract

The PDF host SHALL expose the actual viewport offset/height and document height required for bounded page rendering, restoration and note anchors. Android virtualization MUST NOT treat its document-height WebView `innerHeight` as the screen viewport. Document-bound page/fraction persistence SHALL remain separate from physical scroll metrics used by floating controls and selection placement. Header/inset changes, rotated/mixed pages and page eviction SHALL preserve coherent passage positions without rendering every page at once.

#### Scenario: Header and PDF are scrolled on Android
- **WHEN** the user drags the Reader through native metadata into PDF pages
- **THEN** one outer native scroller moves header and document while the custom WebView's independent vertical scrolling is disabled
- **AND** visible pages are determined from the native host viewport, with bounded rendering and correctly placed selection actions

#### Scenario: PDF header layout changes on iOS
- **WHEN** tags, overview, safe areas or layout change the measured native header
- **THEN** the WK scroll owner updates its inset/header behavior through the established HTML Reader contract
- **AND** note jumps, selection coordinates and document-bound restoration remain aligned without a second header scroller

### Requirement: PDF failures retain cause and appropriate recovery

The client SHALL classify real Expo network errors, cancellation, timeout, HTTP authorization, document identity/integrity, storage and native/worker rendering failures at their owning boundary. Diagnostics SHALL use bounded stage/error codes without credentials, private full URLs, document content or selected text. One layer SHALL own bounded retry/resume with account/document/lifecycle cancellation and consistent timeouts. Genuine load failures SHALL use the normal Reader error/retry presentation once; cancelled or failed annotation/interaction commands MUST NOT destroy otherwise readable content. Access and integrity rejection SHALL remain fail-closed rather than treating every HTTP 404 as offline or fetching an unauthenticated replacement.

#### Scenario: Native transport fails while cached bytes exist
- **WHEN** the actual Expo transport reports a network error rather than an HTTP access or integrity rejection
- **THEN** correctly scoped valid cached bytes and bounded retry policy follow the normalized failure category
- **AND** cancellation or account replacement cannot publish late content or duplicate error UI

#### Scenario: The deployed metadata contract is unavailable
- **WHEN** the actual target environment cannot satisfy the authorized PDF metadata/range flow
- **THEN** the error retains its failing stage and required environment action is reported explicitly
- **AND** fixture success or an unauthenticated probe is not reported as fixing the user's document, and backend deployment requires separate authorization

#### Scenario: Test-environment authentication is rejected
- **WHEN** the supplied credential receives HTTP 401 from user identity and PDF metadata checks on the configured test origin
- **THEN** the intended environment and valid authenticated scope are confirmed before further document-access claims or cross-origin credential use
- **AND** neither successful local refresh logic nor fixture rendering is reported as a fixed live PDF, and token values are absent from logs, artifacts and fixtures

#### Scenario: An annotation command is cancelled
- **WHEN** a command is cancelled by document or lifecycle ownership while PDF pages remain readable
- **THEN** it cannot replace a genuine load cause with a generic fatal error or unmount the readable document
- **AND** draft, selection and exit behavior continue to follow existing native ownership rules
