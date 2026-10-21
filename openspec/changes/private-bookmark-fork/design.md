# Design

## Context

Normal capture paths already pass the authenticated user ID as `private_user`, while `BookmarkRepo.createBookmark` uses `(target_url, private_user)` as its unique upsert key. Crawl workflows currently write fixed `html/body/<user-bookmark-uuid>.html` and text keys and the Web content loader prefers those fixed paths. The change must preserve the existing `/b/<uuid>` access policy, PowerSync/search side effects, historical `private_user = 0` rows, and the repository's generated router/DI workflow.

## Goals / Non-Goals

**Goals:**

- Add a dedicated private snapshot-copy service and API.
- Make same-user same-URL writes newest-data-wins across direct capture and Fork.
- Preserve destination UUIDs on overwrite and protect reads from mixed versions.
- Copy supported stored content and record current lineage/privacy decisions.
- Provide strict `/b` URL routing and Web/mobile-friendly Fork entry.

**Non-Goals:**

- Migrating or deleting historical public rows.
- Copying marks, comments, tags, summaries, or share settings.
- Preserving separate direct and Fork rows for one user and URL.
- Automatically updating a destination when its source changes.
- Supporting body-less shortcut Forks in the first implementation.

## Decisions

### Dedicated service and contract

Add a `BookmarkForkService` (code-level name may use `snapshotCopy` where existing repository terminology makes `fork` ambiguous) behind `POST /v1/bookmark/fork`. The service owns source access, target lookup, content copy, lineage, and publication. The controller and `/add_url` compatibility path delegate to it rather than duplicating logic.

The response includes `bookmark_uid`, encoded bookmark ID, `write_mode` (`created` or `overwritten`), and current `fork_info`. Transport retries use an idempotency key scoped to user and operation; distinct user actions are new writes so a changed source can be forked again.

### Target overwrite and publication

Use the existing full stored target URL and positive user ID as the target identity. For an overwrite, retain `sr_user_bookmark.uuid`; do not rely on the existing upsert to publish content because it can update metadata without safely coordinating R2. Stage new objects under revisioned keys (or a temporary key), then update `content_key`, `content_md_key`, article metadata, status, and current lineage in a short transaction. Readers use committed content keys; obsolete fixed-key fallback behavior is removed or constrained so it cannot return stale content after publication.

Each write gets a monotonic version for the target. Publication uses a conditional version check so an older workflow cannot commit after a newer accepted write. A failed or superseded write never replaces the last successful version. Direct capture clears current lineage; Fork replaces it with the new source snapshot.

### Storage and PDF

Copy R2 objects through streaming bodies where possible and preserve relevant HTTP/custom metadata. Derive PDF sidecars from the source `content_key`; require body and metadata completeness and a usable text state for v1. Do not copy image proxy objects unless a later audit finds a destination-specific dependency.

Web PDF descriptor URLs bind range requests to an immutable content key. Native clients address the API by bookmark UUID and already check a strong SHA-256 ETag against their descriptor's `document_id`. Both PDF delivery endpoints return the selected object's valid SHA-256 as ETag, without an additional storage read, so existing native clients reject mixed revisions after an overwrite. Missing legacy hashes omit ETag and retain the Web revision check.

### Lineage and side effects

Use a dedicated `sr_bookmark_fork` table with current/superseded status, source/target IDs and URL, display-name snapshot/visibility, operation version, timestamps, and cleanup/error fields. Keep current lineage unique per destination target; optionally retain superseded rows for audit. Do not store lineage in PowerSync-maintained metadata.

After publication, refresh search/full-text/vector records, search caches, PowerSync change logs/notifications, and relevant analytics through existing services or retryable post-commit work. These external side effects are not treated as one database transaction.

AI-derived writes carry the committed content revision that produced them. Legacy batch callbacks without a revision are discarded conservatively, while newer batch tasks persist the revision in their result metadata so a late response cannot overwrite a newer capture.

### Reader URL parser

Implement one strict parser at the service/orchestrator boundary, before `processTargetUrl`, short-link resolution, `URLPolicie`, or crawl creation. It accepts the configured canonical Reader origins and exact `/b/<uuid>` paths; alternate hosts, credentials, ports, encoded traversal, and unsupported query parameters are rejected. `/add_url`, CLI/Telegram, import, and any shared URL-save path use the same parser.

### Web integration

Extend content metadata with `can_fork` and `fork_info`. Add the action through the existing `SnapshotTopBar` right slot, reuse Web semantic tokens and accessibility states, and keep Source pointing to the original URL while Fork points to the source snapshot. Owner pages hide the action.

## Risks / Trade-offs

- **R2/DB failure window** → stage versioned objects, publish pointers conditionally, retain the last successful version, and sweep orphaned objects.
- **Concurrent direct/Fork writes** → serialize target versions or use conditional version updates; test late completion and retry cases.
- **Existing loader fallback** → update loader/cache semantics before enabling versioned keys.
- **Search/vector side effects are not atomic** → mark publication first, enqueue/retry post-commit indexing, and make stale-index cleanup observable.
- **Lineage deletion semantics** → use nullable source references/soft deletion and preserve auditable destination attribution.
- **Backward compatibility of `/add_url`** → prefer the dedicated endpoint, with a narrow compatibility delegate and explicit behavior for import/CLI/Telegram.

## Migration Plan

1. Add nullable/expand-only schema fields and lineage table; deploy code that can read old rows.
2. Add service, contracts, strict URL parser, and tests while keeping existing capture behavior compatible.
3. Switch direct and Fork publication to version-aware writes and update content loading/cache behavior.
4. Enable Web action behind the existing authenticated routing and verify mobile/desktop states.
5. Run cleanup/index repair for failed copies and orphaned revisions; no migration of `private_user = 0` rows.

Rollback keeps existing rows readable: disable the new endpoint/UI and stop new versioned writes, while retaining old content keys and nullable lineage records for later cleanup.

## Open Questions

- Whether to retain superseded lineage rows indefinitely or prune them after an audit retention period.
- Whether Fork should be enabled for PDF in the first production rollout if extraction latency is too high; the contract requires complete supported PDF objects when enabled.

## Follow-up lifecycle and query review

Stored URL identity preserves all query parameters and fragments after URL serialization. Fetch-only URL preparation is separate and idempotent; Fork copies the source's stored URL unchanged.

Publication locks the bookmark before its operation/stage records, then retires previous published objects in the same transaction as the pointer switch. Legacy private pointers are enrolled before replacement or deletion. A separate `cleanup_after` timestamp prevents search heartbeats from delaying collection. Retired revisions receive a one-hour grace period, and unresolved older search attempts remain repairable through their existing settling window. Current objects are excluded from collection.

The existing five-minute Fork job claims at most 100 stage sets using indexed batches and `FOR UPDATE SKIP LOCKED`. Failed object deletion remains retryable; successful tombstones are rechecked for 24 hours from the first successful cleanup, then removed after another successful deletion. Account cleanup processes at most 100 private targets per transaction and only deletes target-owned lineage/operation/receipt records. Other users' copies and source attribution remain independent.

Index choices follow real predicates: target/version lineage, target operation cleanup, owner/id batches, import progress and version completion, per-bookmark stage status, scheduled cleanup, and a partial pending-search index. Primary-key version checks do not need additional version-only indexes. Search repair reads an ordered bounded candidate window before deduplication. Relation metadata publication uses set-based JSONB updates to preserve unrelated metadata without fetching and updating every relation.
