# Proposal

## Why

The extension's existing save actions depend on an injected HTML collector, so PDFs opened in Chrome's built-in viewer cannot reliably be saved, including already-open local files. The backend already supports public PDF URL capture and private raw-file upload; the missing capability is a safe, visible extension entry point into those existing flows.

## What Changes

- Route the existing toolbar action, Alt+Y command, and existing page context-menu save action through one source-aware dispatcher. Preserve normal HTML collection, including HTML served at a `.pdf`-looking URL.
- Automatically save from the initiating action and reuse the existing collection feedback component in an injected overlay on the original PDF page, without a second Save button or a full-page save tab. Explain that changing file permission can restart the extension: return to the original PDF and invoke toolbar/Alt+Y again, without file reselection or persistent paths. Retry remains available while context survives. Do not replace the action with a default popup or use offscreen UI. After local validation, copy the verified unpacked build to Downloads for the user's manual update; no store publication.
- Save online PDFs by submitting the original HTTP(S) URL, including its query, without scraping the viewer or forwarding source-site cookies. An unavailable-collector fallback also covers extensionless PDF viewers; URL hints are not authoritative PDF classification or Labs gates.
- Save the already-open local PDF by reading its bytes from the pinned source after browser-managed file access is allowed, then upload one raw PDF file with only its basename. Provide screenshot-backed Chrome extension-settings guidance, retry, and cancellation. Permission is required to read the already-open local PDF; do not replace this flow with a file picker. A real-browser transport spike must establish this direct-file path before claiming support; picker-only behavior does not satisfy the requirement.
- Preserve authentication, private upload semantics, the 50 MiB limit, and disabled-by-default PDF Labs opt-in. Show actionable failures and distinguish a queued URL save from a completed upload. Never silently enable Labs or bypass a hidden setting: users without opt-in remain unable to acquire PDFs.
- Do not create a new browser tab or window for collection feedback. Missing local file access blocks content-script injection, so show the screenshot guide in the extension button’s action bubble in that case.
- Preserve confirmed upload success for the backend's numeric encoded ID and nonempty bookmark UID, even when subsequent extension state synchronization fails.
- Resolve local popup titles from XMP dc:title, then document-info Title, falling back to the basename without its PDF suffix; persist and return the same metadata-derived title before the upload acknowledgement while leaving full text extraction asynchronous.
- Add focused unit and Chrome acceptance coverage plus permissions/privacy documentation during implementation.

## Capabilities

### New Capabilities

- `extension-pdf-saving`: Extension action routing, online URL submission, direct acquisition of already-open local PDFs, visible recovery, and source/permission/privacy boundaries.

### Modified Capabilities

None. This change consumes the existing PDF backend and the requirements in `add-pdf-bookmarks/specs/pdf-bookmarks/spec.md` without creating a second delta for that capability. The existing add-pdf-bookmarks metadata requirement is amended in place for the user-supplied metadata-empty PDF example. The independent settings-visibility change is not a dependency that removes or graduates the PDF gate.

## Impact

- Extension dispatcher and background messaging, a WXT `pdf-save` document embedded in the injected overlay, a shared collection feedback component, and a toolbar action bubble for missing file permissions, the current bridge request/session adapters, Extension-owned styling and locales, manifest file-access declarations if required by verified behavior, and existing test/documentation infrastructure.
- Existing endpoints only: `POST /v1/bookmark/add_url`, `POST /v1/bookmark/upload_pdf`, and read-only Labs/session state. The user also requested correction of confirmed-upload feedback and both PDF title paths. Reuse the backend's existing PDF parser for metadata-only extraction before upload acknowledgement; add an optional title to the upload response and a shared numeric-ID response type. Bundle the already-used unpdf version in the extension for local metadata display. No schema, new endpoint, or shared request-helper changes are planned.
- Chrome MV3 remains the target, retaining the Chrome 115 minimum. Permission behavior and local-file transport need actual browser verification; authenticated online resources may require explicit manual file upload instead of server capture.

## Non-goals

No PDF viewer injection, extension PDF annotation/reader, OCR, automatic source-cookie transfer, privileged arbitrary-URL downloader, automatic Labs enablement, Web settings changes, new backend upload endpoint, or store publication/release. The human approved implementation and subsequently requested automatic saving, reuse of collection feedback, and screenshot-backed permission guidance. These instructions supersede the earlier full-page save, picker, and separate-window designs. The user explicitly rejected opening a separate window and requested the existing injected-page presentation. The human subsequently authorized committing, pushing, and opening a PR on feat/extension-support-pdf (2026-10-15). Deployment and merge remain separate operations.

An explicit repeat upload of identical bytes also repairs a legacy filename-derived stored title when embedded metadata is available, without replacing the original file, resetting extraction state, or touching the user alias. No bulk backfill is performed.

## Online title refinement (2026-10-15)

The user supplied https://arxiv.org/pdf/2406.00845. Its first-page heading is present, but both XMP dc:title and document-info Title are empty. Preserve metadata priority, then conservatively identify a prominent horizontal first-page heading from existing PDF.js text geometry, and use the filename only when no confident heading exists. Do not require an AI/provider request, source-site HTML, OCR or a domain-specific title override. Refresh missing/incorrect titles from the existing immutable PDF on an explicit cached save, preserving user aliases, original bytes and extraction state.
