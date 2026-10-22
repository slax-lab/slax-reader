# Tasks

## Review follow-up — 2026-10-22

- [x] R1 Restore search visibility after existing/own-source Fork restores without repeating creation notifications; verify both paths against a cached trashed-bookmark candidate set.
- [x] R2 Keep managed media status available when best-effort catch-up fails, and allow explicit owner recovery after podcast input changes without changing frozen Forks or completed components; verify failure, retry, input guards and saved component preservation.
- [x] R3 Consolidate snapshot publication and version-aware indexing; avoid redundant manifest/PDF reads and remove the unused podcast linking mode while preserving final policy/revision checks and recovery semantics.
- [x] R4 Run focused/full API checks, required generators, disposable HTTP/R2/PostgreSQL recovery scenarios and independent Bugs/Security/Compliance review; record results and any remaining gaps in validation.md.

## 1. Approved baseline and additive contracts

- [x] 1.1 Record human review of the proposal, including all-format media isolation and online-only creation; before managed-media implementation, sequence after the existing media changes' separate archive workflow, add scoped MODIFIED deltas to reconcile their living requirements, revalidate and obtain review; verify `validation.md` identifies the settled baseline and reconciled scope.
- [x] 1.2 Add nullable `forked_from_id` in `apps/api/prisma/pgsql.prisma`, generate and inspect additive SQL with `pnpm api -- gen:diff`, apply to a disposable local database and regenerate clients; verify existing inserts and the PDF metadata trigger remain compatible.
- [x] 1.3 Add Fork request/result/error and attribution types in `packages/contracts`, with explicit real HTTP statuses for the new endpoints; verify contracts typecheck and fixture responses for created, already saved, unavailable, conflict and transient failure.
- [x] 1.4 Add a shared configured-origin Reader URL classifier and source-resource identity helpers; verify exact origins, malformed/userinfo URLs, harmless variants, external normalization and uploaded-PDF destination identity with focused cases.

## 2. Content bundle publication

- [x] 2.1 Add immutable attempt-scoped bundle storage, conditional source reads and allowlisted metadata in the bucket/snapshot helper; verify missing objects, changed ETags and partial writes cannot publish success.
- [x] 2.2 Add narrow insert-only Fork publication and revision CAS operations in the bookmark repository; verify unique-conflict winners, pending/failed destinations and raw-row-without-relation deletion races against local PostgreSQL.
- [x] 2.3 Implement confirmed/unknown commit reconciliation and post-commit side-effect separation; inject a commit-then-timeout and indexing failure to prove live objects remain readable.
- [x] 2.4 Move new HTML capture/media bundle publication behind immutable pointers and make `content_key` authoritative in Web/API body readers; verify stale conventional UUID objects cannot mask a new revision and legacy reads remain available.
- [x] 2.5 Implement historical-source HTML snapshot extraction from one validated body, with no URL refetch/provider parsing; verify destination text corresponds to that body while historical writers change their separate text object.
- [x] 2.6 Add bounded attempt/superseded-bundle cleanup and complete-bundle deletion using existing scheduling infrastructure; verify active, referenced and uncertain-commit objects survive cleanup while proven orphans are eventually removed.

## 3. All-format private snapshots

- [x] 3.1 Implement article/shortcut copy adapters and article-field allowlists; verify shortcuts remain bodyless and source personal state is excluded.
- [ ] 3.2 Implement PDF binary/sidecar/optional-text copying, destination upload identity and post-insert `pdf_document_id` merge; verify PDF fixtures cover pending/ready/empty/failed extraction, duplicate upload and destination highlights/range reads after source deletion.
- [x] 3.3 Add a versioned private media sidecar and typed readers for YouTube/podcast bodies and ready variants; verify destination version tokens, unavailable frozen variants and missing-sidecar failure without canonical fallback.
- [x] 3.4 Initialize managed snapshots for new ordinary media captures, pin requested inputs/components and finalize first terminal results through revision CAS; verify B's save/retry cannot update A and a late result cannot overwrite A's explicit refresh.
- [x] 3.5 Adapt YouTube status/content/publication/backfill to private snapshots while preserving player/cues and fallback article behavior; verify annotated-source Forks, source generation races and independent ready variants.
- [x] 3.6 Adapt podcast status/translation/publication and reference-hash movement to private snapshots; verify saved episode identity, translations/time mapping and stale-input rejection when another user refreshes the episode.
- [x] 3.7 Separate active processing refs from policy-inclusive refs and establish the takedown barrier before enumeration; verify frozen copies do not trigger generation or move source hashes, moderation/takedown reaches body and sidecar, and concurrent publication plus cached reads cannot evade policy.

## 4. Fork service and entry adapters

- [x] 4.1 Implement `BookmarkForkService` source authorization, feature gates, final transactional source recheck, duplicate/restore behavior and content publication; verify the bookmark-fork spec's access, concurrency, lifecycle and own-source scenarios.
- [x] 4.2 Add Fork HTTP and no-store attribution endpoints with exact source-ID/resource revalidation and source `show_userinfo` enforcement; regenerate router/DI rather than hand-editing generated files, and verify real HTTP status, cache headers, hidden-identity and UUID reuse/rebinding cases.
- [x] 4.3 Route `/add` and `/add_url` through the classifier and a completed-Fork result while retaining legacy response shapes; verify supplied Reader HTML is ignored, no workflow starts and ordinary URL tests pass.
- [x] 4.4 Add Telegram preflight/domain and import item adapters; verify callbacks and per-item counts, bounded copy concurrency, destination-requested metadata, and no crawl of a completed Fork.
- [ ] 4.5 Implement guarded terminal failed placeholders with deterministic per-client URL-fragment identities for old Reader-URL sync creates and suppress crawl/manual shell retry/rescue; verify same-source/different-UUID uploads, mixed batches, delayed dependent edits, UUID collision protection and lost-ack replay on Web/Mobile uploader behavior.
- [x] 4.6 Preserve provenance through ordinary re-save, sync, trash/share and metadata updates without exposing it as client-writable state; verify attempts to forge or clear it fail and existing PowerSync projections remain compatible.

## 5. Web and Extension integration

- [x] 5.1 Add a reusable online Fork action and route Reader URL input before local-first insertion; verify offline, login-return, loading, repeated-click, error and created/already-saved navigation behavior.
- [x] 5.2 Add the visitor action to `/b/[id].vue` and Fork attribution beside article/PDF Source; verify 320px, 768px and desktop layouts in light/dark/e-ink, keyboard/touch states and reduced motion using `DESIGN.md`.
- [x] 5.3 Keep shared SSR payloads neutral and fetch scoped no-store attribution after hydration; verify source-owner-to-anonymous cache reuse, revocation, account switch, route switch and failed metadata fetch without identity disclosure.
- [x] 5.4 Adapt Web media composables to private revision/status semantics and terminal absent variants; verify no perpetual polling, destination version refresh and no replacement while playback is active.
- [x] 5.5 Adapt Reader-tab saved-state resolution in `apps/web/app/pages/x/ext-bridge.vue` and Extension background/capture handling; verify capture acknowledgement, revisit badge/sidebar and account changes without changing original target URLs.

## 6. Verification and handoff

- [x] 6.1 Run focused regression suites plus `pnpm api -- lint`, `pnpm api -- typecheck`, `pnpm api -- test` and the appropriate offline build with nonsecret configuration; record outcomes and actual gaps in `validation.md`.
- [x] 6.2 Run contracts/Web/Extension checks through documented root commands, including `pnpm web -- typecheck`, `test`, `build` and `pnpm extension -- typecheck`, `test`, `build`; assess indirect Mobile/CLI contract effects and verify affected consumer checks.
- [ ] 6.3 Exercise a disposable running API/R2/PostgreSQL environment with two accounts across every supported format, source revocation/deletion, duplicate/concurrent saves and ambiguous-commit fault injection; record scenario-specific evidence beyond unit mocks.
- [x] 6.4 Exercise Web and Extension against the prepared environment, including a phone-width public reader and media/PDF independence; record agent evidence and obtain human hands-on UI acceptance with adjustments reverified before opening a PR.
- [x] 6.5 Run `pnpm exec openspec validate --all --strict`, all three `REVIEW.md` review passes and resolve Important findings; record the selected change-id and review disposition.
- [x] 6.6 Assess affected shipped application versions, ask one explicit version-decision question after validation, and apply only the approved metadata changes; verify release conditions and record the decision before final ready/commit/push handoff.
- [x] 6.7 Update API/development documentation and the reviewed feasibility summary, complete `validation.md` and prepare a repository-template PR body with `OpenSpec: add-bookmark-fork`; verify all claimed checks and acceptance evidence are present, leaving remote deployment and post-merge archival to their authorized steps.

## Handoff status

All implementation work is present. Rows 3.2, 4.5 and 6.3 remain unchecked because their combined verification wording includes runtime scenarios not exercised in this desktop fixture; the exact automated coverage and remaining gaps are recorded in `validation.md`. Human hands-on UI acceptance in 6.4 was confirmed by the requesting project owner on 2026-10-22 with no further adjustments. Version decision 6.6 is settled: the user explicitly declined a bump. The repository-template PR body is prepared locally and is not published.
