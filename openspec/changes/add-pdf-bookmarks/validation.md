# Validation

Date: 2026-10-10. Branch: `feature/support-pdf` (explicitly named by the user), based on `origin/dev`. The approved OpenSpec change remains `add-pdf-bookmarks`.

## Commands and results

Backend commands use the repository root entry point below. The complete backend test script was also invoked through the equivalent package filter.

| Root entry point or package command | Result |
| --- | --- |
| `pnpm api -- gen:all` | Passed; generated routes include PDF upload and GET/HEAD delivery. |
| `pnpm api -- test` | 157 test files passed, 1,817 tests passed, 46 optional integration tests skipped. |
| `pnpm api -- test test/utils/openaiModeration.test.ts test/domain/pdfBookmarks.test.ts test/flow/addUrl/10-crawlWorkflowRun.test.ts` | 91 tests passed after the real-runtime moderation redirect fix. |
| `pnpm api -- typecheck` | Passed after the final runtime fix. |
| `pnpm api -- build edge` | Passed offline dry run; no deployment. |
| Focused Web Vitest run | Seven files, 72 tests passed: PDF geometry, upload dialog, binary delivery, article integration, comment permissions, AI panel, and local bookmark mappings. |
| Web typecheck and production build | Passed. Matching PDF worker, scoped viewer CSS, local CMaps/fonts/WASM, and dependency license notices are included. |
| Contracts, frontend types, and selection typechecks | Passed. |
| Extension compile | Passed with the shared selection changes. |
| `pnpm exec openspec validate --all --strict` | 25 items passed, none failed. |
| `git diff --check` | Passed. |

The full backend run preceded the five additional moderation redirect tests; the affected moderation/PDF/workflow suites were rerun after that fix. Ordinary article fixtures and legacy error-name fixtures remain covered.

## Browser and runtime evidence

An isolated browser exercised `/b/<uuid>` using mocked API responses and real PDF.js rendering. A 30-page text fixture includes rotated pages and a nonzero page origin. Verified highlight/comment creation, replies, highlight deletion retaining comments, failed-save rollback, reopening, zoom, page 30 navigation, and an AI quote navigating to an initially unrendered page. Only six live canvases remained when navigating to page 30. Desktop and 768px, 390px, and 320px layouts had no document-wide horizontal overflow; H5 toolbar targets measured at least 44px. Light, dark, and e-ink appearance was inspected. The H5 passage tap opened the existing comment sheet.

Evidence is local and gitignored under `.local/pdf-validation/` (browser fixture, screenshots, and generated PDF). The backend text extractor was additionally exercised in local workerd: the 30-page fixture returned ready text, and a one-page blank PDF returned `empty`.

### Real arXiv capture

The user's running development stack captured `https://arxiv.org/pdf/2608.00046`. Its original PDF is 935,464 bytes with 13 pages; text extraction returned 52,281 characters. The original object, extraction-state object, and extracted-text object were persisted. The existing crawl instance completed its fetch, moderation, and post-processing steps, and the normal localhost reader visibly rendered the PDF.

A temporary UI fixture Worker had initially reused the development backend's name and intercepted its local binding. The failed instance reported `Worker does not export an entrypoint named "CrawlWorkflow"` before running any steps. The temporary Workers were stopped, their fixture name was isolated, and the same instance was restarted. This was a local test-process collision, not an arXiv-format failure.

Real execution then exposed the existing moderation client's unsupported Workers `redirect: error` option. It now uses `manual` and explicitly rejects 3xx responses without forwarding credentials. Five redirect-status regression cases passed; moderation and post-processing subsequently completed in the real workflow.

## Local review

Following root `REVIEW.md`, the behavior-changing diff matches OpenSpec change `add-pdf-bookmarks`.

- **Bugs:** Reviewed upload/capture/persistence ordering, immutable retries, range delivery, type mappings, selection transforms, viewer lifecycle, notes, and AI guards. Fixed detached PDF buffers, short-chunk signature detection, collection type mapping, initial upload status, decoded response-length handling, competing upload cleanup, and Worker moderation compatibility. No remaining Important findings in the reviewed implementation.
- **Security:** Reviewed existing authorization on every binary request, private/no-store responses, public-target redirect policy, bounded reads, PDF source identity on REST/sync writes, scripting/form-editor exclusions, and credential-safe moderation redirects. No Important findings.
- **Compliance:** The implementation preserves numeric/JSON database compatibility and existing comments, uses a 50 MiB limit, supports text-based AI without OCR, retains licenses, and includes desktop/H5 presentation. Task 6.2 remains explicitly open for the remaining live/device checks. A draft PR description containing `OpenSpec: add-pdf-bookmarks` is retained in the local validation directory; no PR has been created or pushed.

## PDF underline placement regression

The article-style refinement added a fixed 6px offset below the transformed PDF selection rectangle. On the real arXiv document, that pushed underlines toward the following line. Removed only that rendering offset; stored quadrilaterals, comment records, article styling, and the restored 820px content width remain unchanged. The existing marks were inspected in the running reader at default desktop fit (772px page), 120% zoom (975px page), and a 390px viewport (358px page), then the viewport and fit were restored. Every rendered underline matched its transformed selection bottom edge. For the selected `Sergio B. Fajardo-Acosta` passage on H5, its underline was 0.264px below the current native text range bottom, within layout rounding. The existing 20 focused PDF tests, direct Web `vue-tsc`, and strict OpenSpec validation passed.

## Labs, metadata, and page-gap refinement

PDF now has an independent active Labs feature, disabled by default. The upload dialog fetches Labs for both regular and local-first use, hides the PDF entry until opt-in is known, clears a selected file when opt-in is removed, and uses the existing Labs error action for server rejection. Backend upload checks precede body consumption and row creation. URL/import capture rechecks opt-in after the response probe, so extensionless PDF responses cannot bypass it. Workflow Labs rejection fails the pending save without retry or fault alerts. PowerSync checks recognizable links before its bookmark upsert and cached extensionless PDFs before relationship writes inside the batch; the defensive dispatch check preserves an existing file's successful status.

The existing extractor now reads embedded XMP/document-info title metadata, with filename fallback. Deferred upload extraction updates the base title while preserving user alias titles, and accepted extraction can finish after Labs is disabled. Binary delivery continues to use read authorization without requiring a current Labs opt-in.

Validation for this refinement:

- `pnpm api -- test`: 157 files passed, 1,840 tests passed, 46 optional integration tests skipped. After the final PowerSync transaction gate, its five affected suites passed 57 tests.
- Isolated Nuxt Vitest for the upload dialog, Labs composable, and Labs settings: 48 tests passed. The isolated build directory preserved the user's running Nuxt server.
- The existing PDF inline-viewer, geometry, and preview suites: 20 tests passed.
- `pnpm api -- gen:di` plus the existing generated-output formatter: passed; the only resulting registration change supplies `LabService` to `DBSyncBatchOperation`.
- Final `pnpm api -- typecheck` and direct Web `vue-tsc --noEmit -p .nuxt/tsconfig.app.json`: passed.
- `pnpm api -- build edge`: passed offline dry run after the final dependency registration change; no deployment.
- Strict OpenSpec validation: 25 items passed, none failed. `git diff --check`: passed.

The running real arXiv reader was inspected at desktop 1345px and H5 768px, 390px, and 320px widths. Default gap measured 0px; enabling the labelled, pressed-state toggle measured 20px; disabling it returned to 0px. Desktop page width stayed 772px; the 390px viewport retained its 358px page. No document-wide horizontal overflow was present, and H5 control targets measured 44px high. All 43 mounted underline segments at 320px matched their transformed polygon bottom edges before and after toggling gaps (maximum coordinate difference: 0). Screenshots were inspected in light, dark, and e-ink modes; e-ink retained its shadow-free control surface. Temporary viewport/theme overrides were restored to desktop/light with gaps disabled. Original HTML article styles and `SnapshotDetailLayout.vue` were not changed by this refinement.

OCR is research only in this refinement. A future browser OCR path should retain page/document identity, engine version, and word bounding boxes from its first iteration, convert image coordinates into the existing PDF page coordinates, and reuse existing comment persistence. Browser-only OCR does not automatically supply backend AI text.

## Remaining coverage

The external KMP project and a real Android/iOS WebView with software keyboard were not exercised. Browser touch emulation does not establish native selection-handle or keyboard behavior. REST/sync repository tests validate geometry and thread preservation, but do not constitute a live PowerSync cross-device round trip. An authenticated live upload/sharing browser exercise and those device checks remain acceptance follow-up under task 6.2. Scanned PDFs have no OCR; password-protected documents report the unsupported state. No migration, remote deployment, or project-license change was performed.


## OCR removal, independent sync, and unrestricted PDF selections (2026-10-10)

- Removed the browser OCR prototype at the user's request: reader entry, dialog, worker adapter, language/core assets, dependency notices, dependencies, and OCR-only tests. OCR remains outside this change; existing text extraction and PDF AI paths are preserved.
- Removed Labs dependencies from `/v1/sync/changes` database acceptance and workflow dispatch for all bookmark URLs. New acquisition still checks the PDF opt-in in REST/upload/import/capture entry points. Cached PDF re-saves preserve relation type `2`. The user reported that their sync had recovered before these final checks; no persistent runtime error or root cause was provided, so this change is not claimed as the cause of that recovery.
- Removed the PDF-only 1,000-character, 20-segment, and 1,000-quad limits. Valid selections exceeding all former limits pass contract validation and REST/bookmark/collection sync persistence tests. Document identity, source version, positive page indices, finite geometry, legacy HTML selection limits, and comment-body limits remain enforced. Invalid PDF positioning uses an accurate retry-selection message instead of a size-limit message.
- API verification before OCR removal: `pnpm api -- gen:all` and `pnpm api -- typecheck` succeeded. Focused PDF/sync tests passed 56/56; `pnpm api -- test` passed 1,845 tests with 46 explicitly skipped infrastructure tests. OCR removal does not alter backend code.

- Verification after removal: the three PDF inline-viewer/geometry/preview suites passed all 20 tests; Web `vue-tsc` passed using the previously generated isolated Nuxt configuration. Direct checking against the existing development-generated configuration still reports stale Nuxt/i18n augmentation diagnostics following dependency relinking; the isolated configuration passes without application-source workarounds. OCR source/assets/translations/lockfile references are absent. Strict OpenSpec validation passed all 25 items, and `git diff --check` passed.

Earlier entries describing PDF sync Labs rejection or PDF selection-size bounds are superseded by this section and the revised specification. Actual Android/iOS KMP WebView and software-keyboard behavior remain untested under task 6.2.

## PDF response identification, authors, and source display (2026-10-10)

- Final identification uses normalized final response Content-Type (`application/pdf`) with the existing bounded PDF file-signature fallback for generic/missing headers. File integrity and the 50 MiB streaming limit remain enforced. Removed PDF URL heuristics from both frontend and backend Labs URL gates, so a `.pdf` suffix or arXiv path alone cannot reject an ordinary page. Response-detected PDFs and explicit uploads still require PDF opt-in; cached-file read/sync behavior is preserved. The earlier URL-based PDF Labs descriptions are superseded.
- Backend extraction now prefers XMP `dc:creator`, including author lists, then Info `Author`, and writes normalized metadata into the existing `byline`. Image-only PDFs still expose available metadata. Missing authors are not inferred from creation software. Existing PDFs can supplement author display from the client's already-loaded document metadata without another download or database mutation.
- PDF-only header presentation shows an original-URL source badge or a localized local-upload label with filename and available author. Synthetic upload URLs are not linked. HTML article source presentation and PDF title/type-only SSR remain unchanged. New presentation uses semantic Web tokens and a 44px H5 source-link target.
- `pnpm api -- gen:all` and `pnpm api -- typecheck` passed. Eight affected API suites covered 177 tests; one import test fixture initially lacked the repository facade, was corrected, and its full 11-test suite passed on rerun. PDF signature/header distinctions, split chunks, cancellation, author extraction/storage, type mapping, imports, crawl and sync paths are covered.
- Frontend URL-gate/Labs/upload suites passed 48 tests before the author UI addition. The new PDF source and unchanged article source suites passed seven tests. A concurrent combined Nuxt run initially exceeded setup-hook timeouts; serialized source suites passed. Web `vue-tsc` passed against the existing consistent isolated Nuxt configuration. Strict OpenSpec validation passed all 25 items and `git diff --check` passed after generated-output formatting completed.
- Live browser navigation and an eight-second HTTP availability check could not load the existing localhost:3000 preview. No development processes were stopped or restarted, and the temporary browser tab was closed. Actual rendered desktop/H5/theme inspection of the new source row remains open in task 10.4; no KMP-device coverage is claimed.
- The existing bookmark field remains `0 = article`, `1 = URL shortcut`, `2 = PDF`; the legacy Prisma schema and shortcut creation path confirm that the PDF value does not overlap shortcut records. No migration, deployment, push, or OCR feature was added.

## Final local pre-push review (2026-10-10)

Reviewed the complete feature diff under `REVIEW.md`, linked to `add-pdf-bookmarks` by its proposal and PDF capability specification.

- **Bugs:** Found and fixed the PDF notes sheet's keyboard viewport subscription: the original mount-only check missed PDF metadata arriving after title-only hydration. It now observes the PDF flag and cleans up subscriptions when returning to an article. A regression test covers delayed activation, keyboard resize/pan, and disabling the PDF behavior. Capture, immutable storage, metadata, AI guards, range delivery, type mapping, mark persistence, geometry, and reader teardown were reviewed; no remaining Important findings.
- **Security:** Reviewed authorization on metadata and each file/range request, private/no-store delivery, public-target capture, bounded ingestion, document identity validation in REST/sync, disabled scripting/forms, and credential-safe moderation redirects. No Important findings.
- **Compliance:** The final implementation follows the approved PDF change, including 50 MiB ingestion, Labs opt-in with independent sync, text-based AI, no OCR or database migration, existing comments and dependency notices. Restricted the upload dialog's new H5 target sizing to its PDF-enabled state so ordinary URL-only presentation is preserved. Remaining live/device acceptance checks are kept open and must be disclosed in the PR.
- Fresh API full suite: 157 files passed, 1,855 tests passed, 46 optional infrastructure tests skipped. Fresh isolated Web run: nine suites and 87 tests passed, including upload/Labs, source display, private binary delivery, existing AI/comments, and the delayed PDF keyboard regression.

Earlier historical no-push statements describe their individual validation sessions. Final branch synchronization and release-check results will be recorded before the feature is pushed; no deployment is part of this task.

### Final synchronized branch checks

- Merged `origin/dev` at `8682a73` without conflicts. Reviewed the resulting feature diff, including the three automatically merged Web files; upstream icon changes remain intact. No additional Important Bugs, Security, or Compliance findings.
- The nine affected Web suites passed all 87 tests again after the merge. The three PDF inline-viewer/geometry/preview suites passed all 20 tests. The updated upstream deployment-path suite passed all 13 tests.
- `pnpm api -- typecheck`, shared selection typecheck, Extension compile, and Web `vue-tsc` against freshly generated isolated Nuxt types passed. Extension preparation emitted existing missing-public-runtime-value warnings but completed successfully.
- `pnpm api -- build` completed its offline dry run. A full isolated Nuxt production build completed, including the client worker, scoped PDF CSS, local PDF assets, prerender output, and Cloudflare Pages server. Isolation kept the existing Web development server/build directory untouched.
- `pnpm design:check`, `pnpm icons:check`, strict OpenSpec validation (27 items after the upstream merge), and the full feature diff whitespace check passed.
- Live upload/sharing, actual software-keyboard/KMP device acceptance, and the latest PDF source-row visual inspection remain explicitly open. These are reported as remaining coverage in the PR; no deployment or merge is authorized by this task.

## API CI lint follow-up

The initial PR API CI run `38036700365`, job `114168503188`, failed on 33 `prettier/prettier` errors in six API source files. Applied the existing ESLint formatter only to those files; no generated code, UI, rules, or runtime behavior changed.

- `pnpm api -- lint` passed with zero errors. The same 336 warnings remain nonblocking.
- `pnpm api -- typecheck` and `git diff --check` passed.
- Local pre-push review: Bugs and Security found no semantic or access-policy changes; Compliance confirms an implementation-only formatting follow-up to `add-pdf-bookmarks`. No Important findings.

## API CI test isolation follow-up

The next API CI run `38037648999` passed lint and typecheck but failed while loading `test/domain/pdf.test.ts`: its import of Web `geometry.ts` made Vite resolve the Web tsconfig and its absent `.nuxt/tsconfig.app.json`. Reproduced the same failure in a separate clean checkout with no Web build directory.

- Moved the four rotated/nonzero-origin viewport tests into Web `pdfViewport.spec.ts`. They now exercise the frontend's pinned PDF.js with a real PDF fixture and retain all zoom/density assertions. API tests no longer import Web source; backend extraction, metadata, ingestion limits, and contracts remain covered. No production code, UI, dependency, or CI configuration changed.
- `pnpm api -- test` in that clean checkout passed: 157 files passed, 1,852 tests passed, and 46 optional infrastructure tests skipped. Web `.nuxt` remained absent before and after the run.
- The four PDF viewer/geometry/viewport/preview suites passed all 24 tests, both in plain happy-dom and with the repository's shared Nuxt test setup using an isolated build directory.
- Local pre-push review under `REVIEW.md`: Bugs confirms preserved geometry coverage and independent API setup; Security confirms no runtime or access-policy changes; Compliance confirms an implementation-only test relocation within `add-pdf-bookmarks`. No Important findings.

## PR review: non-PDF acquisition gates

Review run `38038349778` reported one Important finding: removing Labs checks from sync dispatch also removed the only asynchronous gate for YouTube captures. The existing REST gate remained, but a PowerSync-originated acquisition could proceed with YouTube Labs disabled. Confirmed the finding against `LabService.GATED_ROUTES` and the crawl workflow.

- Restored URL-based Labs checks in the crawl fetch step before cache reuse and after short-link resolution. Disabled acquisitions raise `NonRetryableError`, mark the pending bookmark failed, retain import failure accounting, and skip fault alerts. Gated acquisitions retain retriable infrastructure errors; ungated URLs do not read Labs state. Sync acceptance and dispatch remain independent of Labs, and PDF gating still uses response detection.
- Ten new workflow cases cover direct/short-form YouTube URLs, disabled cache reuse, redirected short links, enabled captures, user identity, ungated articles during Labs outages, retriable Labs failures, and import accounting. Six affected suites passed 153 tests, including the unchanged sync independence and PDF acquisition tests.
- `pnpm api -- test`: 157 files passed, 1,862 tests passed, 46 optional infrastructure tests skipped.
- `pnpm api -- lint`: zero errors, 336 existing warnings. `pnpm api -- typecheck` and `pnpm api -- build` passed; the build bundled all four Workers offline without deployment. `LabService` already has a generated infrastructure registration, so no generated-file edit was needed.
- Local pre-push review under `REVIEW.md`: **Bugs** confirmed gate placement before cache reuse and provider requests, enabled behavior, terminal disabled errors, and independent sync; **Security** confirmed checks use the workflow user's context and preserve authorization and storage policy; **Compliance** confirmed the approved change's continued acquisition gates and tasks 9.1/9.3. No remaining Important findings in this follow-up.
