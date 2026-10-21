# Design

## Fixed retrieval contract

The `seachBM25` CTE + `rowid` join is a deliberate rowid-scoped FTS path. It is not replaced with a `user_id` join: the latter becomes a global FTS match followed by filtering, and the fulltext `slax_user_bookmark` mirror is not authoritative (no `deleted_at`, tags, or UUID, and trash/restore does not update it). The SQL shape and the 50-ID group size stay unchanged.

Measured locally against workerd D1: 99 IDs + keyword is the 100-parameter ceiling and was 4.3x slower than 50 IDs (batch 1,214 ms vs 280 ms). The 50-row group is therefore fixed.

## Query count

The current `dev` grouping produces one query per bookmark. The corrected grouping is:

```ts
Array.from({ length: Math.ceil(items.length / 50) }, (_, i) => items.slice(i * 50, (i + 1) * 50))
```

Statements are sent in groups of 10 with `DB_FULLTEXT.batch()`. The SQL text and bindings of each statement are unchanged; only the request packaging changes. Measured warm workerd D1: 38 groups, 127 ms sequential to 57 ms with 10-statement batches.

## Bounds

- `FTS_CANDIDATE_LIMIT = 300`: candidate map pruned at 500 entries so memory stays bounded; a candidate outside the top 300 of any processed subset cannot enter the final top 300.
- `SEARCH_RESULT_LIMIT = 100`: RRF ranks are computed over the merged candidates, then only the top 100 are highlighted and returned.
- `MAX_FTS_ROWS = 30000` (600 groups at 50 rows each): leaves headroom under the 1,000-subrequest invocation limit after accounting for the vector candidate calls (about 300 at 30,000 rows) and the raw/UUID reads. Candidates are ordered by newest `slax_bookmark_raw.id`; truncation is logged.

## Highlight

The replacement preserves `TARGET_LENGTH = 60`, `MIN_WINDOW_SIZE = 60`, and the 5-character window step. It lowercases the article once, deduplicates snippet tokens, and computes the same density ranges with a difference array. Verified byte-identical output on the existing highlight suite and 3,000 randomized inputs. Measured 20 KB / 30 occurrences: 1.41 ms to 0.108 ms; 50 KB / 100 occurrences: 6.09 ms to 0.280 ms; pathological 50 KB / 32 repeated tokens: 714.7 ms to 1.05 ms.

## Caches

| Key | TTL | Invalidation |
| --- | ---: | --- |
| `search:res:v1:<userId>:<gen>:<sha256(keyword\|tags)>` | 300 s | generation nonce |
| `search:emb:v1:jina-clip-v2:1024:<sha256(text)>` | 604,800 s | natural expiry |
| `search:seg:v1:<sha256(keyword)>` | 2,592,000 s | natural expiry |
| `search:gen:<userId>` | 2,592,000 s | replaced on bookmark change / index completion |
| `search:bm_rows:<userId>` | 300 s | deleted on bookmark change / index completion |
| `search:bm_shard:<userId>` | 300 s | deleted on bookmark change / index completion |

KV requires a minimum TTL of 60 s. Writes use `ctx.execution.waitUntil` when available. Cache failures are best-effort and never fail a search. Row/shard maps stay at 5 minutes: a shared bookmark may be indexed by one owner while other owners keep the same bookmark id, so only the indexing user's cache is cleared; a longer TTL would make the other owners miss the new raw row or shard assignment.

## Ownership and eligibility

`search:valid_bm_ids` and the inert subscription lookup are removed. The row and shard maps may contain trashed bookmarks, so the final 300 candidate IDs are validated in one Postgres query (`user_id`, `deleted_at IS NULL`, `bookmark_id IN (...)`) that also returns UUIDs. The existing `getUserBookmarkUuidsByBmIds` gains `deleted_at: null` and is used for this bounded validation.

## Timeouts

- Embedding: `AbortController` at 800 ms; return cached embeddings and no new vector for the request.
- Vectorize: 500 ms per query; rejected queries are dropped and fulltext results remain.
- jieba: 500 ms; fall back to an FTS phrase query built from sanitized terms.

## Raw index writes

Each `slax_bookmark_raw` row binds 6 parameters. Inserts are split into 16-row statements (96 parameters) and sent with the preceding DELETE in one `DB_FULLTEXT.batch()`, which rolls back on failure. Measured: 16 rows succeeds, 17 rows fails with `too many SQL variables`.

## Maintenance

A `SearchJob` cron runs daily at `17 3 * * *` and executes the FTS5 `optimize` command. Local measurement: FTS data blocks 1,515,630 to 1,176,877 bytes (-22%), query median 338 ms to 317 ms (-6%). `ANALYZE` is not scheduled because it did not change the plan.

## Non-goals

- Changing the rowid-scoped fulltext SQL, the 50-row group size, or the vector `N/100` fan-out.
- Tag filtering (owned by `mobile-library-local-first-search`).
- Read replication configuration, pagination UI, or an interactive search-as-you-type experience.
