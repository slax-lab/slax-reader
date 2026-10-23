# Private bookmark snapshots and Fork feasibility

> Status: historical feasibility analysis. See the [fixed-path baseline and pending simplification proposal](bookmark-fork-fixed-paths.md) for the current code and the separately labeled plan awaiting construction approval. The immutable-path, repeat-Fork no-op and maintenance choices below must not be read as the new pending design.

Date: 2026-10-22. Status: revised after review and user scope decisions; formal proposal awaits review. No business implementation or migration has been performed.

Implementation worktree: `/Users/yjc/.codex/worktrees/add-bookmark-fork/slax-reader-v2`, branch `feat/add-bookmark-fork`, based on `origin/dev` at `7089a16ef1fdacb91e89bbf3465b47ff10a5598a`. Original analysis used `6052b43eada65fe835154517f4ffac6c50c4390b`; relevant behavior was rechecked against the new baseline. Production deployment, data and migrations were not inspected.

The detailed implementation contract is in [proposal](../../openspec/changes/add-bookmark-fork/proposal.md), [design](../../openspec/changes/add-bookmark-fork/design.md), [acceptance specs](../../openspec/changes/add-bookmark-fork/specs/bookmark-fork/spec.md), [snapshot specs](../../openspec/changes/add-bookmark-fork/specs/private-bookmark-snapshots/spec.md) and [tasks](../../openspec/changes/add-bookmark-fork/tasks.md).

## 1. Selected scope and feasibility

The feature is feasible with **one new nullable database column**, `sr_user_bookmark.forked_from_id`, identifying the exact source user-bookmark relation. The user selected relational provenance rather than JSON-only storage, all current content types for the first release, and online-only Fork creation. Successful copies continue to synchronize through PowerSync; ordinary external-URL collection keeps its existing local-first behavior.

All current types includes ordinary articles, URL shortcuts, PDFs, YouTube and podcasts. Supporting media requires more than copying two R2 objects: currently generated article/translation state can be shared and can update multiple users' bodies. The proposal therefore includes independent media content snapshots for new captures as well as Forks. This is the largest part of the change, not the database column or button.

Keep one personal copy per resource. Fork returns an existing successful copy unchanged, restores a ready trashed copy and does not overwrite its body or provenance. Multiple saved versions of the same URL, offline Fork submission, bulk historical-data conversion and provenance-preserving export/import are excluded.

## 2. Current pipeline: what was confirmed and corrected

| Entry | Observed behavior | Source |
| --- | --- | --- |
| Extension HTML | `/v1/bookmark/add` creates current-user private data and starts capture | `apps/api/src/domain/bookmark.ts:addBookmark`, `domain/orchestrator/bookmarkAdd.ts` |
| REST URL | `/v1/bookmark/add_url` creates current-user private data; workflow fetches/parses | `apps/api/src/domain/bookmark.ts:addUrlBookmark` |
| Web local-first | Usually creates an optimistic local row and uploads a sync create, rather than calling add_url | `apps/web/app/components/BookmarkList/AddUrlTopModal.vue`, `apps/api/src/infra/repository/dbSyncBatch.ts:executeCreateBookmark` |
| Import | Creation uses importing-user ownership through a separate batch path | `apps/api/src/domain/bookmark.ts:addUrlBookmarkItem` |
| YouTube/podcast derivation | Shared canonical generation can publish into multiple private bookmark bodies | `apps/api/src/domain/youtubeArticle.ts:publishBodies`, `podcast.ts:publishBodies`, `mediaBody.ts:writeBody` |

The original claim that current URL saves create public raw content is incorrect for this checkout. Both ordinary creation paths explicitly use the current user's `private_user`, and PostgreSQL enforces uniqueness on `(target_url, private_user)`. The runtime schema is `apps/api/prisma/pgsql.prisma`, not the legacy `schema.prisma`.

However, private raw rows alone do **not** establish complete media immutability. The later all-format audit found shared media body publication and status catch-up. The original broad isolation conclusion is therefore narrowed: ordinary raw ownership is already private; completed media presentation still needs isolation.

Ordinary parsed content currently uses `html/body/<userBookmarkUuid>.html` and `text/body/<userBookmarkUuid>.txt`. `content_md_key` is the text representation, not necessarily Markdown. Inline captures can still use specialized provider fetching for some platforms. Same-owner explicit re-saving can update that owner's content.

Historical `private_user = 0` records, the unused public-fallback helpers and deployed production behavior are not automatically changed by new private captures. Do not assign a shared historical row to one user in place. Historical conversion remains a separately reviewed operation.

## 3. Ownership, permission and identity

`private_user` controls ownership, not whether a saved snapshot can be shared. Reuse `resolveBookmarkReadAccess`: owner access, visitor trash/moderation/owner checks, explicit sharing and global snapshot-sharing policy. Require an authenticated active destination user and preserve existing underlying acquisition gates.

A Reader `/b/<uuid>` identifies `sr_user_bookmark.uuid`. Persist the source's server-assigned integer relation ID in `forked_from_id`, not the raw bookmark ID or a client-reusable UUID. The field is a soft reference: deleting the source leaves the Fork marker intact. A foreign key with cascade or SET NULL would break independent ownership or erase provenance. No reverse index is needed for forward primary-key lookup.

Attribution reauthorizes the exact source identity and verifies it still refers to the same resource. Never resolve a missing source by another row with the old UUID/URL. Source UUID reuse and same-row rebinding must not hijack attribution. Fork-of-Fork records its immediate source.

Read permission and identity visibility are separate: the existing `share.show_userinfo` rule still applies. A readable source with hidden owner information gets a generic label and at most the permitted snapshot link. An inaccessible/deleted source gets a neutral unavailable marker without a link. No historical owner-profile snapshot is stored.

## 4. One operation, explicit entry coverage

Proposed command: `POST /v1/bookmark/fork` with `{source_user_bookmark_uuid}`, returning the normal envelope with `{bookmark_uid, disposition: "created" | "already_saved"}`. Use explicit HTTP/envelope error statuses and stable names for source-unavailable/not-ready, destination-in-progress/failed/deleting, and transient storage/commit uncertainty.

A shared classifier accepts configured exact origins and `/b/<UUID>` paths before normal own-origin URL blocking. Harmless query/fragment/trailing slash variants are allowed. Lookalike hosts, userinfo and arbitrary redirect discovery are not. Existing `/s/` behavior stays intact.

- Web button and Reader URL input call the online command before any local optimistic insert.
- Extension `/add` and REST `/add_url` dispatch into the same service while retaining old response shapes; Reader-shell HTML is ignored.
- Telegram needs both its preflight URL check and direct domain caller adapted; successful Fork sends its normal completion callback without a crawl.
- Import needs classification before its blocked-URL early return, bounded copy concurrency and truthful per-item outcomes. Preserve importing-user metadata, not source-user tags/state.
- Extension saved-state/sidebar lookup needs a Reader URL adapter because the destination stores the original resource URL.

Use a completed-Fork result rather than pretending Fork is a shortcut. No completed copy enters the capture workflow.

## 5. PowerSync: selected online-first boundary

The user confirmed: Fork requires connectivity. PowerSync still delivers the successfully committed bookmark to devices. This avoids optimistic Fork UUID reconciliation when the server discovers an already-saved original resource.

Older clients can still upload queued Reader URLs. The compatibility path records a visible terminal failed save, without copied body/provenance or crawl/rescue, and acknowledges the persisted result so unrelated edits do not remain stuck. It is not reported as successful Fork.

Two devices can submit different local UUIDs for the same source. Give these failed placeholders deterministic per-client target identities using the source Reader URL plus `#slax-failed-save=<clientUUID>`; this preserves navigation while avoiding the existing per-user URL uniqueness collision. Preserve each placeholder's dependent edits and guard replay/ownership. Do not silently alias it to a successful Fork behind queued notes.

This narrowly avoids the current mismatch where Web retries failed batches and Mobile can permanently acknowledge isolated 400 failures. Full offline Fork needs a separate durable reconciliation contract.

## 6. Independent storage and lifecycle

Stage complete bundles under attempt-unique permanent keys, then publish their pointers and provenance in a short insert-only DB transaction. R2 transfers stay outside that transaction. Recheck source identity, permission and revision at publication. Require both a destination raw row and relation before duplicate reuse: a raw row without its relation may be awaiting asynchronous deletion and must never be adopted.

For new HTML/media writes, immutable bundles and expected-revision pointer updates prevent mixed HTML/text and late-writer replacement. Stored `content_key` is authoritative; a stale conventional UUID object cannot override it. Legacy HTML sources use one validated HTML capture with text derived locally from those same bytes, rather than copying an independently mutable old text object.

Treat confirmed rollback, confirmed commit and unknown commit separately. A COMMIT timeout can occur after success: reconcile exact destination pointers via a fresh database read and retain objects while uncertain. Post-commit indexing/notification failures cannot delete live content. Immediate deletion targets only confirmed failed attempts or managed bundles retired by confirmed replacement/deletion.

The owner accepted exceptional residual R2 files on 2026-10-23. Remove automatic orphan reclamation, the unmerged cleanup table and cleanup-only indexes. Do not replace them with new state fields, JSON queues, R2 scans or another service. Attempt immediate deletion after confirmed replacement and permanent bookmark/account deletion; failure does not undo the completed operation and creates no retry record. Worker termination, ambiguous commits or failed deletion can leave files indefinitely.

Keep the five-minute bounded media settlement/index-repair pass as snapshot maintenance. Existing recycle-bin, account-deletion and canonical media retention jobs keep their purpose. The only new database structure for Fork is its nullable provenance column. Legacy mutable-key cleanup retains its existing behavior.

Source deletion or share revocation does not delete destination content. Destination deletion removes only its own bundle. Existing global moderation/takedown still applies.

## 7. All-format details

| Format | Required treatment |
| --- | --- |
| Article | Private HTML/text and allowlisted article metadata; exclude personal notes, tags, aliases, collections, read/star/archive/share state and private AI output |
| Shortcut | Copy type/title/target/provenance without fabricating R2 content or traversing the linked collection |
| PDF | Copy binary, descriptor and optional extracted text; preserve document-byte identity and destination highlighting |
| YouTube | Copy body/player/cues and ready authorized supplementary article variants, including fallback content below an annotated transcript |
| Podcast | Copy body/player/show notes/cues and ready translations with paragraph timestamps |

For uploaded PDF, replace the synthetic owner prefix with `slax-pdf://<destinationUserId>/<same verified sha256>` so later identical native uploads deduplicate. Downloaded PDFs retain their external URL. Uploaded Source display remains local upload plus filename.

PDF `pdf_document_id` must be merged **after relation insertion inside the publication transaction**: the insert trigger replaces metadata. Otherwise the copy opens but highlighting fails. Accept terminal ready/empty/failed extraction states with matching objects; pending/inconsistent state reports source-not-ready. No new extraction is scheduled during Fork.

Use a destination-owned versioned media sidecar for saved content and processing state. This content JSON is not Fork provenance; the mapping remains solely in the dedicated database field. Canonical media rows remain computation caches. New ordinary captures pin owner-requested inputs/components, privately freeze their first terminal result, and require explicit owner action for another revision. Forks freeze currently ready content immediately; absent/running supplements become unavailable rather than polling forever. Missing managed artifacts do not fall back to shared live content.

The owner may independently save the original resource again. When replacement content publishes successfully, clear `forked_from_id` in the same database transaction and retain the bookmark UUID and personal state. Media reacquisition publishes a fresh ordinary capture manifest. Failures, pending/superseded attempts, metadata changes and duplicate Reader-URL Forks retain provenance. PDF saves that reuse the existing binary (including duplicate upload, title repair or extraction) also retain provenance; only publication of newly acquired bytes clears it. This approved follow-up requires no additional database migration.

Retain media policy references for moderation/takedown while excluding frozen copies from publication, reference-hash movement, translation-generation targets and legacy backfill. Mark takedown policy before reference enumeration, recheck it during publication and reads, and enforce it for cached delivery until cleanup completes; a concurrent Fork cannot escape the initial scan. Media files themselves remain externally played rather than downloaded.

## 8. Web display and cache safety

Add Fork in the existing visitor snapshot top-bar actions, usable at narrow mobile widths. Reuse login return, require an explicit click after login, disable repeated submission and navigate to the returned destination. Offline actions retain useful input and request connectivity.

Keep Source unchanged and add Fork beside it in article and PDF source components. Shared SSR caches contain no viewer-specific source identity; preserve PDF title/type-only SSR. A separate `fork_metadata` projection authorizes destination and source, applies identity visibility and returns `Cache-Control: private, no-store`. Clear client projection state on route/account changes and failure.

Verify light/dark/e-ink, desktop, 768px transition and 320px mobile, keyboard/focus/touch and reduced motion under `DESIGN.md`. Preserve Extension's own profile.

## 9. Review findings and resolution

| Review | Important finding | Design response |
| --- | --- | --- |
| Initial | Reused source UUID hijacks attribution | Server-assigned integer relation ID plus exact-resource revalidation |
| Initial | Orphan raw destination is awaiting deletion | Require relation, reject adoption, insert-only publication |
| Initial | Commit timeout cleanup deletes live content | Unknown-outcome reconciliation and ownership-aware cleanup |
| Initial | Sync failures drop or block work | Online command; terminal failed legacy placeholders |
| Initial | Viewer identity leaks through shared SSR | Neutral SSR plus uncached scoped projection |
| Initial | Import/Telegram entry gaps | Explicit adapters including preflight blocking |
| All-format | PDF identity/metadata trigger loses marking | Destination upload namespace and post-insert document-ID merge |
| All-format | Shared media generation changes private bodies | Private bundles/components and guarded revision publication |
| Formal review | Two queued UUIDs collide for one Reader URL | Deterministic per-client failed-placeholder identity |
| Formal review | Read access mistaken for owner disclosure | Reuse `show_userinfo` separately from access |
| Formal review | New copy races with takedown enumeration | Global policy barrier, publication/read checks and cache enforcement |
| Formal review | Existing media specs conflict with frozen copies | Unconditional sequential spec reconciliation before managed-media implementation |

These review resolutions are implemented in the task branch. Their automated and running-environment evidence is recorded in the change validation document; unchecked acceptance items remain explicit.

## 10. Delivery prerequisites and evidence

Formal artifacts are prepared in `openspec/changes/add-bookmark-fork`. The merged media changes were archived and synchronized in the separate `docs/archive-media-specs` dependency, reconciled with current `dev` at `1041a594`. This change includes reviewed scoped MODIFIED deltas for the settled media capabilities, preserving their original scenarios while introducing private snapshot ownership.

Use additive migration first, then compatible API writers/readers, then Web/Extension entries. Keep the column and managed-content guards during rollback; old media writers are not safe rollback targets after private bundles exist. Remote deployment remains separate.

Preparation evidence: dependencies installed; Prisma clients generated using nonsecret placeholder URLs without database access; 4 existing focused suites passed all 50 tests. The initial missing-client setup failure was resolved by generation. OpenSpec baseline passed 72 items before this change. Final artifact validation is recorded in [validation.md](../../openspec/changes/add-bookmark-fork/validation.md).

The additive migration, real local Edge/Core APIs, PostgreSQL and R2 were exercised across HTML, shortcuts, uploaded/downloaded PDFs, YouTube and podcasts. Source revocation/deletion, duplicate saves, private ownership, attribution and PDF range reads passed. Browser interaction and release checks are recorded in [validation.md](../../openspec/changes/add-bookmark-fork/validation.md). Production resources were not accessed. The user declined an Extension version bump; 1.16.3 is retained. The requesting project owner confirmed hands-on UI acceptance on 2026-10-22; remaining runtime coverage gaps are explicitly recorded for review.
