# Spec Delta

## Purpose

Allow users to save PDF links or upload PDF files and read, highlight, and discuss their contents through the existing bookmark preview and notes experience, including mobile WebViews.

## ADDED Requirements

### Requirement: PDF acquisition requires Labs opt-in

PDF bookmarks SHALL be an active, disabled-by-default per-user Labs feature. The frontend SHALL show the upload entry only when its loaded Labs state enables `pdf`. The backend SHALL require opt-in for uploads and new PDF acquisition through REST URL saves, imports, and capture workflows, including extensionless responses. Sync mutation acceptance and dispatch SHALL NOT validate Labs state. Disabling the switch SHALL preserve read access to existing saved PDFs. Existing non-PDF Labs acquisition gates SHALL remain enforced by the crawl workflow.

#### Scenario: Labs is disabled
- **WHEN** a user without PDF opt-in opens the bookmark dialog or requests PDF upload
- **THEN** the upload entry is hidden and the backend rejects uploads before reading the file or creating a bookmark

#### Scenario: PDF is identified from the response
- **WHEN** a pending URL save or import identifies PDF from the response media type or file signature for a user without PDF opt-in
- **THEN** the capture rejects before full-file download or PDF persistence, terminates without retry or fault alert, and records the failed save

#### Scenario: PDF is saved through synchronization
- **WHEN** synchronization saves a PDF link or re-saves a cached PDF while Labs is disabled or unavailable
- **THEN** the batch and workflow dispatch do not consult Labs, unrelated pending mutations can commit, cached PDF relations retain the PDF type, and new acquisition is gated independently by the capture workflow

#### Scenario: Labs is enabled
- **WHEN** the user enables PDF bookmarks in Labs
- **THEN** the upload entry becomes available and authorized PDF URL saves and uploads can complete

#### Scenario: Non-PDF Labs acquisition after synchronization
- **WHEN** synchronization accepts a YouTube URL while its Labs feature is disabled
- **THEN** synchronization and unrelated changes can complete, while the crawl workflow rejects that acquisition before cache reuse or provider fetching, marks it failed without retry or fault alerts, and applies the same check to a short link resolved to YouTube

### Requirement: PDF title uses embedded metadata when available

PDF extraction SHALL prefer a nonempty XMP `dc:title`, then document-info `Title`, and fall back to the filename. It SHALL prefer XMP `dc:creator`, including author lists, then document-info `Author`, and save usable author text in the existing byline. Missing authors SHALL remain empty; creation software SHALL NOT be substituted for an author. Metadata read failure SHALL not prevent preview or text extraction. User alias titles SHALL remain unchanged. The client MAY supplement missing author display from metadata of its already-loaded PDF without changing persisted data.

#### Scenario: Embedded title is available
- **WHEN** a PDF with a metadata title completes extraction
- **THEN** the bookmark base title uses the normalized metadata title instead of the filename

#### Scenario: PDF has no embedded title
- **WHEN** metadata is absent or unreadable
- **THEN** the bookmark retains a filename-derived title and its normal extraction state

### Requirement: PDF preview displays source and available authors

After client detail loading, the PDF header SHALL display available author metadata and its source using the existing reader visual system. URL PDFs SHALL link to the original saved URL. Uploaded PDFs SHALL display a localized local-upload label and filename without linking a synthetic `slax-pdf` URL. Missing authors SHALL not produce empty author separators. The source display SHALL support narrow H5 layouts and the existing themes without changing HTML article presentation or PDF title/type-only SSR.

#### Scenario: Original PDF source
- **WHEN** a URL PDF detail is loaded
- **THEN** its source badge links to the saved URL and shows available author metadata

#### Scenario: Uploaded PDF source
- **WHEN** an uploaded PDF detail is loaded
- **THEN** its source shows local upload, its filename, and any available author without exposing a synthetic link

#### Scenario: Scanned PDF author metadata
- **WHEN** a scanned PDF has author metadata but no selectable text
- **THEN** its author remains available for display while AI retains the empty-text state

### Requirement: PDF links become PDF bookmarks

The system SHALL recognize a publicly accessible PDF response saved through the existing bookmark flow, retain the original file, and expose the completed bookmark as type `pdf`. New URL captures SHALL be identified from the final response Content-Type media type matching `application/pdf` case-insensitively and excluding parameters, or a PDF file signature in a bounded prefix of the response body. URL suffixes, host names, and path patterns MUST NOT classify the response or trigger PDF Labs rejection before response detection. Downloaded bytes MUST pass PDF file-integrity validation before storage. Existing HTML article capture SHALL remain supported.

#### Scenario: Save a PDF link
- **WHEN** an authenticated user saves a public PDF URL
- **THEN** the bookmark progresses through the existing capture status flow, retains the PDF, appears in the user's bookmark list, and opens the PDF preview after successful capture

#### Scenario: PDF URL has no file extension
- **WHEN** a saved URL without a `.pdf` suffix returns a PDF response
- **THEN** the system recognizes the PDF and creates a PDF bookmark

#### Scenario: URL hints do not identify PDF
- **WHEN** a URL has a `.pdf` suffix or arXiv `/pdf/` path but neither its response media type nor its file signature identifies PDF
- **THEN** capture continues through the ordinary path without selecting PDF or checking PDF Labs based on the URL

#### Scenario: Generic or missing media type
- **WHEN** a response uses `application/octet-stream` or omits Content-Type but its bounded prefix contains a PDF file signature
- **THEN** capture identifies PDF and applies the normal Labs, size, and integrity checks

#### Scenario: PDF media type includes parameters
- **WHEN** the final response declares `APPLICATION/PDF` or `application/pdf; charset=binary`
- **THEN** capture identifies PDF from the media type without needing to sniff the probe body

#### Scenario: Save through the local bookmark path
- **WHEN** a PDF URL is created through local bookmark synchronization
- **THEN** its eventual server capture and synchronized list entry identify the bookmark as a PDF

#### Scenario: Failed PDF capture
- **WHEN** a response identified as PDF is unsuccessful or its downloaded body lacks a valid PDF signature
- **THEN** the bookmark exposes a failed capture state and the system does not pass PDF bytes to the HTML article parser

### Requirement: Users can upload a PDF from the bookmark entry

The system SHALL let an authenticated user select and upload one local PDF from the existing add-bookmark dialog. The accepted file size SHALL be greater than zero and at most 50 MiB. The server MUST enforce the limit and PDF signature independently of browser validation. A successful upload SHALL create a private PDF bookmark with a readable filename-derived title and make it available in the existing list and preview.

#### Scenario: Successful upload
- **WHEN** an authenticated user selects a PDF within the size limit and completes upload
- **THEN** the dialog reports completion and the uploaded PDF is available as a normal bookmark that opens in the PDF preview

#### Scenario: Reject an invalid upload
- **WHEN** the file is empty, exceeds 50 MiB, or does not contain a PDF signature
- **THEN** upload fails with a clear error and no successfully completed PDF bookmark or orphaned uploaded file is left behind

#### Scenario: Upload fails in transit
- **WHEN** uploading or saving the file fails
- **THEN** the dialog displays the failure, permits retry, and does not report a successful bookmark

### Requirement: PDF file delivery preserves bookmark access

PDF bytes SHALL be available only to a viewer with the corresponding bookmark's existing read access. Uploaded PDFs SHALL be private by default. Existing sharing settings SHALL govern PDF preview and visible highlights and comments. Binary file delivery SHALL support single byte-range requests and SHALL prevent private content from being stored in a public response cache.

#### Scenario: Read a private PDF
- **WHEN** the owner opens a private PDF bookmark
- **THEN** its file and permitted highlights and comments are available

#### Scenario: Another user requests a private file
- **WHEN** an unauthenticated viewer or unrelated user requests a private PDF by its bookmark identifier
- **THEN** neither the file nor its private metadata is disclosed

#### Scenario: Share is disabled after a visit
- **WHEN** a viewer requests a PDF after its sharing access has been disabled
- **THEN** a fresh file or range request is denied using the existing access policy

#### Scenario: Hidden shared highlights and comments
- **WHEN** a viewer opens a shared PDF whose sharing settings hide highlights or comments
- **THEN** the corresponding highlights and comments are not disclosed or rendered

#### Scenario: Request part of the PDF
- **WHEN** an authorized viewer requests a valid single byte range
- **THEN** the response returns the matching bytes and correct partial-content headers; an unsatisfiable range returns an appropriate error

### Requirement: The preview selects a dedicated PDF reader

The existing bookmark preview SHALL render PDF pages directly in its content flow, with the detail page's vertical scrolling and no enclosing viewer frame or separate vertical scroll container. A collapsible side control rail SHALL provide page navigation, fit-to-width, and zoom; the reader SHALL provide loading and error states. It MUST NOT decode the binary file as HTML or include it as text in server-rendered page data. The reader SHALL work in a mobile web layout and expose the same preview route for the application's WebView. Rendering work and live page canvases SHALL be bounded independently of total document length.

#### Scenario: Open a PDF bookmark
- **WHEN** a viewer opens a successfully saved PDF bookmark
- **THEN** the preview displays PDF pages and page/zoom controls within the existing reader shell

#### Scenario: PDF server rendering contains only the title
- **WHEN** a PDF preview is server-rendered
- **THEN** it exposes only the document title and a PDF type discriminator in its content data, with no descriptor, extracted text, notes, or AI output; the client loads metadata and file bytes through authorized endpoints after hydration

#### Scenario: Preserve the existing reading width
- **WHEN** a PDF opens or its notes panel changes width
- **THEN** the PDF fits the existing article content width by default with its established desktop/H5 spacing, while HTML article width and presentation remain unchanged

#### Scenario: PDF metadata fails to load
- **WHEN** a client request for PDF metadata fails
- **THEN** the title remains visible with a clear failure state and a retry action that restores document and notes loading

#### Scenario: Read and control pages in the detail content
- **WHEN** the viewer scrolls a PDF or uses the side page controls
- **THEN** the detail page scrolls through PDF pages directly, the current page indicator follows reading progress, and collapsing the side controls reclaims reading space

#### Scenario: Toggle page gaps
- **WHEN** a PDF opens and the reader toggles page gaps in its side controls
- **THEN** pages start without an inter-page gap and the toggle can restore or remove spacing without changing page dimensions or persisted mark alignment

#### Scenario: Read on a narrow viewport
- **WHEN** the preview is opened in a mobile viewport
- **THEN** pages initially fit the available width and reader and comment controls remain reachable without losing mark alignment

#### Scenario: Open a long PDF
- **WHEN** a viewer opens and scrolls a long document
- **THEN** visible pages become available progressively and distant page canvases are released instead of all pages being rendered and retained at once

#### Scenario: Document cannot be opened
- **WHEN** the PDF is corrupt or requires a password
- **THEN** the reader displays a clear document error or unsupported-password message and does not present unusable mark controls

### Requirement: PDF highlights use persistent page geometry

An authorized owner SHALL be able to highlight selectable PDF text and restore the same highlight when the document is reopened. Each selection SHALL retain its page-specific geometry and selected text. Highlights MUST remain aligned after zoom, width changes, display-density changes, and page unmount/remount. A selection spanning rendered pages SHALL preserve all of its page segments as one logical mark.

#### Scenario: Long PDF selections
- **WHEN** valid PDF selections exceed 1,000 characters, 20 page segments, or 1,000 quads
- **THEN** the frontend and REST/sync mark writes accept them without these PDF-specific limits; identity, coordinate validity, existing HTML limits, and comment-body validation still apply

#### Scenario: Highlight and reopen
- **WHEN** the owner highlights PDF text and later reopens the bookmark
- **THEN** the same passage is highlighted and its selected text remains associated with the mark

#### Scenario: Change scale and viewport width
- **WHEN** a PDF containing highlights is zoomed or resized
- **THEN** the highlights follow the corresponding text on each page without using stale screen coordinates

#### Scenario: Underline stays beneath its selected text
- **WHEN** saved PDF highlights or comments are displayed at desktop or H5 scale
- **THEN** their underlines follow the transformed selection's bottom edge without an extra fixed downward offset into the following line

#### Scenario: Select across pages
- **WHEN** the owner selects text across two rendered pages and creates a highlight or comment
- **THEN** both page segments are saved as one logical mark and restore on their respective pages

#### Scenario: Page is rendered again
- **WHEN** a highlighted page leaves the render window and is later displayed again
- **THEN** its highlights are restored exactly once

#### Scenario: PDF has no selectable text
- **WHEN** a scanned page has no text layer
- **THEN** the page can be previewed and the reader does not offer a text highlight for a nonexistent selection

### Requirement: PDF comments reuse the bookmark notes experience

PDF selections SHALL support comments, replies, highlight deletion, and comment deletion through the existing notes experience and ownership rules. Clicking a highlighted or commented passage SHALL focus its comment thread; selecting a thread SHALL reveal its PDF page and passage, including when that page has not yet rendered. Deleting a highlight MUST preserve existing comments. REST and local synchronization SHALL retain the PDF source geometry and quote without conversion to an HTML path.

#### Scenario: Copy selected PDF text
- **WHEN** a reader selects PDF text and uses Copy in the existing article selection menu
- **THEN** the selected quote is copied without requiring permission to create highlights or comments

#### Scenario: Match article highlight and comment presentation
- **WHEN** a PDF displays saved highlights or comments
- **THEN** highlights use the article's restrained dashed underline, comments use its solid underline and comment indicator, and hover or passage focus applies its existing semantic highlight colors

#### Scenario: Comment on a PDF selection
- **WHEN** the owner selects PDF text and submits a comment
- **THEN** the comment appears in the existing notes panel and remains linked to the passage after reload

#### Scenario: Navigate between a passage and its comments
- **WHEN** a viewer clicks a PDF mark or selects its note in the panel
- **THEN** the corresponding thread or PDF passage is revealed and focused

#### Scenario: Delete a highlight with comments
- **WHEN** the owner removes the highlight from a mark that has comments
- **THEN** its comment thread remains available and deleting a permitted comment follows the existing deletion behavior

#### Scenario: Synchronize a PDF comment
- **WHEN** a PDF comment is written through the local synchronization path and then loaded through the server path
- **THEN** the page segments, selected text, and thread relationship are preserved

#### Scenario: Reject malformed PDF mark data
- **WHEN** a REST or synchronization write contains invalid page identifiers, non-finite coordinates, or an unsupported PDF source version
- **THEN** it is rejected without changing existing valid article mark behavior

### Requirement: PDF support preserves existing article behavior

Existing article and shortcut rendering, selection, comments, and list navigation SHALL continue to behave as before. PDF pages SHALL not expose HTML refresh actions. Outline, summary, and chat SHALL consume extracted PDF text through the existing AI policies and explicitly report when no analyzable text is available. Reader controls and notes SHALL follow the existing light, dark, and e-ink themes while matching PDF paper and ink to the current theme by default. An original-colors switch SHALL remain available for color-dependent figures.

#### Scenario: Open an existing article
- **WHEN** a user opens an HTML article with existing highlights and comments
- **THEN** the article renderer and its existing mark actions remain available

#### Scenario: Open a PDF with the normal reader toolbar
- **WHEN** a viewer opens a PDF bookmark
- **THEN** supported bookmark and note actions remain available and unavailable article-processing actions are not offered

#### Scenario: Change the reader theme
- **WHEN** the viewer changes between light, dark, and e-ink themes
- **THEN** PDF reader controls, selection actions, and comments follow the theme and PDF paper/ink follow that theme unless the viewer explicitly selects original document colors

### Requirement: Desktop and H5 presentation are complete

PDF upload, preview, selection actions, and notes SHALL follow the existing reader visual style and support desktop and H5 layouts. At the 768px mobile transition, controls SHALL remain usable down to 320px viewport width, with touch targets of at least 44px and safe-area spacing. Zoomed content SHALL scroll within the document viewer without causing whole-page horizontal overflow. Mobile selection actions MUST work without hover and preserve the selected passage while notes open. The mobile comment composer SHALL remain reachable when the software keyboard is shown.

#### Scenario: Desktop notes panel changes document width
- **WHEN** the desktop notes panel opens or is resized
- **THEN** PDF pages and controls adapt to the remaining space while retaining the current passage and mark alignment

#### Scenario: H5 toolbar and selection menu
- **WHEN** the viewer selects PDF text at a viewport between 320px and 768px
- **THEN** the toolbar and selection actions remain legible, reachable by touch, within the viewport and safe area, and the selected passage remains available for highlighting or commenting

#### Scenario: Selection actions follow the passage
- **WHEN** the owner selects PDF text with a mouse, touch, or keyboard
- **THEN** highlight/comment actions appear beside the mouse release or selection endpoint, stay within the visual viewport, follow the selected passage when scrolling, and hide while the passage is outside the viewport

#### Scenario: H5 notes and keyboard
- **WHEN** the owner opens a selection's notes and focuses the composer on H5
- **THEN** the notes sheet and composer remain usable above the keyboard, and dismissing notes returns to the same PDF passage

#### Scenario: Rendered visual verification
- **WHEN** the feature is verified before delivery
- **THEN** upload, reader, selection, notes, loading, and error states are visually inspected at desktop, the 768px transition, and narrow H5 sizes in the required themes, with browser and actual-device coverage reported separately

#### Scenario: Inspect original document colors
- **WHEN** the viewer selects original colors in the PDF side controls
- **THEN** the PDF uses its original rendering colors without changing the stored bytes, scale, passage, or highlight coordinates

### Requirement: PDF AI uses extracted document text

The backend SHALL extract selectable PDF text with page boundaries and supply it to the existing outline, summary, and chat services. PDF bytes MUST NOT be treated as HTML or directly substituted for text. Existing authentication, subscription, ownership, and AI policy checks SHALL continue to apply. Documents with no extractable text SHALL remain previewable and SHALL explicitly report that no analyzable text is available; this change SHALL NOT perform OCR. Selecting a quote from PDF AI output SHALL navigate to the matching PDF passage when a match exists.

#### Scenario: Analyze a text PDF
- **WHEN** an authorized user requests outline, summary, or chat for a PDF with extracted text
- **THEN** the existing AI service receives the stored page-labelled text and returns its usual output

#### Scenario: Analyze a scanned PDF
- **WHEN** an authorized user requests a text-based AI feature for a PDF with no extracted text
- **THEN** the system clearly reports that no analyzable text is available, does not call the model with an empty or binary body, and continues to allow PDF preview

#### Scenario: Follow an AI quote
- **WHEN** the viewer selects an AI quote that matches PDF text
- **THEN** the matching page and passage are revealed without changing persisted highlights and comments
