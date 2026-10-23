# Design

## Current implementation contract — 2026-10-23

This approved simplification supersedes the historical design below wherever they conflict.

- Keep conventional HTML/text/PDF keys and UUID filenames. Store private media supplements inside an inert data block in the same saved HTML, and PDF extraction metadata in its existing descriptor. No snapshots/forks/attempt directories or database content-version fields.
- Each accepted repeated Fork refreshes the existing personal destination. Preserve the relation ID/UUID and all personal references. Convert a historical shared relation on explicit capture without editing another user's raw row or files.
- Ordinary acquisition remains fetch/parse -> required R2 writes -> database content/success. Admission uses a short conditional database transition from terminal state to pending; busy requests do not mutate input/time. Workflows claim pending/pending_retry -> parseing once in a durable step, carrying the existing accepted-request timestamp. Keep in-step retries; rescue no longer changes pending to failed before scheduling and does not take over parseing.
- Native PDF upload and legacy media publication use the same write claim; the old third-party queue drains into the guarded Workflow. Cached public-row short circuits release their claim. A single SQL UPDATE keeps admission atomic, and terminal timestamps advance monotonically.
- Direct online Fork and private media final publication acquire the same existing-state exclusion at their write boundaries. Initial Fork still copies to its dedicated UUID before inserting; uniqueness chooses one winner. Never overwrite that winner after losing an initial race. Fixed-key update failures retain live keys and may leave partially written files; no automatic rollback or timeout stealing is promised.
- Fixed-key publication does not delete a retired bundle. Missing reads fail explicitly. Successful changes invalidate summaries/search state; the index marker includes existing updated_at and media readers use their saved revision token rather than only a constant key. SSR continues reading the authorized R2 object directly.
- The frontends reuse loading/pending guards and synced content status; API acknowledgement is not processing completion. Fork is online and its response represents completed copy. Browser timeout cannot release a server claim. UI request locks release after a response/error; synced active status prevents known reentry and backend admission covers delayed/unavailable sync. No indefinite local reservations or automatic retries are added.
- Repair the reviewed old-sync replay, legacy podcast publication failure isolation, per-reference media isolation, historical shared deduplication, missing-body and frozen-language fallback issues within the same change.
- No new app version bump, cleanup mechanism, cross-storage recovery framework or broad unrelated refactor.

## Historical design (superseded where noted above)


## Context

See [proposal.md](proposal.md) for motivation and [the feasibility review](../../../docs/api/bookmark-fork-feasibility.md) for source evidence. Planning baseline is `7089a16ef1fdacb91e89bbf3465b47ff10a5598a` on `origin/dev`.

Current extension, URL, import and sync creation sets `private_user` to the caller. PostgreSQL uniqueness is `(target_url, private_user)`. `/b/<uuid>` identifies `sr_user_bookmark`, not `sr_bookmark`. R2 content ownership and snapshot sharing are separate. The remaining isolation problem is media derivation: `YoutubeArticleService.publishBodies`, `PodcastService.publishBodies` and owner status catch-up can replace multiple private bodies from shared canonical rows.

Web URL creation normally writes an optimistic local row. The selected first release instead sends Reader URLs directly to the online Fork command; successful rows arrive through ordinary PowerSync. Full offline Fork submission is excluded by the user's 2026-10-22 decision.

## Goals / Non-Goals

**Goals:** one authoritative relational provenance field; bounded, independently owned content bundles; a single Fork domain operation; reuse existing access policy, renderers, sync delivery and computation caches.

**Non-Goals:** a universal version-history store, source-profile snapshots, a provenance graph, a generic job framework or external queue, provider regeneration during Fork, migration of historical public/unmanaged media content, or copying private notes/AI state. External video/audio/image availability remains as it is today.

## Decisions

### 1. Stable provenance with one additive column

Add `forked_from_id Int?` to `sr_user_bookmark` in `apps/api/prisma/pgsql.prisma`. It is a soft reference to the source user-relation integer primary key. Do not add a foreign key, reverse index, timestamp, mapping table or JSON provenance mirror. A nullable column is compatible with deployed code and needs no backfill.

The client submits only a source UUID. Resolve it with existing snapshot access and persist the server-resolved integer ID. UUID-only provenance was rejected because sync accepts caller-chosen UUIDs and deleted UUIDs can be reused. FK cascade would delete independent copies; SET NULL would erase the Fork marker.

For attribution, look up the exact source integer ID, reauthorize its current UUID, assert the returned integer ID is unchanged, and verify original-resource identity. Metadata, sync updates and saves reusing existing content preserve the field and cannot supply or clear it. Successful independent owner acquisition clears it in the same database transaction that publishes the new content pointer; preserve the destination UUID and personal state. Failed, pending or superseded acquisition leaves provenance intact. Missing/rebound sources render an unavailable marker; do not recover by searching another row with the old UUID or URL. Fork-of-Fork points to the immediate source, without recursive content reads.

Resource identity is the normalized external target URL except for uploaded PDFs. Uploaded PDFs use `slax-pdf://<destinationUserId>/<sha256>` so later identical native uploads deduplicate. Validate source/destination stored PDF SHA-256, relation document ID and synthetic URL hash; a caller-controlled URL alone is insufficient. Downloaded PDFs retain the external URL. Uploaded Source UI retains its existing local-upload label and filename.

### 2. One command and narrow adapters

Introduce `BookmarkForkService`, a focused `BookmarkForkRepo`, and a shared exact-origin Reader URL classifier. Reuse narrow access, search, deletion and notification helpers; do not call `createBookmarkBase` for publication because it upserts and emits effects before copying finishes.

Recognize configured frontend/share origins and exact `/b/<valid UUID>` paths, with optional trailing slash, query and fragment. Reject userinfo, lookalike hosts and malformed IDs. Do not follow external redirects to discover Reader URLs. Classify before normal own-origin blocking and before accepting supplied HTML. Preserve `/s/<code>` behavior.

| Entry | Adapter |
| --- | --- |
| Web public Fork button and add-URL dialog | Same online command; no optimistic local Fork row |
| `/v1/bookmark/add` and `/add_url` | Classify before URL policy; ignore supplied Reader-shell HTML; preserve old response shapes |
| Extension saved-state bridge | Resolve saved destination identity for a Reader tab; do not match only external `target_url` |
| Telegram | Classify both before `TelegramBotService.replyText` blocking and in the domain entry; send completed-copy callback without a workflow |
| Import | Classify before `addUrlBookmarkItem` blocking; await copy with bounded concurrency, preserve importing user's requested metadata, report real per-item failures |
| Older queued Reader sync creates | Persist terminal failed placeholders as described below, with no Fork or crawl claim |

Use a discriminated completed result for Fork. Do not pretend it is a shortcut merely to suppress crawling. Normal external URL saves retain their capture path.

### 3. API contract

Reuse `packages/contracts`, existing authentication and the `{code,message,data}` envelope. Add typed request/result/error names there; no separate competing OpenAPI or Postman workspace is required for this change.

`POST /v1/bookmark/fork`, authenticated active user:

```json
{"source_user_bookmark_uuid":"<source UUID>"}
```

Success uses HTTP/envelope 200 with data:

```json
{"bookmark_uid":"<destination UUID>","disposition":"created"}
```

`already_saved` includes successful existing or restored copies. Source permission is always checked, but a valid existing destination needs no source R2 read. A completed result guarantees committed, readable required artifacts; search/notifications may converge through existing post-commit mechanisms.

| Outcome | HTTP and envelope code | Client action |
| --- | --- | --- |
| Invalid UUID/body/origin | 400 | Correct input |
| Authentication required | 401 | Login, then explicit retry |
| Source missing/inaccessible | 404 | Show unavailable, no identity disclosure |
| Acquisition feature disabled | Existing Labs contract | Show existing gate feedback |
| `fork_source_not_ready`, `fork_destination_in_progress`, `fork_destination_deleting` | 409 | Retain input, offer explicit retry; no endless automatic loop |
| `fork_destination_failed` | 409 | Open existing failed item for retry/removal; never overwrite it |
| Storage unavailable, unresolved commit outcome | 503 | Retain input, retry same source later |

The dedicated endpoint sets real HTTP error status explicitly. Existing `createResponse` does not automatically propagate most `MultiLangError` status values to HTTP; do not globally change all endpoints. Old add adapters keep their established envelope but preserve meaningful Fork error names instead of collapsing them into `ErrorParam`.

Add `GET /v1/bookmark/fork_metadata?bookmark_uid=<UUID>` with optional viewer authentication. Authorize destination first; return `{has_fork, can_fork, fork}`. `fork` is null or a typed available/unavailable projection containing only permitted display name and source public UUID. Read permission alone does not authorize owner identity: apply the existing `show_userinfo` rule from `ContentOrchestrator` (viewer is source owner, no explicit share exists, or the share permits user information). A readable source with hidden identity gets a generic label and its permitted snapshot link, without name/avatar/profile. Never return numeric relation IDs. `can_fork` is presentation guidance, not authorization. All responses, including errors, use `Cache-Control: private, no-store`; Web proxy handling must preserve this.

### 4. Duplicate and lifecycle rules

The destination identity is one resource per user, using the existing unique constraint. Check both the private raw row and its current-owner relation. Return successful copies unchanged; restore a trashed successful relation through existing trash semantics. Pending/parsing, failed, and deletion-in-progress are distinct outcomes. Readiness checks precede restoration.

A raw row without a relation is not adoptable. Permanent deletion currently removes the relation before asynchronously deleting raw content; reattaching that row could let the old job delete a new copy. Use insert-only Fork publication and reread on uniqueness conflict. Repeated clicks and lost-response retries resolve to the winner without replacing body or provenance. Own-snapshot Fork is an unchanged successful existing copy, not a self-reference.

Copy only article data: title, description, byline, site, publication time, cover/icon references, moderation state, format and required content. Initialize destination user state normally. Do not copy source alias, tags, marks, collection membership, share settings, read/archive/star state, summaries, outlines or chats. Import-requested destination tags/date/archive values remain caller-owned inputs, not copied state.

### 5. Coherent storage publication and recovery

Use attempt-unique permanent keys. Write all required objects before publishing their pointers in one short PostgreSQL transaction. Do not perform R2 network transfers inside the transaction. The destination relation, provenance, raw ready state, media policy ref and content pointers become visible together.

Add a small artifact-bundle helper with conditional source reads, metadata allowlists, revision validation, copy streaming and ownership-aware cleanup. `content_key` becomes authoritative in Web/API reads; the conventional UUID key is only a legacy fallback when no stored key exists. Otherwise an old conventional body could mask a new private revision.

For new HTML captures and media writes, store immutable HTML/text bundles and publish pointers with compare-and-set against the expected prior key/capture state. This closes the current text-before-HTML mixed-revision window. Source content keys/revision, identity, state, relevant media versions and access must remain valid through publication; use a final transactional DB recheck of source relation/access state before destination commit. Changes trigger bounded retry, never a mixed successful copy. State the access decision's linearization point at that final check; later source revocation affects future forks/attribution, not already copied content.

For historical HTML sources lacking coordinated immutable keys, capture one HTML object conditionally, derive the destination search/AI text from those exact bytes using existing local extraction utilities, and verify source key/ETag and DB identity/state before publication. Do not pair it with an independently changing historical text object, refetch the URL, or rerun provider parsing. Ready supplemental media artifacts require their own conditional version/key/ETag validation.

Distinguish confirmed commit, confirmed rollback and unknown commit outcome. On lost COMMIT acknowledgement, query destination identity and exact keys using a fresh authoritative read. Keep objects while uncertain. Delete only this attempt's proven-unreferenced artifacts after a confirmed failure or unique-conflict loser. Search/notification failure after commit never rolls back storage.

The user accepted exceptional orphan objects on 2026-10-23. Do not register attempts, queue retired bundles, scan R2 or add cleanup tables/state fields. Remove the unmerged cleanup-ledger migration and its cleanup-only pointer indexes; the additive provenance migration remains.

After confirmed publication, attempt immediate deletion of the previous managed bundle. Permanent bookmark and account deletion also attempt immediate deletion of their current managed bundles after deleting database records. Delete only deterministic members owned by that operation; legacy shared content retains its existing lifecycle. R2 deletion failure is logged and does not undo a successful publication or database deletion. Unknown commit outcomes retain both potentially live bundles. Worker termination, ambiguous writes/commits and failed R2 deletion can leave files indefinitely; no eventual reclamation is promised.

Retain the existing five-minute bounded media settlement/index-repair pass under snapshot maintenance. It advances pending media results and repairs search entries, without listing or garbage-collecting R2. Existing recycle-bin, deleted-account and canonical YouTube/podcast retention jobs remain unchanged in purpose.

### 6. Format adapters

| Format | Snapshot contract and storage |
| --- | --- |
| Ordinary article | Independent HTML and text; allowlisted article fields; no personal summaries/marks |
| URL shortcut | Independent private type-1 record with saved title/target and provenance; no invented body, re-fetch or traversal into the linked collection |
| PDF | Independent binary under `pdf/body/forks/<uuid>/<attempt>.pdf`, derived `pdf/meta/...json`, optional `text/pdf/...txt`, stored filename/hash/source metadata and type 2 |
| YouTube | Private body/player/cues plus ready authorized article variants, including fallback article below an annotated transcript |
| Podcast | Private body/player/show notes/cues plus ready article/translation variants and paragraph-time mapping |

PDF accepts terminal extraction states `ready`, `empty` and `failed`. `ready` requires matching text object and published text key; `empty`/`failed` retains preview without analyzable text. Pending/missing/inconsistent extraction state returns source-not-ready. Validate binary/sidecar/text and source DB revision before and after copying. Do not schedule extraction for the copy. Set `metadata.pdf_document_id` by a post-insert merge UPDATE inside publication: the current insert trigger replaces relation metadata, so setting it only in INSERT loses highlight identity.

For media, copy the currently readable base even if supplemental generation is pending. Freeze pending/failed/nonexistent supplementary components as unavailable; do not create perpetual spinners or generation subscriptions. Already embedded body content remains copied even if a canonical supplementary row is gone. Fork-of-Fork copies its frozen artifacts. External playback URLs remain external.

New acquisition honors the destination's existing feature gates after resolving the underlying format. Feature enablement does not grant source access. Saved-content reads remain available under existing snapshot and moderation policy even if feature acquisition is later disabled.

### 7. Private media state without further schema changes

Use a versioned destination-owned media sidecar derived from the managed `content_key`. It contains content payloads, media identity, requested components and their content revision/status, not Fork provenance or source-owner identity. This content JSON does not replace the relational mapping chosen by the user.

For new ordinary media captures, initialize a private base bundle and pin the source input fingerprint/hash and the processing requested by this owner's save. Canonical generation can fill only that capture's pending requested components. Copy its first ready/failed/skipped terminal result privately. A different user's later save, language preference, retry or source refresh cannot replace completed body, translation or status. If canonical episode inputs changed while a request was pending, do not consume a result for the wrong fingerprint; mark that component unavailable with owner retry rather than silently moving to the new source.

An explicit owner retry/refresh for an ordinary capture opens a new private revision. Late completion uses expected-revision CAS and cannot overwrite a newer owner revision. Forks are frozen and have no media generate/retry action. Do not automatically refresh a Fork on status reads. An independent original-URL or inline acquisition publishes a fresh capture manifest and clears provenance atomically, converting only that owner's copy to an ordinary capture. Settlement and policy publications preserve provenance. PDF acquisition clears provenance only when newly acquired bytes are published; reuse of an existing binary (including duplicate upload, title repair or extraction) preserves it. This follow-up changes no PDF byte identity, highlight anchors, schema or client contract.

Status/content/translation reads of managed snapshots use their private sidecars and destination-specific version tokens. Missing managed artifacts fail safely; do not fall back to canonical live content. Copy only variants authorized/readable at capture, not private AI work. Source-absent translations stay absent on a Fork. Existing unmanaged historical media follows its old path until separately migrated or explicitly recaptured by its owner.

Retain `sr_media_article_ref` for source identity, moderation/takedown discovery and retention, but distinguish policy references from active processing subscribers. Normal publishers, podcast `setRefsHash`, translation target selection and legacy backfill must not mutate frozen snapshots. YouTube takedown must remove derived text from both private body and sidecar; podcast moderation must still flag and disable sharing for affected private copies. Content independence is not exemption from existing moderation. V1 can retain canonical cached objects while policy refs exist; private reads must still work without them.

Takedown must establish its media-wide policy barrier before enumerating references, retaining artifact pointers until cleanup finishes. Recheck that existing policy state in managed publication and in body/supplement reads; a Fork committed after enumeration must still be denied derived-content delivery. Include media identity policy in cached-presentation admission, purge affected cached pages and keep denial active until cleanup succeeds. Never rely only on a one-time reference scan or on deleting canonical objects. Serialize the final publication/policy decision through existing database rows so concurrent snapshot creation cannot evade the barrier. This reorders the current takedown path, which marks rows only after body restoration.

This is the necessary extension beyond a small Fork endpoint: user ownership of rows already exists, but user ownership of media derivation does not.

### 8. Older queued sync requests

Current Web retries every failed batch, while Mobile can acknowledge isolated 400 failures. Do not run R2 Fork transfers through this ambiguous contract.

Recognized Reader-URL `create_bookmark` operations from old clients are accepted as terminal failed saves with the submitted client UUID, using the existing failure state and an explanatory title/description. Give each placeholder a deterministic target identity: normalized source Reader URL with its fragment replaced by `#slax-failed-save=<clientUUID>`. The fragment retains navigation to the same Reader page but distinguishes two devices' queued saves under the existing unique constraints. Do not normalize it away in this compatibility branch. The stored URL never becomes the resource identity of a successful Fork.

These placeholders contain no copied content or provenance, never enqueue a crawl/rescue, and remain removable/editable through old clients. The batch acknowledgement means the failure state was persisted, not that a Fork succeeded. Preserve dependent tags/notes on each placeholder and unrelated operations. Replay must not rebind another existing UUID or turn a failed placeholder pending; use a guarded compatibility branch instead of the generic upsert. Reject unauthorized UUID collisions through the existing authorization path; the mixed-batch preservation promise applies to valid queued creates, not malicious ownership conflicts. Reader-URL retries instruct the user to use online Fork; do not transform a placeholder into an external-URL copy behind queued dependencies.

No new sync columns or raw provenance are projected in v1. Normal offline external-URL capture and final-row synchronization remain unchanged. Full offline Fork and durable UUID alias reconciliation remain a future change.

### 9. Web presentation and cache boundary

Add a compact text/icon Fork action to the existing `SnapshotTopBar` action area on visitor `/b` pages. Anonymous use opens the existing login modal and returns to the source; require an explicit click after login. Disable duplicate submission, retain input after failure, and navigate to the returned destination on either success disposition. Offline use reports that a connection is needed without creating a local row.

Keep original Source unchanged and add Fork attribution in the common article source area and `PdfDocumentSource`. A missing/revoked source retains a neutral unavailable label and no link. Use existing Web semantic tokens, locale dictionaries and focus/touch patterns, including 320px mobile, the 768px transition, desktop, light/dark/e-ink and reduced motion. Extension keeps its own profile.

Shared SSR HTML is cached by destination UUID and owner/visitor. Cache at most a viewer-independent neutral Fork marker for HTML; preserve PDF title/type-only SSR. Never embed source name/link or viewer-dependent `can_fork` in shared HTML. Fetch the separate no-store metadata after hydration and clear it on route/account changes and failures. A source owner viewing someone else's fork must not seed privileged identity into an anonymous cache. Offline attribution can remain neutral; private cached identity must not bleed between accounts.

### 10. Existing specs and implementation order

The current media delta specs describe shared publication to every bookmark and owner status catch-up. That behavior conflicts with the requested isolation for newly managed snapshots. The explicit new policy is: shared computation can satisfy an owner's still-pending request, but completed private snapshots freeze; legacy unmanaged rows retain old behavior. PDF requirements remain intact, including Labs, immutable bytes, highlight identity and title/type-only SSR.

Keep this planning pass's delta ownership in `bookmark-fork` and `private-bookmark-snapshots`; do not edit or create parallel deltas for `youtube-ai-article`, `podcast-article` or `pdf-bookmarks`. **Before managed-media implementation, reconcile the conflicting requirements unconditionally:** sequence after the current media changes settle and are archived through their separate repository workflow, then amend this proposal with scoped MODIFIED deltas for the resulting living media capabilities. Those deltas must preserve shared computation, legacy behavior, access, cost controls and takedown while narrowing new-snapshot fan-out and status catch-up. Revalidate and obtain review of that reconciliation before applying it. New capability names alone do not resolve contradictory contracts. This is an explicit implementation prerequisite, not permission to edit another active task's artifacts. The proposal review must include this media-publication refinement.

## Risks / Trade-offs

- [All-format scope is broader than a Fork button] → Isolate artifact-bundle and media-snapshot helpers; preserve provider integrations and canonical generation rather than replacing them.
- [One column does not enforce a foreign key] → Authorize on write, use immutable numeric identity and explicit unavailable-source display; no application ID recycling.
- [R2 and PostgreSQL cannot commit together] → Immutable staging, pointer publication, authoritative reconciliation and best-effort deletion after confirmed outcomes; exceptional orphan objects are accepted.
- [Shared-cache identity disclosure] → Neutral SSR only, no-store live projection and account-scoped client state.
- [Copied media outlives source] → Keep policy refs for global moderation/takedown; ordinary deletion/share revocation affects attribution only.
- [Historical data remains shared] → Promise new managed captures/Forks only; no automatic migration or reassignment of historical public rows.
- [Copied content consumes more R2 space] → Stream required objects, use bounded import concurrency, attempt immediate lifecycle deletion, accept exceptional residual files and retain canonical GC.
- [Rollbacks to old writers could mutate media copies] → Disable new acquisition first and retain managed-key guards/readers; an old binary that ignores these guards is not a safe rollback target once managed captures exist.

## Migration Plan

1. Review this proposal, format contract and media refinement. Reconfirm the settled source baseline and relevant active-change sequencing.
2. Generate the additive provenance migration with `pnpm api -- gen:diff`, inspect it for additive compatibility, apply only to a disposable/local database with `pnpm api -- migration:local`, then regenerate with `pnpm api -- gen:all`.
3. Implement storage/read compatibility and provenance persistence before enabling new creation. Run focused tests, type/lint/build checks and real local HTTP/R2/database exercises.
4. Deploy the additive migration before server selection/writes; deployment itself follows separate authorization. Release API support before Web/Extension entry points. Successful copies use existing sync delivery.
5. On application rollback, retain the provenance column and managed-snapshot compatibility guards; disable creation without deleting copies or provenance. Do not roll readers/writers back to a version that treats managed media as live canonical content.
6. Before PR, record runtime evidence, human UI acceptance, package-version decision for affected shipped apps and all three review passes in `validation.md`. Archive only after merge under repository policy.

## Implementation reconciliation — 2026-10-22

Media PR #219 is merged. The separate `docs/archive-media-specs` dependency, reconciled with current `dev` at `1041a594`, has synchronized and archived its three changes without marking their historical acceptance gaps complete. Scoped MODIFIED media deltas express the approved private-snapshot policy and passed reconciliation review. New managed capture initialization precedes first success publication; settlement covers terminal failures/skips and podcast translation completion as well as ready-body fan-out. The later upstream podcast-fetch and generation-budget fixes remain intact after integration.
