# Private Bookmark and Reader Fork Feasibility

## Scope

This document verifies the current bookmark flow and proposes an implementation for:

1. keeping every new bookmark private to the saving user;
2. forking an article from a `/b/<user-bookmark-uuid>` URL by copying its stored content;
3. exposing a Fork action on another user's `/b/<id>` page, including mobile browsers.

This is an analysis document. It does not change the API, database, or UI behavior.

## Verified current behavior

### The privacy premise is different from the current implementation

The current code already creates private bookmark rows for the normal saving paths:

| Entry | Route/code path | `sr_bookmark.private_user` |
| --- | --- | --- |
| Extension or inline HTML | `POST /v1/bookmark/add` → `BookmarkService.createInlineBookmark` | current user ID |
| Add URL | `POST /v1/bookmark/add_url` → `BookmarkService.createUrlBookmark` | current user ID |
| Batch/import URL | `BookmarkService.addUrlBookmarkItem` | current user ID |
| PowerSync create | `DBSyncBatchOperation.executeCreateBookmark` | current user ID |

`createBookmarkBase` passes the value to `BookmarkRepo.createBookmark`, whose unique key is `(target_url, private_user)`. It then creates a user relation in `sr_user_bookmark`. The relevant implementation is in:

- `apps/api/src/domain/bookmark.ts:118-193` (`createBookmarkBase`)
- `apps/api/src/domain/bookmark.ts:199-247` (`createInlineBookmark`)
- `apps/api/src/domain/bookmark.ts:267-317` (`createUrlBookmark`)
- `apps/api/src/infra/repository/dbBookmark.ts:248-325` (`getBookmark`, `createBookmark`, relation upsert)
- `apps/api/test/domain/privateBookmarkSave.test.ts`

Therefore, the requested rule that future plugin and URL saves are private is already the effective behavior. The migration work should preserve it and audit older public rows rather than change these two entry points to a new default.

There are still two important caveats:

- `private_user = 0` is the historical/shared-content convention. Existing rows with that value may still be public.
- `BookmarkService.bookmarkExists` still has a legacy public lookup branch. The current `/s/<share-code>` transfer flow relies on public/shortcut semantics, so changing it blindly could break that compatibility path. Before implementation, split the lookup by explicit shortcut/full-content intent and confirm whether any remaining server-parse callers should continue to use `private_user = 0`.

The workflow's `privateUser: 0` fields are queue message metadata used by older post-processing code. They do not change the already-created `sr_bookmark.private_user` row. `CrawlWorkflow` only short-circuits when the bookmark row it is processing is actually public (`private_user === 0`); private rows are fetched and parsed independently.

### Plugin HTML and URL content processing

The plugin sends inline content through `/v1/bookmark/add`. The service creates a pending private bookmark and passes the HTML as `inlineContent` to the crawl workflow. The workflow parses that HTML and writes the result to R2.

The URL path creates a pending private bookmark through `/v1/bookmark/add_url`, then starts the crawl workflow. The workflow fetches the URL directly or through a configured third-party provider, parses the result, writes it to R2, and updates the bookmark row.

For ordinary articles, new workflow writes normally use keys generated from the `sr_user_bookmark.uuid`:

- `html/body/<user-bookmark-uuid>.html`
- `text/body/<user-bookmark-uuid>.txt`

`CrawlService.saveParseRes` writes these objects and updates `content_key`, `content_md_key`, title, description, word count, byline, site name, published time, and status. The relevant code is `apps/api/src/domain/crawl.ts:702-719`.

The source of a fork must still be the source row's actual `content_key` and `content_md_key`. Older parser paths can contain legacy `html/parse/...` keys, so the implementation should copy from those stored keys into new destination keys rather than reconstructing a source key from the UUID.

### `/b/<id>` is a user-bookmark URL, not a public bookmark ID

The ID in `/b/<id>` is `sr_user_bookmark.uuid`. It is not `sr_bookmark.id`, `sr_bookmark.uuid`, or a share code.

The read path is:

1. Web requests `/api/content/<uuid>`.
2. `apps/web/server/utils/loadContent.ts` reads `html/body/<uuid>.html` and calls `content.internal/content/meta?uuid=<uuid>`.
3. `ContentOrchestrator.loadBookmarkMeta` loads the relation and returns metadata such as `role`, `bookmark_uuid`, `user_id`, `target_url`, `user_info`, and `content_key`.
4. `resolveBookmarkReadAccess` permits the owner directly. A visitor must pass the deletion, moderation, owner-account, and snapshot-sharing/share-policy checks.

The access implementation is in `apps/api/src/utils/bookmarkAccess.ts`; metadata serialization is in `apps/api/src/domain/orchestrator/content.ts`.

There is currently no fork endpoint, no R2 copy operation, and no Fork button on `/b/[id]`.

## Proposed design

### 1. Keep normal saves private

Do not make URL saves public. Preserve `private_user = ctx.getUserId()` for `/add`, `/add_url`, imports, PDFs, and PowerSync.

As a separate hardening change:

- update `bookmarkExists` to check the current user's private row for all full-content URL types;
- keep any public-row lookup explicitly limited to legacy/shared-content features;
- retain existing `private_user = 0` rows and audit their compatibility boundaries so new flows do not misread or overwrite historical shared data.

This directly guarantees that another user's later save cannot update the first user's private row. The unique key is already scoped by user for private rows.

### 2. Add a dedicated fork service and endpoint

Recommended endpoint:

```http
POST /v1/bookmark/fork
Authorization: Bearer <token>
Content-Type: application/json

{ "bookmark_uid": "source-user-bookmark-uuid" }
```

Recommended response:

```json
{
  "bmId": "encoded-destination-bookmark-id",
  "bookmark_uid": "destination-user-bookmark-uuid",
  "write_mode": "created",
  "fork_info": {
    "source_bookmark_uid": "source-user-bookmark-uuid",
    "source_user_id": "encoded-source-user-id",
    "source_display_name": "Reader name",
    "source_snapshot_url": "/b/source-user-bookmark-uuid"
  }
}
```

The service should:

1. require an authenticated active user;
2. resolve the source with `resolveBookmarkReadAccess`; never trust a client-supplied owner ID;
3. reject missing, pending, failed, deleted, moderated, or content-less source rows;
4. overwrite an existing private bookmark for the same normalized URL and destination user instead of returning the old content;
5. create a private `sr_bookmark` and `sr_user_bookmark.uuid` when no target exists; when one exists, preserve its `sr_user_bookmark.uuid` so its `/b/<id>` URL remains stable;
6. copy new content to fresh temporary/versioned R2 keys, then switch the destination pointers in the database; clean old objects asynchronously after the new version is readable;
7. copy article metadata, but not the source user's marks, comments, tags, summaries, or share settings;
8. create search/change-log side effects without starting a crawl workflow;
9. return the destination UUID so the web UI can navigate to the private copy.

Each completed Fork is a snapshot of the source at that time. Later source edits, source re-parses, share revocation, or source deletion must not automatically mutate the completed destination; however, a later direct save or Fork by the same user for the same URL intentionally replaces the destination under the new-data-wins rule.

### 3. R2 copy rules

R2 does not have a repository-level copy helper in this codebase. The service should read the source object and put it under the destination key, preserving relevant HTTP and custom metadata. Use compensating deletes when a later DB step fails.

When overwriting an existing bookmark, failure cleanup must delete only this operation's new objects and preserve the last published version. Versioned keys require changes to the read path as well: `apps/web/server/utils/loadContent.ts` currently prefers `html/body/<uuid>.html` and consults `content_key` only when that object is missing. Reads must instead honor the committed `content_key`, and related content caches must be refreshed, or an overwrite can still display the old body. Direct captures and Forks must share this publication and read protocol.

Copy at least:

- HTML: source row's `content_key` → a destination versioned HTML key;
- text: source row's `content_md_key` → a destination versioned text key when present;
- PDF body, when applicable: derive the source body key from the row's actual `content_key`, then copy it to a destination PDF version key;
- PDF text sidecar: derive the corresponding `text/pdf/...txt` key from the source PDF key;
- PDF state sidecar: derive the corresponding `pdf/meta/...json` key from the source PDF key.

For a PDF whose text extraction is still pending or whose required body/metadata object is missing, return a typed unavailable error. Do not report a successful fork with an incomplete document.

The HTML normally references image proxy URLs, so image objects do not need a second copy. The implementation must still verify that the proxy URLs remain valid for the destination snapshot.

The destination row must point to the new keys. Reusing source keys would make the two users share mutable storage and would violate the requested isolation.

### 4. Fork lineage data

Use a dedicated `sr_bookmark_fork` table rather than putting fork data in `sr_user_bookmark.metadata`. The metadata JSON is maintained by PowerSync-related triggers and is not a stable extension point for provenance.

Suggested fields:

```text
id
destination_target_url
destination_user_id
destination_bookmark_id
destination_user_bookmark_uuid
source_user_id
source_bookmark_id
source_user_bookmark_uuid
source_url
source_display_name_snapshot
source_display_name_visible
status              -- copying | success | failed
created_at
updated_at
```

The same user may Fork the same source more than once; each successful write updates the one current destination for that normalized URL. Store the current effective lineage and optionally retain superseded lineage rows for audit. If only one current relation is kept, enforce uniqueness by `(destination_user_id, destination_target_url)` rather than by source UUID. Keep source and destination bookmark IDs for joins and cleanup.

The source display name must respect the source sharing policy. The project already supports per-share identity visibility: the share dialog's “Show my user information” option is stored as `show_userinfo`, and `/b/<id>` uses it to decide whether to return the owner's name and avatar. This is a per-snapshot sharing setting, not a global username-hiding switch; when no share row exists, the current read path also considers the owner's `snapshot_sharing` setting and whether the viewer is the owner.

Fork should reuse the existing sharing-policy calculation instead of reading `show_userinfo` in isolation. Store an auditable source-display snapshot and the applicable visibility policy when the Fork succeeds. If sharing is later revoked, the completed private destination remains readable, the authorized source snapshot remains visible, and the source link stays at the original `/b` URL even if it no longer opens.

### 5. Same-URL overwrites, retries, and concurrency

For a Fork, look up the normalized `(target_url, private_user)` pair. The rule is that one private user has one current row for a URL, and every newer direct capture or Fork replaces the older data. If the row exists, perform the overwrite and return `write_mode: "overwritten"`; if it does not, create it and return `write_mode: "created"`. Keep the original URL as `target_url` so the Source badge continues to point to the real web source.

The same-user condition is mandatory: `private_user` must equal the authenticated user ID and be greater than zero. Other users' private rows and existing `private_user = 0` rows are never overwrite targets. Extension saves, URL saves, imports, PowerSync, and Forks must follow this rule with consistent URL normalization.

An overwrite replaces body/text/PDF sidecars, title, page description, author/site metadata, and the current lineage. Clear obsolete content fields and sidecar pointers so data from different versions cannot be mixed. Do not copy the source user's marks, comments, tags, AI summaries, or share settings. Preserve the destination user's own tags, marks, comments, and sharing choices; invalidate stale annotation locations and derived AI results when content changes. Pending, failed, or trashed destinations follow the write/restore flow. A failed update preserves the last successful content and reports failure rather than presenting old content as this operation's success.

Publish attribution with the body: a Fork overwrite changes `Fork:` to the new source; a direct capture clears current `fork_info`. Historical lineage may remain for audit but must not describe the current body. Source share revocation never triggers an automatic content update.

Direct and Fork versions do not coexist for the same user and URL; future saves continue replacing the current data without introducing a separate `slax-fork://` URL. Preserve the destination `sr_user_bookmark.uuid`, stage fresh versioned R2 objects, switch database pointers, and clean old objects asynchronously. Temporary retention for recovery does not create multiple articles in the library.

Distinguish a deliberate new save from a transport retry. A new direct capture or Fork is a new operation that fetches or copies content again. Network retries reuse that operation's idempotency key and return its existing result or status without another write. Deduplicating by source UUID alone would incorrectly prevent a later Fork from refreshing changed source content.

Assign increasing write versions per `(target_url, private_user)` in server acceptance order. Committed versions may only advance: an older task that finishes or retries late cannot overwrite a newer committed version, and failed operations cannot publish partial content. Apply version checks to ordinary crawls, Forks, and asynchronous search/notification effects. A recommended sequence is:

1. resolve and validate source;
2. identify retries by current user and idempotency key; for a new operation, reserve the target row or write version in a short database transaction without holding a lock across R2 work;
3. allocate a UUID for a new destination or retain the existing UUID, and record the copy job as `copying` without replacing the currently published lineage;
4. copy R2 objects to fresh versioned keys;
5. check the version and commit content pointers, article metadata, relation state, current lineage, and database change logs in a short transaction; on a uniqueness conflict, locate the same destination and continue this overwrite rather than returning old content;
6. update indexes, caches, and notifications outside the transaction for the committed version with retry support; return a distinct state for superseded operations rather than claiming their content became current;
7. clean only this operation's unpublished objects on failure or supersession; after success, clean unreferenced old objects asynchronously and recover abandoned objects through a cleanup/recovery job.

Use rate limiting and object-size limits because a fork is a storage-amplifying operation.

### 6. Saving a `/b/<uuid>` URL

The ordinary URL parser must not fetch `/b/<uuid>` from the network. In production, `URLPolicie` treats the frontend origin as blocked except for `/s/<code>` shortcuts, so `/add_url` currently rejects `/b` before any useful handling.

Implement a strict reader URL parser before `URLPolicie`:

- allow only the configured `FRONT_END_URL` origin;
- accept only `/b/<uuid>` with the supported UUID character set;
- reject external origins, alternate hosts, query-based authority changes, and malformed paths;
- route the request to the same fork service, ignoring any inline HTML sent by the plugin;
- do not enqueue a crawl workflow.

The cleanest API is the dedicated `/v1/bookmark/fork`. For compatibility, `/v1/bookmark/add_url` may recognize the same strict `/b/<uuid>` form and delegate to it. Batch imports should either skip `/b` links or explicitly call the fork service; they must not turn a fork into a normal parse queue message.

### 7. `/b/[id]` UI

Add the Fork action in the right side of `SnapshotTopBar`, before the share control. This is shared by desktop and mobile because the top bar is already responsive; the owner-only bottom toolbar is not a suitable visitor entry point.

Behavior:

- visitor with a valid readable source: show Fork;
- owner viewing their own page: hide Fork;
- anonymous visitor: open login and preserve the current `/b/<uuid>` URL;
- authenticated visitor: POST the source UUID, show loading, disable repeat clicks, then navigate to the returned destination `/b/<destination-uuid>` or show a clear success state;
- show an error state for unavailable, pending, disallowed, or failed copies.

Extend content metadata with optional `fork_info` and a capability such as `can_fork`. The current `SnapshotArticleSource` displays the original `target_url`, site name, and byline. Keep that Source display and add a separate Fork attribution link to the source `/b/<uuid>` when the destination is a fork. Do not use `footerVia`: `/b/[id]` currently leaves it empty and the footer has different “Shared via” semantics.

Likely Web files:

- `apps/web/app/pages/b/[id].vue`
- `apps/web/app/components/Snapshot/SnapshotTopBar.vue`
- `apps/web/app/components/Snapshot/SnapshotArticleSource.vue`
- `apps/web/app/components/Article/BookmarkArticle.vue`
- `apps/web/app/components/Article/BookmarkArticleLocalFirst.vue`
- `packages/contracts/src/augmentations.ts`
- Web locale files and the REST path enum

The new control must use existing `--slax-*` tokens, have a visible focus state, an accessible label, loading/error states, and a touch-safe target. Verify desktop, the `768px` transition, the narrowest supported mobile width, light, dark, and e-ink modes.

## Main risks and decision status

The following items are now either product decisions or selected defaults. Items marked “confirmed” should no longer be left as open questions in the OpenSpec; items marked “default” should be implemented as documented unless product discussion explicitly changes them.

| Topic | Current decision | Status |
| --- | --- | --- |
| Existing `private_user = 0` rows | Retain existing rows; do not silently migrate or delete them. Continue auditing their compatibility boundaries. | Confirmed |
| Source sharing disabled after fork | A completed Fork remains as a private destination and is not affected. | Confirmed |
| Source name hidden | Reuse the existing per-share `show_userinfo` policy. When hidden, do not show the name or avatar; show an anonymous label or at least the source snapshot link. | Confirmed rule; implementation must reuse the existing access calculation |
| Source-display snapshot | Store an auditable source-display snapshot at Fork time; after revocation, keep the destination content and completed Fork lineage unchanged, continue showing the authorized snapshot, and keep the source link pointing to the original `/b` URL even if it no longer opens. | Default |
| Same URL already saved privately | Overwrite the existing private row with the new capture/Fork data; return `write_mode: "overwritten"`. | Confirmed |
| Shortcut source (`type=shortcut`) | Reject body-less shortcuts in the first article Fork version. | Default |
| Pending/failed source | Return a typed business error; do not refetch the source automatically. | Default |
| PDF fork | Support only when body, text, and metadata sidecars are complete; derive keys from the source's actual `content_key`. | Default |
| Separate direct and fork snapshots | Do not preserve both; future saves also replace data for the same user and URL without introducing a separate Fork URL. | Confirmed |
| Retries and concurrency | A deliberate new save is a new write; transport retries are idempotent; older tasks cannot overwrite newer committed versions. | Implementation recommendation |
| Current Fork attribution | A Fork overwrite changes the source; a direct capture clears current Fork attribution. Commit it with the content. | Implementation recommendation |
| Forking one's own article | Allow readable sources; deduplicate retries of one operation and treat distinct operations as writes. Do not create self-referencing lineage when source and destination coincide. | Default |
| Fork permission | Allow only sources readable through the existing `getBookmarkReadAccess` policy; reject inaccessible, deleted, moderated, or sharing-disabled sources. | Default |
| Source or destination deletion | Keep a completed private destination after source deletion/revocation; preserve auditable lineage with explicit `SET NULL`/soft-delete rules and clean up orphaned objects asynchronously. | Default |
| Large-object copying | Use an asynchronous or resumable copy state for large HTML/PDF objects instead of binding the whole copy to one long HTTP request. | Default |

## Suggested implementation phases

### Phase 1: privacy hardening

- split `bookmarkExists` by explicit shortcut/full-content intent while preserving `/s` shortcut compatibility;
- inventory `private_user = 0` rows and confirm legacy behavior;
- add service-level tests proving `/add`, `/add_url`, import, and PowerSync remain private.

### Phase 2: backend fork

- add the fork contract and REST path;
- add `sr_bookmark_fork` migration and repository methods;
- implement source access validation, same-URL overwrites, operation idempotency, shared write-version checks, R2 copying, and failure recovery;
- align content reads, indexes, caches, and attribution with the committed version;
- add article and PDF copy tests, including concurrent/retry cases;
- add rate and object-size guards.

### Phase 3: `/b` URL compatibility

- add strict `/b/<uuid>` detection;
- delegate `/add_url` `/b` requests to the fork service;
- explicitly define batch-import behavior.

### Phase 4: Web UI

- add `fork_info` and `can_fork` metadata;
- add the top-bar control and login-preserving flow;
- add Source + Fork attribution rendering and localization;
- verify responsive, theme, accessibility, and error states.

The visible behavior change requires an OpenSpec proposal before implementation. The proposal should turn the decisions above into testable behavior, especially `show_userinfo`, same-URL new-data-wins overwrites, concurrent write ordering, PDF sidecars, R2/database recovery, and lineage deletion rules.

## Validation checklist

- plugin HTML save creates `private_user = current user` and independent R2 keys;
- URL save creates `private_user = current user` and is not reused by another user;
- a second user saving the same URL cannot update the first user's title/content/R2;
- a readable `/b` source can be forked without a network fetch;
- an unreadable, deleted, moderated, or disabled source cannot be forked;
- destination HTML/text/PDF keys are distinct from source keys;
- source re-parse, share revocation, and source deletion do not automatically mutate the destination;
- direct→Fork, Fork→direct, Fork→Fork, and direct→direct writes for the same user and URL overwrite the destination while preserving its UUID;
- Fork→Fork updates current attribution; Fork→direct clears it; body and attribution versions match;
- retries of one operation do not write again; older tasks finishing late cannot overwrite newer committed versions;
- failed R2 copies or database commits preserve the previous successful content; reads and caches do not prefer stale fixed-key bodies;
- source marks, comments, tags, overview, and share policy are not copied;
- Source remains the original URL and Fork links to the source snapshot;
- anonymous mobile users are sent through login with the original `/b` URL preserved;
- `openspec validate --all --strict` passes after the implementation change is authored.
