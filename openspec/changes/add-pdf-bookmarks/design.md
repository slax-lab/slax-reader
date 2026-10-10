# Design

## Context

See `proposal.md` for motivation and `specs/pdf-bookmarks/spec.md` for behavior. The following observations determine the implementation boundary:

- `sr_user_bookmark.type` is already an integer (`0` article, `1` shortcut). `sr_bookmark` has `content_key` and `content_md_key`; comment `source` and `approx_source` are JSON serialized into string columns. A PDF does not require new tables or columns.
- URL saves from REST and PowerSync reach `CrawlWorkflow`; ordinary capture currently goes through `fetchRegular()` and HTML parsing, then article AI post-processing. `ImportParseWorkflow` also has a separate capture branch.
- Article objects use `html/body/<user-bookmark-uuid>.html`. `/api/content/<uuid>` loads this object optimistically and falls back to `metadata.content_key`, always calling `.text()`. That fallback would decode a PDF incorrectly.
- `ContentOrchestrator` and `BookmarkService.getBookmarkReadAccess()` already resolve owner/public-sharing access. The bookmark `/content` endpoint currently hardcodes HTML response headers.
- `/b/<uuid>` uses `BookmarkArticleLocalFirst`, REST/public marks, and the local mark stream. `/s/<code>` also renders `BookmarkArticle`. Both use the existing snapshot comments UI.
- `MarkManager` owns comment grouping, persistence, replies, optimistic state, and deletion, but currently requires a concrete DOM `MarkRenderer`. `useCommentPanel` searches for `slax-mark` DOM wrappers. These are the specific seams to adapt for PDF geometry.
- Both REST and database sync paths validate selected-text lengths using HTML text offsets. PDF quote-length validation must cover both paths rather than bypassing the existing limit.

The root `DESIGN.md` requires Web semantic tokens, accessible controls, light/dark/e-ink coverage, and localized renderer exceptions. No Extension presentation or external KMP source is part of this change.

## Goals / Non-Goals

**Goals:**

- Keep file persistence, bookmark ownership, notes, and synchronization in the current services.
- Add one client PDF renderer and one coordinate renderer, with a small shared selection/renderer interface instead of a second comments stack.
- Keep PDF bytes out of JSON responses and SSR HTML, and avoid loading PDF.js for ordinary articles.

**Non-Goals:**

- Reflowing a PDF into HTML, OCR, editing embedded PDF annotations, and a native PDF SDK.
- An offline file-upload queue, resumable/multipart-to-R2 uploads, or automatic replacement of a saved PDF when its remote URL changes.
- Changing existing article anchoring algorithms or redesigning the reader.

## Decisions

### Labs opt-in, metadata titles, and page spacing

Use the existing per-user Labs registry with an active `pdf` entry, disabled by default. New URLs are accepted without guessing PDF type from their path or suffix. The capture checks PDF opt-in after response media-type or file-signature detection. Cached PDF objects are also gated before a new bookmark relationship is created. PowerSync mutation acceptance and workflow dispatch do not consult Labs. A feature switch or Labs service failure must not roll back an unrelated pending sync batch. Cached PDFs retain their PDF relation type when re-saved. New acquisition remains gated in the capture workflow, independently of the sync response. Response media-type detection or a bounded file-signature probe enforces opt-in before downloading the complete file or persisting a newly discovered PDF, covering extensionless and redirected links. A workflow-side Labs rejection is terminal, marks the pending save failed, and does not generate a fault alert. Uploads require opt-in before reading bytes or writing rows. Already stored PDFs remain readable and their accepted background extraction can finish after the switch is disabled.

Read XMP `dc:title` and document-info `Title` using the same PDF document opened for extraction. Prefer nonempty XMP title, then info title, normalizing controls/whitespace and bounding title length. Fall back to the filename without failing text extraction if metadata cannot be read. Uploaded files initially show their filename; background extraction replaces the base title with the embedded title when available. User alias titles remain untouched. Prefer XMP `dc:creator` (including author lists), then document-info `Author`; normalize whitespace/control characters and store the result in the existing `byline`. Missing authors stay empty; document creation software is not an author fallback. Extract author metadata even when the document has no selectable text. The client can read the already-loaded PDF metadata to supplement missing author display on older bookmarks without another file download or database mutation. After client detail loading, URL PDFs use the existing source badge linking to the original URL; uploaded PDFs show a theme-compatible local-upload label, filename, and available author. HTML article source presentation and title/type-only PDF SSR remain unchanged.

PDF page slots have no gap by default. A local reader toggle restores the existing 20px gap, uses semantic selected/focus states, and leaves page dimensions, mark coordinates, and HTML article presentation unchanged. OCR is outside this implementation.

Non-PDF Labs gates remain acquisition concerns too. The crawl fetch step checks the original URL before cache reuse and checks a changed short-link destination before provider fetching, using the existing `LabService` route registry. A disabled YouTube feature terminates only that acquisition, marks it failed, and emits no fault alert. Labs service failures remain retriable for gated acquisitions; ungated articles do not read Labs state. Sync acceptance and dispatch still do not consult Labs. PDF opt-in continues to depend on response detection rather than URL patterns.

### 1. Reuse existing storage with an explicit additive PDF type

Reserve user-bookmark type `2` for PDF. Add a common type mapper for REST detail/list/export mappings and local bookmark/collection mappings; stop silently treating every value other than `1` as an article. Use `pdf/body/<user-bookmark-uuid>.pdf` as the original-object key and `application/pdf` R2 HTTP metadata. Store extracted page-labelled text in `text/pdf/<user-bookmark-uuid>.txt` through `content_md_key`, preserving the existing AI input contract.

Store filename, source kind (`url` or `upload`), and SHA-256 in R2 custom metadata; read byte size from the object head. Store extraction status and page count in `pdf/meta/<saved-uuid>.json`. Persist original bytes before parsing because PDF.js consumes the input buffer; updating the small state object avoids copying or replacing the immutable PDF. A typed PDF descriptor contains filename, size, immutable document identity, and an access-controlled file endpoint. The reserved object-key prefix is an authoritative server-controlled format marker when a shared/snapshot response does not carry the relation type. PDF type must be present in both owner and visitor metadata.

Uploaded bookmarks use a server-generated `slax-pdf://<user-id>/<sha256>` identity in the existing required URL field. This identity is used only by the direct upload creation path, never by HTTP URL capture, and is not presented as an external source link. Capture/reparse actions recognize stored PDFs and do not send this identity into crawlers. Re-uploading the same bytes for the same user reuses the saved bookmark and its notes; saving an existing PDF URL preserves its immutable original instead of silently replacing the bytes beneath highlights and comments.

**Alternative:** add a document table and file foreign key. That introduces migrations, new synchronization rules, and extra ownership plumbing without improving the first release. A synthetic article containing an iframe was also rejected because it obscures the PDF type and leaves the HTML highlight path active.

### 2. Branch before HTML capture and keep file bytes inside one workflow step

For regular URL capture, perform a bounded public HTTP probe before either inline HTML handling or the existing crawler. Reuse `publicFetch` and `publicTarget` for streaming limits, timeout, redirect validation, and public-target checks. Prefer the final response Content-Type: trim and normalize its media type before parameters and match `application/pdf` exactly. Otherwise read at most the first 1024 bytes for the PDF file signature, including signatures split across short chunks. URL suffixes, hosts, and paths never classify a new response. Cancel the probe body and continue ordinary capture when neither signal identifies PDF, or when the probe fails before identifying PDF.

For an identified PDF, require Labs opt-in before the full download. Fetch under the same 50 MiB streaming byte limit as uploads, validate the downloaded PDF signature, hash, and store it in R2. Cancel probe resources before Labs rejection. Persist the key, successful status, and relation type only after storage succeeds. The workflow result is a small `pdf` discriminant and identifiers, never a document buffer or base64 payload. An unsuccessful response declaring PDF or an identified PDF download that fails integrity/size validation fails explicitly.

The PDF branch bypasses HTML parser quality checks, article soft-404 detection, image rewriting, screenshots, and HTML-specific post-processing. Extract selectable text with the Worker-compatible `unpdf` distribution, persist page-labelled text and an extraction status, and reuse existing AI services for outline, summary, and chat. Extraction failure does not destroy the readable original PDF; empty or failed extraction is explicit and blocks text-based AI requests with a localized error. Keep current status notifications and applicable import/callback completion behavior. The existing moderation client must use Workers-compatible manual redirect handling and reject 3xx responses without forwarding credentials, so PDF post-processing can run under the real Worker runtime. Use the same capture helper in `ImportParseWorkflow` so importing a PDF URL does not regress into the HTML parser.

**Alternative:** URL heuristics can reject ordinary pages before their response is known and are excluded. File-signature fallback remains necessary for servers using generic or missing media types. The bounded probe preserves the existing crawler fallback.

### 3. Upload through a bounded authenticated endpoint

Add `POST /v1/bookmark/upload_pdf` beside existing bookmark endpoints, using a raw PDF request body and an encoded filename query parameter. Bound the actual streamed file bytes to 50 MiB before persistence. Avoid multipart parsing and its additional full-file copies at this larger limit. Browser checks improve feedback; server checks remain authoritative. Use the existing create-bookmark relation and search/cache invalidation routines, with a filename-derived title and current-user privacy.

Do not enqueue HTML capture for an uploaded PDF. Clean up newly written objects if database persistence fails, and mark any partially created bookmark as failed or remove its newly created relation. A failed retry must not delete a previously saved identical file. Create the original with an R2 conditional write (`If-None-Match: *`); a competing initial save returns a retryable failure without overwriting or cleaning up the winner's objects or changing its database status. Return existing-style bookmark identifiers, the user-bookmark UUID, and status for navigation/list refresh. Upload remains online-only even when local bookmark synchronization is enabled; the resulting server row arrives through the existing stream.

Add an upload action inside `AddUrlTopModal.vue`; preserve the URL action and modal styling. Show selected filename, size limit, in-progress state, and retryable failures using existing translated UI patterns. No new top-level library screen is needed.

### 4. Authorize binary delivery independently of metadata and preserve ranges

Add an owner-capable API file endpoint and a same-origin Nitro file route at `/api/content/<uuid>/pdf`. Resolve bookmark read access on every file request, including range requests. The web route forwards the existing cookie token to the current content metadata service, obtains the permitted object key, and only then reads R2. It accepts a bookmark UUID, never an arbitrary object key or remote URL.

Return `application/pdf`, inline content disposition with a sanitized filename, `nosniff`, and `private, no-store`. Support full GET/HEAD and one valid byte range, including suffix ranges, correct `206`/`Content-Range`/`Content-Length`, and `416` for unsatisfiable ranges. Keep the API and Nitro implementations on a shared tested range/header helper where practical. Stream object bodies instead of loading a file for every read.

Update `loadContent()` to return PDF metadata with `body: null` and skip its binary-key `.text()` fallback. Keep the existing HTML response shape and fast path. Likewise, legacy bookmark/share detail paths must return a descriptor rather than attempting to read PDF bytes as article text.

**Alternative:** public R2 URLs or long-lived signed URLs. They complicate revocation and default privacy. A full-file Blob through the JSON content endpoint would duplicate memory and prevent progressive byte-range loading.

### 5. Use upstream PDF.js viewer components and keep loading client-only

Add a pinned, WebView-compatible `pdfjs-dist` release. Use upstream `PDFPageView` components/event bus, worker, text layers, and render cancellation. These supported page components render in normal document flow without the absolute, nested scroll container required by `PDFViewer`. A small viewport observer/scheduler renders pages sequentially and retains at most six nearby page canvases, releasing distant views. Start with the legacy build where needed for older WebView APIs; ensure worker and API versions match. Bundle worker, CMaps, standard fonts, and required WASM assets from the dependency, rather than fetching executable viewer assets from a CDN.

Mount a client-only PDF component inside the existing article shell when its detail type is PDF. PDF SSR data contains only the title and `pdf` type discriminator; metadata, notes, and file bytes load through the existing authorized endpoints after mounting. The server still resolves read access before exposing the title and preserves its request-local owner context. Retain title, tags, source handling, footer, and snapshot notes after client loading. Remount only the PDF shell when the descriptor arrives so selection adapters receive the resolved bookmark/share identifiers. HTML SSR and sizing remain unchanged. PDF shells retain the existing article content width and desktop/H5 padding, fitting pages to that width by default. The shell exposes the active reader-selection interface, whether HTML or PDF, so the local-first wrapper and preview pages retain their ownership/adapters.

Provide fit-to-width, page navigation, and bounded zoom controls in a collapsible side rail. Use page-render/text-layer/scale events to attach and restore overlay geometry. Limit canvas pixel area/device-density amplification, preserve native render cancellation, and destroy the document/loading task, observers, and event handlers on unmount. Pages participate in the detail page's vertical scrolling, without an enclosing border, fixed-height viewport, or second vertical scrollbar. Each enlarged page can pan horizontally within its own page slot. Preserve the current passage across fit/resize and navigate comments through the outer document scroll. Avoid applying HTML reading-position anchors to PDF pages.

Scope upstream viewer CSS beneath the PDF component. Web shell/controls/notes use current tokens. PDF ink follows the page text token through upstream page-color rendering. A transparent alpha canvas allows the existing host paper and gradient to show through without changing the HTML shell or global background; redraw when the reader theme changes. Since upstream high-contrast mapping affects colored figures, the side rail offers an original-colors switch for inspecting color-dependent charts; this affects rendering only, never the stored PDF or mark coordinates. Disable document scripting and unnecessary forms/editing tools. Allow existing AI/chat/outline controls when PDF text extraction is ready; show the no-text state for scans. Disable HTML reparse controls for PDF bookmarks.

**Alternatives:** a whole generic viewer iframe adds a second toolbar and an iframe messaging/selection bridge. Rendering every page with hand-managed canvases discards the existing queue and cache. Zotero/Hypothesis readers would add a larger product and editing layer; the upstream components plus current Slax services meet this scope. Upstream references: [component example](https://github.com/mozilla/pdf.js/blob/master/examples/components/simpleviewer.mjs), [viewer source](https://github.com/mozilla/pdf.js/blob/master/web/pdf_viewer.js), and [Apache-2.0 license](https://github.com/mozilla/pdf.js/blob/master/LICENSE).

### 6. Desktop and H5 presentation are acceptance criteria

Keep the existing paper surfaces, semantic typography, border/radius tokens, and restrained accent across the upload entry, controls, loading/error states, and notes. PDF paper follows the page theme, with an original-colors switch available for color-dependent figures. Render pages directly beneath the article heading. Desktop uses a compact collapsible control rail beside the content, clear of the existing notes panel; opening notes must resize the reader without losing its page or overlay alignment.

At the existing 768px transition, use a collapsible side control rail with 44px interactive targets and no viewport overflow at 320px. Keep page/zoom controls accessible; collapse the expanded controls to reclaim reading space. Pages fit the available width initially; enlarged pages pan within their page slots without making the whole screen wider. Selection actions follow the mouse release position on desktop and the selection endpoint on touch/keyboard. Clamp the menu to the visual viewport, reposition it on scroll/resize, and hide it when the selected passage leaves the viewport. Preserve the native selected range when tapped and never depend on hover. Comments reuse the existing mobile bottom sheet, with the composer visible above the keyboard and bottom safe area. Preserve the selected passage while opening/dismissing notes and returning to the document.

Keep the current/total page indicator visible on the collapsed and expanded control rail. Group previous page, the editable page number and muted total, and next page together; use aligned chevron icons, tabular numerals, semantic surfaces/borders, and consistent hover, pressed, disabled, and focus states. Hide browser number-input spinners without removing numeric keyboard or keyboard stepping support.

Verify actual rendered UI at 1440px, 768px, 390px, and 320px, portrait and landscape, in light/dark/e-ink. Capture visual evidence for upload, reader, selection actions, notes, loading, and errors; inspect overlap, clipping, text expansion, focus, and theme contrast. Browser emulation must be distinguished from testing the separate KMP app on a real device.

### 7. Persist PDF coordinates and reuse mark lifecycle through a small renderer interface

Add a discriminated `pdf` source item alongside the existing text/image source shapes. Version 1 records a 1-based page number, unscaled PDF-space quadrilaterals, the selected page text, and the stored document identity. A cross-page selection produces multiple source items under one existing mark/thread. Preserve `approx_source.exact` and `select_content` for current note previews and copy behavior.

Derive page segments from the actual selected text nodes and their client rectangles, restricted to the current PDF text layer. Clip to each page, discard empty/duplicate rectangles, and convert each corner through that page's inverse viewport transform. Do not persist browser pixels or canvas device pixels. Restore via the current viewport transform; rotated page boxes and nonzero PDF origins are handled by the same conversion.

Draw dedicated page overlays without wrapping or mutating PDF.js text-layer spans. Index marks by page and update only affected overlay pages. Page teardown removes ephemeral overlays, while mark data stays loaded for the notes panel. On page remount, redraw from saved sources exactly once. A note navigation command first navigates/renders the target page and then focuses its overlay.

Place PDF underlines on the transformed selection's bottom edge. Do not reuse the HTML underline's fixed pixel offset: PDF line spacing and glyph sizes scale with the page, and an extra downward offset can put the mark across the following line. Existing saved quadrilaterals remain unchanged.

Replace `MarkManager`'s concrete renderer dependency with the smallest structural interface covering its existing draw/clear/click/text-lookup calls. Keep the existing DOM renderer as the article implementation. A PDF renderer uses the saved coordinates and exact quote; PDF quotes must not fall back to searching the entire HTML document. A PDF selection controller delegates grouping, create/reply/delete, optimistic rollback, and HTTP persistence to the existing manager and its REST/local-first adapters.

Change snapshot UI typing from concrete `DwebArticleSelection` to a narrow shared reader-selection contract (`markItemInfos`, create/comment, delete stroke/comment, reveal mark, and quote lookup as actually consumed). `useCommentPanel` delegates passage reveal/flash to the active reader; the HTML implementation keeps its current `slax-mark` behavior. Reuse the current comment composer/list and the unmodified article selection menu custom element, including copy for read-only visitors and quote-to-chat when extracted text is ready. Add responsive and focus overrides only to the PDF custom-element host. Delay menu mounting until the selecting click has completed, retain the native range while acting, and position the menu beside the selection. PDF overlays match article dashed highlights, solid comment underlines, a trailing comment indicator, and semantic hover/quote colors.

Extend all relevant contract/browser source unions without changing the historical HTML path shapes. Centralize PDF source validation for REST and sync database writes: supported version, matching stored PDF/document identity, positive page indices, finite coordinate values, and valid source shape. PDF character, page-segment, and quad-count limits are removed; HTML quote limits and comment-body limits retain their existing behavior. Replies retain the current permission/thread policy. Existing HTML renderers ignore PDF sources instead of feeding them into HTML fallback matching.

**Alternative:** save a CSS path into PDF.js text-layer spans. Those nodes are replaced as pages render, and wrapping them can disturb text selection. PDF.js's built-in annotation editor would add a separate save/export/comment model; using current mark records avoids a parallel source of truth.

## Risks / Trade-offs

- [Image-only, corrupt, or password-protected documents] → Allow scanned-page preview, create marks only from real text selections, and show explicit unsupported/error states. Signature checks are format screening; final document parsing occurs in the reader.
- [Mobile WebView selection handles and nested scrolling vary] → Verify narrow touch layouts, selection-menu focus retention, zoom, and comment navigation in browser smoke tests. Actual KMP device verification requires the separate app/device environment and must be reported separately from browser coverage.
- [Type/source unions affect shared article code] → Keep changes additive, guard PDF branches, and run existing article selection/comment regressions and Extension type/build checks for the shared package seam.
- [Canvas memory on long or image-heavy documents] → Use upstream page views and cancellation with sequential viewport scheduling, retain at most six nearby canvases, cap canvas pixel area, and verify the bound during long-document scrolling and page jumps.
- [Additional URL probe] → Bound prefix reads and the request deadline, cancel promptly, and preserve ordinary article fallback. PDF responses use the same stored immutable bytes for future reads.
- [Scans have no extracted text] → Report the empty-text state clearly in preview and AI endpoints; do not imply OCR has occurred. Preserve existing AI access, subscription, and moderation gates for available extracted text.
- [Object/database writes are not a distributed transaction] → Use deterministic per-user identity, preserve preexisting objects on retries, and test cleanup/failure states for newly created uploads.

## Migration Plan

1. Additive code/contracts only; reserve relation type `2` and the PDF object prefix without changing existing rows or deploying a database migration.
2. Deploy API capture/upload/delivery support before exposing the web upload/renderer UI. Regenerate API DI/routes with `pnpm api -- gen:all`; never hand-edit generated files.
3. Validate existing HTML and new PDF flows locally before any explicitly authorized deployment. Preserve dependency license notices.
4. Rollback the web UI first to stop new uploads, then the API. Preserve PDF rows and objects. Older web versions cannot preview type `2`; use the PDF-aware web release to read saved PDFs rather than converting them to article rows.
