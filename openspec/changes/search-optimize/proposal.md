# Proposal

## Why

Saved-article search latency grows with library size and article length. The current `dev` fulltext path groups candidates with `userBookmarkItem.map(...)`, which creates one D1 query per bookmark instead of one per 50 bookmarks; a 2,000-bookmark library issues 2,000 serialized D1 queries. Each query also carries full `raw_content`, results are never capped, and highlighting rescans the full article once per match token. External embedding and segmentation calls are not cached. The result is avoidable CPU, memory, D1 read cost, and request latency.

## What Changes

- Correct fulltext grouping to `ceil(rows / 50)` groups and batch 10 statements per D1 `batch()` request. The rowid-scoped CTE, the `MATCH` semantics, and the 50-row group size stay unchanged.
- Collect at most 300 fulltext candidates and publish at most 100 results. Highlight only the published results.
- Replace `mapHighlight`'s repeated full-text lowercase and per-window scan with an O(n+k) implementation whose rendered output is byte-for-byte identical.
- Cache final search results (300 s), query embeddings (7 days), and search-keyword segmentation (30 days) in KV. Invalidate user search caches with a generation nonce on bookmark changes and successful index completion. Keep row/shard map TTLs at 5 minutes because shared-bookmark indexing can change row ids and shard assignments without notifying other owners.
- Remove the behaviorally inert subscription lookup and the redundant `search:valid_bm_ids` cache. Validate the final 300 candidate IDs against live ownership and `deleted_at` in one Postgres query before publishing.
- Add 800 ms embedding, 500 ms vector-query, and 500 ms segmentation timeouts. A timeout degrades to fulltext-only or quoted-keyword search instead of failing the request.
- Cap a single request at 600 fulltext groups (30,000 indexed rows), ordered by newest raw row, and log `search_scope_truncated` when the cap applies.
- Split `slax_bookmark_raw` writes into 16-row inserts (96 bound parameters) inside one transactional D1 batch, so long articles cannot fail with `too many SQL variables` or lose the previous index.
- Run `INSERT INTO slax_fts_bookmark(slax_fts_bookmark) VALUES('optimize')` daily at 03:17 UTC.

## Capabilities

### New Capabilities

- `bookmark-search`: Bounded, cached, ownership-checked saved-article search that preserves the existing rowid-scoped fulltext retrieval.

### Modified Capabilities

None.

## Impact

- API search service, fulltext repository, hybrid-search utilities, Postgres bookmark repository, cron registration, and the public Cloudflare API configuration template.
- Search responses are capped at 100 results; clients that previously received every match now receive the top 100 by RRF score.
- No API contract shape change, no database schema migration, no new dependency, and no change to the rowid-scoped fulltext SQL or the 50-row group size.
- Tag-constrained search is owned by the separate `mobile-library-local-first-search` change and is not implemented here.
- Production D1/Vectorize/Jina timings are not available; the change records local workerd and synthetic Postgres evidence in `validation.md`.
