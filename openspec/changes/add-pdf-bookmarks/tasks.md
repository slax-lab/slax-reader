# Tasks

## 1. Additive document and mark contracts

- [x] 1.1 Add a shared `pdf` bookmark type mapper, PDF descriptor, and versioned page-geometry source alongside existing shapes in contracts and frontend types; verify contract typecheck and existing article payload fixtures remain valid.
- [x] 1.2 Map numeric type `2` through API list/detail/export, snapshot/share/collection responses, and local bookmark/collection mappings; verify owner and visitor PDF responses and list fixtures identify PDFs while article/shortcut fixtures retain their existing values.

## 2. PDF persistence, capture, and upload

- [x] 2.1 Implement a shared bounded PDF ingestion helper using the existing R2 bucket, PDF signature checks, SHA-256 identity, object metadata, and successful-status/type updates; verify empty/invalid/over-limit streams, stored headers, deduplication, and storage/database failure cleanup with focused tests.
- [x] 2.2 Add a PDF probe/capture branch before ordinary and inline HTML handling in `CrawlWorkflow` and the import capture path; verify header-declared PDFs regardless of URL, redirects, non-PDF fallback, failed PDF status, immutable resaves, local-first URL completion, and exclusion from article-only post-processing.
- [x] 2.3 Add the authenticated single-file upload endpoint using existing bookmark ownership/creation routines and bounded raw PDF body reading; verify anonymous rejection, 50 MiB boundary handling, filename title, private ownership, duplicate upload preservation, retry behavior, and that uploaded bookmarks do not launch an HTML workflow.
- [x] 2.4 Regenerate API routes/dependencies with `pnpm api -- gen:all`; verify generated output matches the new endpoint/service graph and `pnpm api -- typecheck` passes without hand-edited generated files.

- [x] 2.5 Extract page-labelled PDF text on the backend, persist it through `content_md_key` with an explicit status, and feed existing outline/summary/chat paths without bypassing ownership or subscription checks; verify real text PDF extraction, empty scanned text, extraction failures preserving preview, no empty model calls, and AI quote navigation.

## 3. File delivery and preview metadata

- [x] 3.1 Add binary GET/HEAD delivery to the API and same-origin Nitro PDF route using existing read-access resolution and shared single-range/header handling; verify full/range/suffix/unsatisfiable responses, PDF headers, no public caching, owner access, hidden highlights and comments, invalid tokens, unrelated users, and revoked sharing.
- [x] 3.2 Update `loadContent`, legacy detail loading, and snapshot metadata so PDF responses contain the descriptor and no binary text body; verify PDF R2 objects are never read with `.text()` or passed to SSR HTML processors, and existing HTML fast-path/fallback tests still pass.

## 4. Client reader and upload entry

- [x] 4.1 Add and pin `pdfjs-dist`, wire matching client-only worker/viewer imports and local font/CMap/WASM assets, and retain dependency notices; verify the web production build resolves the assets and ordinary article loading does not eagerly initialize PDF.js.
- [x] 4.2 Add the PDF reader inside the existing article/snapshot shell with page navigation, fit-to-width, bounded zoom/canvas rendering, cleanup, and localized loading/corrupt/password states; verify a text PDF, scanned PDF, mixed page sizes/rotation, narrow layout, and a long-document smoke test.
- [x] 4.3 Extend the existing add-bookmark dialog with the PDF file action and online upload flow; verify filename/size feedback, in-progress state, validation errors, retry, list refresh/opening after success, and the existing URL/local-first action.
- [ ] 4.4 Gate HTML reparse/source-link and HTML reading-position behavior for PDF/uploaded bookmarks, and make PDF AI controls depend on the explicit extraction state; verify supported bookmark/notes actions remain present and light/dark/e-ink controls, keyboard focus, accessible labels, safe-area layout, and mobile selection controls follow `DESIGN.md`; inspect rendered desktop and 768px/390px/320px H5 views, 44px targets, internal zoom scrolling, notes-sheet/keyboard behavior, and retain visual evidence for the changed states.

## 5. PDF highlights and existing comments

- [x] 5.1 Extract the minimum renderer and reader-selection interfaces from the current concrete DOM dependencies, keeping the HTML implementation as the existing default; verify article highlight/comment integration tests and shared selection/Extension type checks pass.
- [x] 5.2 Implement text-layer selection capture, page splitting, inverse viewport coordinate conversion, and page-local overlays; verify multiline and cross-page selections plus zoom, viewport resize, display-density changes, rotated/nonzero-origin pages, and page remount restoration without duplicate overlays or text-layer mutation.
- [x] 5.3 Connect the PDF selection controller to the existing mark manager, selection menu, REST/local-first adapters, composer, and comment list; verify create highlight/comment, reply, deletion preserving comments, save-failure rollback, restored quote text, and passage/thread navigation to an initially unrendered page.
- [x] 5.4 Validate PDF sources on both REST mark creation and sync database writes, including stored document identity, source version, finite coordinates, bounded geometry, and existing quote/comment limits; verify malformed PDF writes are rejected and valid PDF sources round-trip through PowerSync and REST without losing coordinates or thread IDs.

## 6. Integration and review

- [x] 6.1 Run focused API/web tests for capture/upload/access/content/mark flows, relevant existing article/comment regressions, contract and affected package typechecks, web build, and the Extension check needed for shared selection changes; record command results and resolve failures attributable to this change.
- [ ] 6.2 Smoke-test PDF URL save and upload through the normal bookmark list/preview, create a highlight/comment, reopen, zoom/resize, navigate notes, and verify sharing privacy; record desktop and narrow touch-browser coverage, rendering-buffer behavior, and separately identify any actual KMP device coverage unavailable in this repository.
- [x] 6.3 Run `pnpm exec openspec validate --all --strict` and the local pre-push review in `REVIEW.md`, resolve Important findings, and verify the eventual PR body contains `OpenSpec: add-pdf-bookmarks` before pushing a behavior-changing diff.

## 7. Inline pages and selection placement

- [x] 7.1 Replace the framed PDF viewport with upstream page components in normal detail content flow; preserve fit/zoom, page navigation, mark restoration, render cancellation, bounded nearby canvases, and horizontal panning without whole-page overflow.
- [x] 7.2 Move page/zoom controls to a collapsible side rail that adapts to notes, narrow screens, safe areas, and themes; match PDF paper/ink to the theme with an original-colors switch; anchor selection actions beside the mouse/selection and reposition or hide them on viewport changes.
- [ ] 7.3 Verify page navigation, scrolling, width changes, canvas eviction/remount, and selection menu placement with focused tests and rendered desktop/H5 inspection; run strict OpenSpec validation and review the changed UI against DESIGN.md.
- [ ] 7.4 Refine the page control styling with an always-visible current/total indicator, grouped chevron navigation, aligned numeric input, semantic interactive states, and 44px H5 targets; verify rendered desktop and narrow layouts.
- [ ] 7.5 Preserve the existing PDF content width and spacing, keep PDF SSR payload and content to its title/type, and load metadata, notes, and bytes on the client; verify HTML SSR remains unchanged and access failures have a retry path.
- [ ] 7.6 Reuse the existing article selection menu with copy available to readers, match highlight/comment strokes and indicators, and verify selection retention, copy, and narrow-screen placement without changing HTML presentation.
- [x] 7.7 Remove the fixed downward PDF underline offset; verify existing marks stay beneath their selected text after zoom and desktop/H5 width changes without altering saved geometry or article styling.

Task 6.2 remains open for a complete authenticated upload/sharing browser exercise and actual touch-keyboard verification. Component/API tests and the mocked normal preview route cover the upload and comment paths; a real arXiv URL capture, private R2 delivery, and browser preview were additionally verified in the running development stack. See `validation.md` for precise coverage and limitations. No push or deployment occurred.

## 8. Labs, metadata titles, and page spacing

- [x] 8.1 Register PDF Labs opt-in, gate the upload entry and backend acquisition across REST, imports, and response-detected PDFs; keep PowerSync acceptance/dispatch independent of Labs; verify disabled/enabled flows, terminal workflow behavior, and continued access to existing documents.
- [x] 8.2 Read embedded PDF titles during extraction with filename fallback; verify real title metadata and metadata-free documents, deferred uploads, and unchanged user alias titles.
- [x] 8.3 Default PDF pages to no gaps and expose an accessible page-gap toggle; inspect desktop/H5 layout and mark alignment, run affected tests/typechecks and strict OpenSpec validation.

## 9. Sync independence and unrestricted PDF selections

- [x] 9.1 Remove Labs dependencies from sync acceptance/dispatch, preserve cached PDF relation types, regenerate API wiring, and verify mixed pending batches plus continued REST/workflow acquisition gates.
- [x] 9.2 Remove PDF character/page-segment/quad-count selection limits across frontend and REST/sync writes; retain document identity/geometry and existing article/comment limits, and verify selections exceeding all former limits.

## 10. PDF identification and author/source presentation

- [x] 10.1 Identify new URL captures by final response Content-Type with bounded file-signature fallback, remove frontend/backend PDF URL heuristics, and preserve cancellation, Labs opt-in, byte limits, file-integrity validation, and ordinary capture fallback.
- [x] 10.2 Verify misleading URLs, real PDF signatures with generic/missing headers, media-type case/parameter normalization, failed responses, Labs cancellation, existing article/import/sync paths, and unchanged article/shortcut/PDF type mappings; regenerate backend artifacts, run affected checks, and validate OpenSpec strictly.
- [x] 10.3 Extract XMP/document-info authors into the existing byline, including image-only documents, and supplement older PDF author display from client metadata without extra file requests.
- [ ] 10.4 Show PDF original-URL or local-upload source and available author using PDF-only header presentation; verify source links, synthetic-link exclusion, plain-text filenames, article/SSR regressions, themes, and narrow layout.

Task 10.4 implementation and component/type checks are complete. Rendered theme and narrow-layout inspection remains open: the existing localhost:3000 preview did not return a response during the live check. The running development processes were not restarted. This is separate from KMP device coverage under task 6.2.

Final review restored task 4.4 to open because software-keyboard acceptance has not been observed in a live browser/device. Its delayed PDF viewport subscription is fixed and regression-tested; existing desktop/H5/theme evidence remains recorded in `validation.md`. Tasks 7.3–7.6 retain their final presentation/action acceptance checks even where implementation and earlier smoke coverage exist.
