# Tasks

## 1. Approved scope and direct-file feasibility

- [x] 1.1 Obtain human review and apply authorization, including direct saving of the already-open local PDF, existing collection feedback, screenshot-backed permission guidance, and preservation of PDF Labs eligibility.
- [x] 1.2 Prepare the worktree with the pinned dependencies and explicit synthetic test configuration, without reading or copying secret files.
- [x] 1.3 Verify the actual Chrome viewer exposes original HTTP(S)/file sources, the generated MV3 manifest permits browser-authorized file access, and direct extension-document reads preserve bytes for spaces/non-ASCII filenames.
- [x] 1.4 Verify the browser-managed file access setting can be disabled, enabled and revoked; confirm permission changes reload the extension and clear session operations.

## 2. Source-aware dispatch and operation ownership

- [x] 2.1 Route toolbar, the reserved Alt+Y action and existing page context-menu entry through the source-aware dispatcher while retaining HTML collection, including HTML at a `.pdf` path.
- [x] 2.2 Inject the existing source-page feedback overlay for online/permitted local PDFs, reuse it for repeated actions, automatically submit once, and close successful inline feedback after two seconds without creating a save tab/window.
- [x] 2.3 Serialize source-bound operations in trusted session storage with a 20-record bound and 15-minute expiry; invalidate navigation/closed sources and require explicit retry after interrupted submissions.
- [x] 2.4 Require exact extension-document identity and actual-iframe pairing by the isolated source controller; reject forged sender/path/query/source identities and synthetic pairing events.
- [x] 2.5 Keep PDF source readiness distinct from HTML collection and synchronize accepted saves through the validated completion path without updating a replacement navigation.

## 3. Permission guidance, session and eligibility

- [x] 3.1 Implement the native extension-button action bubble for missing file permission, with the bundled real Chrome settings screenshot, localized instructions, current-extension settings link, retry and return-to-source guidance.
- [x] 3.2 Use current session/client headers and read-only Labs state; prevent local reads/uploads for missing permission, disabled/unknown eligibility or changed accounts, without changing Labs settings.
- [x] 3.3 Reuse the Extension-owned collection renderer, preserve its light style, and add labelled controls, announced status, visible keyboard focus, long-title wrapping and reduced-motion handling.

## 4. Existing backend contracts and title correction

- [x] 4.1 Submit original HTTP(S) URLs with their query through `/v1/bookmark/add_url`; report the empty-UID response as queued and offer the bookmark list.
- [x] 4.2 Read local files directly with bounded bytes/time and cancellation; validate the nonempty 50 MiB boundary, PDF signature and sanitized basename, then upload the unchanged raw File with `Content-Type: application/pdf`.
- [x] 4.3 Accept the backend's positive numeric bookmark ID and nonempty UID, and preserve confirmed success when later extension synchronization fails.
- [x] 4.4 Resolve local popup metadata titles with the existing pinned PDF parser, timeout/cancellation and cleanup; keep immutable upload bytes and the original basename.
- [x] 4.5 Persist and return authoritative upload titles before acknowledgement while full text remains asynchronous; repair explicit repeat saves without changing file identity, extraction state or user aliases.
- [x] 4.6 Resolve backend titles from XMP/Info metadata, then a confident first-page heading, then filename. Exclude rotated margin identifiers/body text and join adjacent aligned title lines.
- [x] 4.7 Refresh cached online titles from stored immutable bytes without URL refetch or stale extraction-field rewrites; verify the supplied arXiv PDF resolves its complete visible heading.
- [x] 4.8 Audit request/storage/error boundaries for paths, credentials and binary persistence; keep private upload access, server validation and public-fetch policy intact.

## 5. Acceptance and regression evidence

- [x] 5.1 Run the actual Chrome toolbar fixture for exact local upload bytes, suffix/extensionless online URLs, HTML at a `.pdf` path, disabled Labs and repeated-action reuse.
- [x] 5.2 Run the actual native permission-bubble flow: disable file access, invoke the action, inspect the screenshot/steps, open the correct extension settings, enable access and reinvoke from the original PDF to upload automatically.
- [x] 5.3 Record the human's report on 2026-10-15 that manual end-to-end verification is complete. Do not describe it as outstanding or claim that the agent independently ran those live-account checks.
- [x] 5.4 Run the focused unit regressions for ownership, source/account changes, restart/retry state, byte/signature boundaries, cancellation, numeric acknowledgements, metadata cleanup and cached-title preservation.

## 6. Documentation and packaging

- [x] 6.1 Update the existing extension documentation for Chrome, source-page collection feedback, file permission guidance, Labs eligibility, raw-file privacy, titles and truthful queued/saved states.
- [x] 6.2 Run root extension typecheck/test/build/zip and API typecheck/focused tests, inspect the MV3 package, and verify the preview extension ID and exact zip/unpacked contents.
- [x] 6.3 Run strict OpenSpec validation and reconcile the final acceptance evidence with the approved scope.
- [x] 6.4 Complete the local REVIEW.md Bugs, Security and Compliance passes and resolve all Important findings before pushing.
- [x] 6.5 Copy the corrected preview build to Downloads for the human's manual update and hash-verify the 21 generated files with the retained preview extension ID.

## Validation record

- `pnpm extension -- test`: 100 tests in 23 files pass; `pnpm extension -- typecheck` passes.
- `pnpm api -- test test/domain/pdfTitle.test.ts test/domain/pdf.test.ts test/domain/pdfBookmarks.test.ts test/domain/pdfMarks.test.ts test/flow/addUrl/10-crawlWorkflowRun.test.ts`: 143 tests in five files pass; `pnpm api -- typecheck` passes.
- `pnpm api -- gen:all` passes in an isolated source copy with synthetic database URLs and no secret files/database access. All six generated outputs are byte-identical to the worktree files.
- Preview `pnpm extension -- build` and `pnpm extension -- zip` pass with explicit public configuration. The archive contains exactly the 21 unpacked files, no source/secret/source-map files, MV3/Chrome 115, no global action popup, and only the PDF iframe document as a web-accessible HTML resource. Preview ID: nkgkjnjkolpeiodphchpjiggkiciinik.
- Chrome 155.0.8059.40: the source-page fixture passes local exact raw bytes, original suffix/extensionless URLs, ordinary HTML collection, disabled Labs and one submission for repeated actions. The actual native file-permission action bubble renders its screenshot and recovery controls at a usable width, opens the correct extension settings, and automatically saves after permission reload and source reinvocation. The fixture captures the native browser-created popup via CDP, without opening a substitute extension tab. This fixes a discovered intrinsic-width collapse in the action bubble. The separate browser-settings transport spike passes off/on/revoked file access and confirms extension reload clears session metadata.
- The supplied arXiv 2406.00845 has empty Info/XMP titles. Poppler inspection and both backend extraction paths confirm its complete visible title: Quark orbital angular momentum in the proton from a twist-3 generalized parton distribution. Downloaded investigation files remain ignored; regressions use synthetic documents.
- Manual end-to-end verification was completed by the human, as reported on 2026-10-15.

## Final pre-push review

The local review follows REVIEW.md and settles on `extension-support-pdf`, with the existing `add-pdf-bookmarks` title requirement amended in place.

- Bugs: reviewed dispatch, native/inline surface selection, exact-byte uploads, retries, acknowledged results, title parsing and cached persistence. Fixed the native action popup's collapsed intrinsic width; the actual popup regression verifies readable guidance and visible controls. No unresolved Important finding.
- Security: reviewed actual-frame ownership, exact senders, source/account revalidation, configured endpoints, bounded reads/parsing and session-only storage. No unresolved Important finding.
- Compliance: reconciled the Chrome scope, approved collection presentation, permission guidance, unchanged Labs/private-file rules, title requirements and completed-task evidence. The human's manual end-to-end acceptance is recorded separately from automated mocked-API checks. No unresolved Important finding.
- `openspec validate --all --strict`: 43 items pass.

## 9. Requested PR delivery

- [x] 9.1 Rename the task branch and OpenSpec change to extension-support-pdf, integrate the current dev base, and reconcile the final patch.
- [x] 9.2 Finish appropriate checks and the required pre-push review with current permission-bubble evidence.
- [x] 9.3 Commit and push feat/extension-support-pdf, create a PR targeting dev with its OpenSpec reference and actual validation evidence, and attach it to this chat.

Delivery: https://github.com/slax-lab/slax-reader/pull/239 targets dev from feat/extension-support-pdf and is attached to the chat. The corrected permission-popup build was copied to Downloads with all 21 file hashes verified.

## 10. Permission bubble visual refinement

- [x] 10.1 Apply the human's requested visual refinement: one heading, concise setup steps, a real readable settings-row screenshot, quiet return guidance and clear primary/secondary actions using Extension-owned styles.
- [x] 10.2 Inspect actual Chrome popup renders in English and Chinese, verify visible recovery controls and keyboard focus, and rerun the existing collection regression fixture.
- [x] 10.3 Run appropriate checks and Bugs/Security/Compliance review, build/copy the verified extension to Downloads and push the refinement to the existing PR.

Visual refinement verification: Chrome 155 renders the English and Chinese native permission bubbles at 340 pixels with all recovery controls visible below the 600-pixel popup limit. Actual Tab-key input reaches the primary settings action with a visible focus ring. Both locale screenshots were inspected; the refreshed real setting-row capture contains only the permission label and switch. Existing toolbar URL/local collection, HTML preservation, repeated-action and permission-reload flows pass. Extension unit tests remain 100/100 and typecheck passes.

Visual refinement pre-push review: Bugs, Security and Compliance passes used extension-support-pdf and found no unresolved Important findings. The change preserves the collection flow and sender/session boundaries, keeps the screenshot free of private paths, and matches the requested light permission-card refinement. Build/zip pass with 20 matching packaged files (the smaller screenshot is now inlined), the retained preview ID and verified Downloads hashes. Strict OpenSpec validation passes all 43 items. Separate English settings artwork is left for the human to update, per the latest instruction.

## 11. Visual and motion refinement

- [x] 11.1 Replace the bundled settings-row screenshot with a code-drawn, locale-aware illustration nested under the step that uses it, record its Chrome-blue as a third-party-surface exception, and update the Extension development note that previously forbade it.
- [x] 11.2 Align the PDF save surface with the page-save popup's typography, raise its muted and accent text to 4.5:1 on white, enlarge the close and action hit areas, and record the one palette difference in `DESIGN.md` 4.3.
- [x] 11.3 Animate the injected PDF overlay in and out like the page-save popup, honoring reduced motion, safe against overlapping save actions and teardown, with focused tests.

Verification: `vue-tsc --noEmit` passes and the extension unit suite passes (23 files, 105 tests, including new overlay-motion and teardown cases). The CSS, the switch illustration and the animation were not inspected in a real browser in this change, so the rendered result still needs the human's visual check; `tests/pdf-browser.mjs` was updated for the new illustration but not run.

## 12. Restore the PDF Labs switch

- [x] 12.1 Archive the merged `hide-youtube-pdf-labs` change (PR #212) so its settings visibility rules become a living spec, then modify them here: show the PDF bookmarks row and keep YouTube hidden, with matching Settings navigation and deep-link behavior.
- [x] 12.2 Narrow the Web Settings visibility predicate to `youtube` only and update its component, composable and page tests, including a case that PDF renders and toggles with a `lab:pdf` enable request.
- [x] 12.3 Update the Extension's Labs-disabled copy in both locales to point users to Settings > Labs instead of saying the switch may be hidden, and reconcile the proposal, design and saving spec with the visible switch.

Verification: the three Web suites for Labs pass (57 tests). Strict OpenSpec validation is rerun after these edits. This lifts the earlier temporary hiding of `pdf`; the Labs entitlement and backend gate are unchanged.

