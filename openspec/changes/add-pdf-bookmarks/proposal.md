# Proposal

## Why

Slax Reader currently saves and renders HTML articles, so PDF links cannot become readable bookmarks with text highlights and comments, and local PDF files have no upload entry. Supporting PDFs in the existing web reader also provides a shared rendering path for the KMP application's WebView.

## What Changes

- Identify publicly accessible PDF responses using the final Content-Type media type with a bounded PDF file-signature fallback; do not infer PDF from URL patterns. Retain and validate the original file in the existing R2 bucket.
- Add a single-file PDF upload option to the existing add-bookmark dialog, with a 50 MiB limit and clear upload errors.
- Register PDF bookmarks as an active, disabled-by-default Labs feature. Show the upload entry only after opt-in and enforce opt-in on backend PDF acquisition, including response-detected extensionless links, while preserving access to existing saved documents. Sync mutation acceptance and workflow dispatch do not check Labs, so a pending PDF save cannot block unrelated changes.
- Prefer an embedded XMP/document-info title during PDF text extraction, falling back to the filename. Extract XMP creator/document-info authors into the existing byline and display available authors plus the original URL or local-upload source in the PDF header. Existing PDFs may supplement missing author display from client-side metadata without changing persisted marks.
- Introduce a `pdf` bookmark type using the existing numeric user-bookmark type column and JSON mark storage, without adding a new database table or a separate comments service.
- Treat desktop and H5 styling as part of delivery: reuse the current reader visual system, responsive controls, touch selection, mobile notes sheet, safe-area spacing, and light/dark/e-ink states.
- Render PDF pages directly in the existing preview content using upstream PDF.js, with continuous page scrolling, a collapsible side control rail for page navigation/fit/zoom, and bounded page rendering. Match paper/ink to the reader theme by default and offer original document colors for figures. Place highlight/comment actions beside the pointer or selection and keep them inside the visible viewport.
- Remove the inter-page gap by default and expose an optional page-gap toggle in the PDF control rail.
- Remove PDF-specific character, page-segment, and quad-count selection limits while retaining document identity and valid-coordinate checks; retain existing HTML and comment-body limits.
- Support text highlights, comments, replies, deletion, and bidirectional navigation between a PDF passage and the existing notes panel. Persist page coordinates so highlights survive reopening, zoom, and responsive layout changes.
- Keep PDF pages within the existing article content width and spacing, without changing HTML article sizing. Keep PDF SSR output to the title and a type discriminator, then load document metadata, notes, and binary content through authorized client requests. Reuse the article selection menu, including copy, and match its dashed highlights, solid comment lines, and comment indicator.
- Preserve current owner/share access rules and both REST and PowerSync comment paths. Files remain private until the user uses the existing sharing controls.
- Include capture, upload, preview, highlights, comments, and text-based AI in this release. Scanned PDFs can be viewed; OCR, native mobile integration, and embedding highlights and comments into downloadable PDFs are outside this change. Extract selectable text on the backend for the existing outline, summary, and chat paths; scanned documents explicitly report that no analyzable text is available.

## Capabilities

### New Capabilities

- `pdf-bookmarks`: PDF URL capture, local upload, access-controlled preview, and persistent text highlights and comments in the existing reader.

### Modified Capabilities

None. The existing article outline-navigation requirements remain unchanged; PDF page and mark navigation are defined by the new capability.

## Impact

- `apps/api`: bookmark upload and file delivery endpoints; a PDF branch in capture workflows; bookmark type/detail mapping; shared validation for PDF mark payloads on REST and PowerSync writes.
- `apps/web`: add-bookmark dialog, PDF-specific reader component, snapshot content loading and binary file delivery, local bookmark type mapping, and a small reader-selection interface for reusing the notes panel.
- `packages/contracts`, `packages/frontend-types`, and `packages/selection`: additive PDF descriptor and mark-source types, plus the minimum renderer seam needed to reuse existing mark lifecycle logic.
- Dependency: `pdfjs-dist`, including its worker, fonts/CMaps, WASM assets, and scoped viewer styles. Use the Apache-2.0 upstream distribution and retain required notices; the project's root license is unchanged.
- Storage: original PDF objects in the existing private R2 bucket. The initial implementation uses existing columns and JSON fields; no schema migration or new infrastructure is planned.
- Compatibility: existing HTML article behavior and mark payloads remain supported. Binary PDFs must never be decoded as HTML or embedded into SSR page data. Extension UI and the external KMP repository are outside the implementation scope.
