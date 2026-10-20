# Design

## Context

- RSS data lives in PostgreSQL: `sr_rss_feed` (shared per normalized URL), `sr_rss_subscription` (per user, with `remark`) and `sr_rss_entry` (shared per feed, HTML in R2 via `content_key`). The REST list joins these per user to compute `source_title` and `bookmark_user_uuid` (`apps/api/src/infra/repository/dbRss.ts`).
- Web (`apps/web/app/composables/useRss.ts`) and native (`apps/mobile/src/rss/controller.ts`) hold REST pages in memory with a 60-second TTL.
- PowerSync already serves bookmarks, tags and collections through Sync Streams (`deploy/local/powersync-local/sync_rules.yaml`, edition 3). `bookmark_comment` is an on-demand stream that the native app subscribes to with `syncStream(...).subscribe({ttl})`. Collection streams are gated by `connection.parameter('schema_version') = '2'`.
- Native database opening validates the exact set of `ps_data__*` storage tables before the SDK applies the schema (`apps/mobile/src/data/adoption.ts`, `installation.ts`), and Kotlin-to-RN adoption compares against the same list.

## Goals / Non-Goals

**Goals:**
- RSS subscriptions and latest entries open from local data on Web and native, also offline.
- No change for existing clients, existing streams, the upload path or `schema_version`.

**Non-Goals:**
- Local writes for RSS (no new upload handlers); offline add/save queues.
- Offline article HTML or history pages.
- Read/unread state.
- A count-based synced window (the window is bounded by the existing 30-day retention and 200 entries per fetch).

## Decisions

### 1. Version by stream name, not by connection parameter

A new `rss_v1` stream with `auto_subscribe: false`. Clients that support local RSS subscribe to it while the laboratory is enabled; older clients never subscribe, so they receive nothing. This is PowerSync's documented primary approach for multiple client versions. Alternatives: bumping `schema_version` to `3` (forces rewriting the five collection predicates and coordinated rollout; `IN (...)` on a connection parameter is rejected by the service and takes down the whole Sync Config), or a separate connection flag (still needs reconnects and duplicates the gate).

### 2. Authorization lives in the stream queries

Two CTEs join `sr_user` (`uuid = auth.user_id()`, not deleted) with `sr_user_lab_feature` (`rss`, enabled). Subscriptions are filtered by `user_id IN rss_user_ids` so their bucket is per user; filtering them by `feed_id` would publish every subscriber's `remark` to every other subscriber of the feed (reproduced on a local PowerSync 1.26.1 probe). Feeds and entries are filtered by `feed_id IN rss_feed_ids` and share a per-feed bucket. The probe also confirmed that disabling the laboratory removes the buckets in the next checkpoint without reconnecting.

### 3. Synced columns

- Subscription: `id, feed_id, remark, created_at`.
- Feed: `id, feed_url, title, site_url, icon_url, last_checked_at, last_success_at, next_fetch_at, next_allowed_at, error, lease_until AS refreshing_until`. `feed_url` is only visible to users subscribed to that exact URL.
- Entry: `id, feed_id, title, author, summary, article_url, image_url, published_at, first_seen_at, sort_at, content_truncated`, where `is_history = false`.
- Not synced: `etag`, `last_modified`, `lease_token`, `failure_count`, `history_*`, `entry_key`, `content_key`, `updated_at`.

### 4. Two new columns

- `sr_rss_feed.icon_url`: the signed favicon proxy URL, computed in `RssService` (the only layer with `env`) after successful adds and refreshes, including `304`. REST keeps computing it on the fly as before so existing clients are unaffected; local clients fall back to the existing text avatar while it is null.
- `sr_rss_entry.is_history`: `true` for rows first inserted by history paging, reset to `false` whenever the latest page contains the item. Existing rows default to `false`.

### 5. No-op entry upserts

`ON CONFLICT ... DO UPDATE ... WHERE` compares every written column with `IS DISTINCT FROM`, so unchanged items produce no row change and no PowerSync operation. Content keys are already reused for identical HTML, and image proxy URLs are deterministic. This guard is required, not an optimization: on PowerSync 1.26.1 an `UPDATE` that rewrites identical values, or changes only an unsynced column, still emits a `PUT` to every subscriber of the bucket.

### 6. Clients keep REST for writes and detail

Add, rename, remove, refresh and save keep their endpoints. Clients overlay the confirmed REST result on the local rows until synchronization delivers the same state (e.g. a just-added subscription, a just-removed one, a refresh that is now in progress, a just-saved entry). Saved state is computed from the local `sr_user_bookmark` rows by `article_url`, plus the overlay. This avoids any upload-queue handling for RSS.

Check the current local state when an overlay is created, because synchronization may precede the REST response. An already-confirmed save must not leave an overlay that hides a subsequent bookmark deletion. Rename overlays retain the synchronized remark observed before dispatch and yield when a different remark arrives, including a later write from another device that skips the intermediate confirmed remark. Native saved-URL joins cast the computed URL to TEXT so SQLite can index the materialized aggregate rather than scanning it for each entry. Native list decoration builds lookup maps once per update; Web maps only the selected source's visible local window plus a look-ahead row until history is merged.

### 7. Pagination after local data

The REST cursor is opaque and bound to the user, so a client cannot build one from local rows. `GET /v1/rss/entries` accepts `before=<entry id>`; the server reads that entry under the same ownership checks and uses its `(sort_at, id)` as the cursor (including `fetch_history=1`). Because history rows are never synced, a history row of one feed can be newer than the oldest local row of another feed in the All view; the first `before` page therefore also returns `is_history` rows newer than the anchor. List items carry `sort_at`, and clients merge local rows and REST pages by `sort_at DESC, id DESC`, deduped by id. A history load can place rows above the current cursor, so, like the REST mode, each Load more requests history and then re-reads the expanded window from the fixed anchor (the oldest local row at the first Load more), following `next_cursor` for one page more than before. If the anchor has been pruned, the client re-anchors on its current oldest local row.

### 8. Web fallback and lifecycle

`useRss` uses local mode only when `$powersync` is available and the database belongs to the signed-in account; otherwise it keeps the current REST implementation unchanged. The laboratory gate is the confirmed Labs response; before Labs has loaded (for example offline), existing local RSS subscription rows provisionally enable RSS, and a later confirmed disabled response clears it while a failed Labs request does not. Existing local rows render immediately; an empty local database keeps showing the REST result until the stream's first sync, so there is no empty flash. The list reveals local rows in pages of 50 before requesting REST with `before`. The subscription is made with a multi-day TTL so local data survives reloads. The native controller follows the same rules (`hasCachedData()` for cold starts).

On native, an admitted cache starts its local watchers immediately, independently of the stream's first-sync promise. Labs validation then runs in the background so a slow or unavailable network cannot hold cached source selection behind a busy state. Confirmed disablement clears the feature; a transport failure preserves the cache. The background request has its own cancellation owner and rejects stale results after account, local-runtime, or foreground-operation replacement.

Web authentication consumers share a checked cookie boundary: runtime cookie names must be non-empty strings, cookie reads request raw values and only expose non-empty strings, and required token writes fail explicitly when the cookie name is invalid. Domains and notification public keys are narrowed before calling their string APIs. This completes application typechecking while keeping normal string-token authentication and local account-ownership checks intact.

### 9. Native schema validation

The native app splits the storage-table set in two: the legacy set (used for Kotlin adoption, which never has RSS tables) and the current set. Opening an initialized database accepts either the legacy set or the current set, because validation runs before the SDK creates the new views. `DATABASE_SCHEMA_VERSION`, adoption evidence and `SYNC_PARAMETERS` stay unchanged.

Schema admission also distinguishes the installation's creation mode. The current React Native SDK creates format-14 databases with SQLite `user_version=0`; Kotlin adoption requires `user_version=1`. Native-created installations accept `0` or the previously accepted `1`, including subsequent cold starts, while adopted installations continue to require `1`. Both modes retain the exact supported storage-table sets, canonical path and owner checks, and format-14 requirement. Admission does not rewrite SQLite version markers, recreate the database or discard queued data.

### 10. Native RSS header spacing

The source-action toolbar belongs only to a selected subscription. The All view has no source-specific actions and must not reserve the toolbar's 48-point height. Render that toolbar only while RSS is enabled and a subscription is selected; preserve its existing controls, hit areas, row padding, source strip, typography and runtime safe-area handling.

## Risks / Trade-offs

- [Volume for heavy feeds: up to 20 feeds × 30 days of latest-page entries] → bounded by existing retention; a count-based window can be added later without changing the stream name.
- [Every `sr_rss_feed` update (lease claim, refresh result) emits a feed `PUT` to all subscribers, even for unsynced columns] → a few small rows per feed per 30 minutes; acceptable for this window, and could be split into a narrower synced table later.
- [Stale `is_history` for rows created before the migration] → they default to `false` and age out within the 30-day retention.
- [TTL and cold-start resubscription behavior in each SDK is not fully documented] → verified per platform during implementation; REST fallback stays in place.
- [Production Sync Config and publication are outside this repository] → rollout checklist item; the stream is inert until clients subscribe.
- [Client overlays diverge from synced data] → reconcile overlays immediately when REST confirms a write and again on local changes; retire acknowledged state so subsequent synchronized renames, removals and bookmark deletions remain visible.

## Migration Plan

1. Deploy the migration and API (new columns, `before`, no-op upserts). Existing clients are unaffected.
2. Deploy Sync Config with `rss_v1` and confirm the publication includes `sr_rss_*`.
3. Release Web, then native.
4. Rollback: clients stop subscribing (REST still works); removing `rss_v1` from Sync Config drops the buckets; the two columns can stay.
