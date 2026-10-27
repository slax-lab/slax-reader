# Tasks

## PowerSync submission follow-up — 2026-10-27

- [x] P1 Record approved reuse-first scope; retain ordinary-save limitations and no schema/bucket/R2 changes.
- [x] P2 Route Reader sync creates to existing Fork admission with client UUID; preserve ordering, terminal source failures and ordinary-only batches.
- [x] P3 Reuse local insertion/save guard in the shared Fork hook; retain HTTP fallback, online checks and component presentation.
- [x] P4 Complete focused/full checks, real PostgreSQL and HTTP/Workflow/R2 exercises, UI smoke and final review; record evidence.
- [ ] P5 Record human acceptance and publish a new Draft PR because performance PR #396 is merged.


## Remove automatic cleanup — 2026-10-23

- [x] R10 Remove the unmerged cleanup table/migration, registration/retirement/claims and orphan sweep. Preserve immediate lifecycle deletion, uncertain-commit protection and bounded media/index maintenance.
- [x] R11 Verify lifecycle deletion and failure isolation with focused regressions and disposable PostgreSQL/R2/HTTP exercises; regenerate, run API checks, review and record the accepted residual-file boundary.

## Targeted cleanup follow-up — 2026-10-23 (superseded by R10–R11)

The implementation and evidence below are historical; automatic reclamation is removed by the later user decision.

- [x] R8 Replace periodic R2 listing with an additive PostgreSQL bundle ledger, indexed reference checks and bounded leased processing. Register before writes; atomically cancel publication and enqueue replacement/deletion. Cover HTML/media/PDF and preserve legacy cleanup.
- [x] R9 Verify registration failure, publication/claim races, rollback, retries, stale acknowledgements and live-reference protection with regression tests and disposable PostgreSQL/R2/HTTP exercises. Regenerate, run API checks, document rollout limits, and complete Bugs/Security/Compliance review.

## Owner recapture follow-up — 2026-10-23

- [x] R5 Record the approved provenance rule: clear only on successful independent owner publication, preserving failed/pending/no-op saves and metadata edits.
- [x] R6 Add failing regressions, implement atomic provenance clearing for ordinary capture and newly acquired PDF publication, and verify frozen media conversion, revision guards and personal-state preservation.
- [x] R7 Run API checks and isolated PostgreSQL/R2/HTTP exercises, review Bugs/Security/Compliance, record evidence and update the existing PR without changing package versions.

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
- [x] 2.6 Provide best-effort immediate attempt/retired-bundle deletion and preserve complete-bundle permanent deletion; retain uncertain-commit objects and accept exceptional residual files without automatic reclamation.

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
- [x] 4.6 Preserve provenance through saves reusing existing content, sync, trash/share and metadata updates without exposing it as client-writable state; clear only on successful server-side independent acquisition under R5–R7 and keep existing PowerSync projections compatible.

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

The fixed-path and endpoint/maintenance simplifications are implemented. Current verification and the completed owner retest are recorded in validation.md. Rows 3.2, 4.5 and 6.3 remain unchecked because their combined verification wording includes runtime scenarios not exercised in this desktop fixture; the exact automated coverage and remaining gaps are recorded in `validation.md`. Human hands-on UI acceptance in 6.4 was confirmed by the requesting project owner on 2026-10-22 with no further adjustments. Version decision 6.6 is settled: the user explicitly declined a bump. PR #354 is open against dev; the owner-recapture follow-up and its validation are recorded above and in validation.md.

## Approved fixed-path and repeat-Fork simplification — 2026-10-23

Historical checked items describe the earlier implementation; immutable storage and existing-Fork no-op behavior are superseded by these tasks.

- [x] R12 Preserve conventional R2 keys for all types; embed private media data in the saved HTML, remove replacement deletion, update readers/cache identity, and retain format/moderation and finite failure boundaries.
- [x] R13 Reuse existing status admission and atomic Workflow claim, bind accepted requests, retain finite retries and rescue selection, and protect direct private writes without a version field.
- [x] R14 Refresh an existing Fork in place, preserve historical shared personal identities/references, and fix old-client replay, legacy media isolation, missing body and frozen language fallback findings.
- [x] R15 Reuse Web/Extension submission guards and synced status, exercise regression/runtime scenarios, regenerate and validate, conduct independent review, and publish an updated explanatory document with flowcharts.

## Asynchronous Fork admission — 2026-10-23

- [x] R16 Return after persisted admission for interactive Fork/Reader URL saves; reuse existing durable Workflow execution, fixed-key publication and bounded failure guards. Add viewer-scoped persisted Fork status without schema changes and preserve completed import/callback accounting.
- [x] R17 Remove automatic navigation, show disabled persisted pending/success state on revisits, preserve failed retry and account/route isolation, and retain explicit Reader-URL refresh.
- [x] R18 Exercise slow/failing copy, duplicate admission, lifecycle/stale execution and frontend states; regenerate, run checks and independent review, and record evidence.
- [x] R19 Obtain renewed owner hands-on acceptance for this UI behavior. Following the explicitly requested push-first/test-later handoff, the owner tested the primary local checkout on 2026-10-23 and confirmed it meets expectations, with no further functional/UI adjustments requested. See the current acceptance record in validation.md.

## Approved simplification — construction (2026-10-23)

The owner approved these implementation tasks on 2026-10-23. See the [report](../../../docs/api/bookmark-fork-fixed-paths.md). Previous acceptance and checks remain scoped to the baseline.

- [x] S20 Obtain the owner's construction decision, then reconcile public acknowledgement, maintenance and detail/cache delta-spec scenarios with the approved proposal.
- [x] S21 Remove the new maintenance service/job/cursor and periodic index markers; preserve immediate search updates and original media retry/republish semantics. Verify failure propagation and same-request claim recovery without admitting stale or unrelated failed writes.
- [x] S22 Move button/Reader-dialog submissions to existing add_url, preserve its response/error convention, no-navigation acceptance and explicit URL refresh; remove unused public command plumbing after auditing all consumers.
- [x] S23 Merge safe attribution and viewer state into existing public/private detail projections; remove fork_metadata and duplicate client fetches. Cover PDF title-only SSR, legacy/private article consumers and local-first overlays.
- [x] S24 Bypass both shared-cache lookup/storage for credential-bearing requests, retain neutral anonymous caching and access revalidation, and invalidate account/route-specific client state including late responses and offline account changes.
- [x] S25 Remove only proven unused retiredKey/marker/types/parameters and unrelated formatting; retain source validation, fixed-key concurrency, all-format isolation, deletion and compatibility guards. Record final production/test/doc file counts without targeting an arbitrary total.
- [x] S26 Complete verification and handoff. Automated/regression/runtime evidence and independent Bugs/Security/Compliance review are recorded in validation.md. Following the owner-authorized PR-first/local-test handoff, the owner confirmed successful renewed human acceptance on 2026-10-23 at 21:42 (Asia/Shanghai), supplying screenshots of the Forked source state and the owned copy with Source/Fork attribution. No further functional/UI adjustments were requested. The current acceptance record covers `b5138b59` and closes this combined task; declared external-service/device gaps remain explicit.

## Review follow-up — 2026-10-26

- [x] R27 Initialize a real per-message queue identity and isolate legacy dispatch failures, retrying only rejected deliveries and recording a terminal failure for queued Reader shells.
- [x] R28 Require confirmed deterministic Workflow dispatch before acknowledging an active duplicate Fork; preserve the uncertain-dispatch claim boundary.
- [x] R29 Carry the actual content-publication timestamp through durable Workflow results and atomically guard moderation/share revocation against newer captures, including PDF publication.
- [x] R30 Run regression and isolated runtime checks, review Bugs/Security/Compliance, record actual evidence, and update PR #354 and its implementation report.

- [x] R31 Correct cached shared-content moderation to use the durable release result, verify post-processing/import accounting with composed real methods and PostgreSQL, and prepare the reviewed PR follow-up.

- [x] R32 Propagate the ordinary-tweet publication timestamp into Workflow moderation and test the real tweet publisher at that boundary.
- [x] R33 Separate post-commit moderation notifications from guarded-write retries; test transient and exhausted webhook failures without losing policy, completion events or import accounting.
- [x] R34 Preserve active capture timestamps during global podcast moderation while still enforcing policy/share revocation; verify pending, pending_retry and parseing transitions with real PostgreSQL and existing finite failure handling.

- [ ] P6 After this follow-up PR merges, classify any remaining unchecked tasks and archive the combined change in its documentation PR.
