# Design

## Context

See `proposal.md` for the measurements. `SearchService.hybridSearch` (`apps/api/src/domain/search.ts`) runs the fulltext and vector branches in parallel, fuses them with RRF in `processHybridSearchList`, then admits results against current ownership. Only the fulltext branch changes.

`slax_fts_bookmark` is an external-content FTS5 table over `slax_bookmark_raw` (`content`, `title`, `porter unicode61 remove_diacritics 2`). `Normalizer.processSearchKeyword` builds `(title:NEAR(t1 t2 ..., 20)) OR (content:NEAR(t1 t2 ..., 30))`, optionally ANDed with per-term clauses for further words.

## Query plans (production, read-only)

- Today: `CO-ROUTINE filtered_ids | SEARCH r USING INTEGER PRIMARY KEY | SCAN slax_fts_bookmark VIRTUAL TABLE INDEX 0:M2 | SCAN f`. The 50-row CTE with `raw_content` is rescanned per FTS match: about 2.25 million rows read and 6.3 s for "AI" per group.
- Ranking: `SELECT r.id, r.bookmark_id, bm25(...) FROM slax_bookmark_raw r JOIN slax_fts_bookmark ON rowid = r.id WHERE MATCH ? AND r.id IN (SELECT value FROM json_each(?))` plans as `SCAN slax_fts_bookmark VIRTUAL TABLE INDEX 0:M2 | LIST SUBQUERY | SCAN json_each | CREATE BLOOM FILTER | SEARCH r USING INTEGER PRIMARY KEY`. Rows read equal the keyword's global match count plus the candidate list, independent of how many candidates the user has.
- The alternative `slax_fts_bookmark.rowid IN (json_each)` reports few rows read but iterates the inverted index per rowid and took 3–12 s; it is rejected.

## Decisions

1. Ranking statement returns `id`, `bookmark_id` and `bm25` score only, ordered by score. No text columns, so transfer and per-row cost stay small.
2. Highlight queries for the top `N` ranked row ids (`N = 50`), as three concurrent Prisma raw queries bound to the same JSON id list (the repository reaches D1 only through Prisma): content snippet with `content:NEAR(...)`, title snippet with `title:NEAR(...)`, and `raw_title`/`raw_content` by primary key. Single-column expressions are derived from the same normalized terms the ranking expression uses.
3. `fulltextSearch` merges ranking and highlight rows into the existing `fulltextMatchItem` shape. Rows without a highlight row keep empty snippets, which `mapHighlight` already turns into the first 60 characters.
4. Errors propagate from both statements. `hybridSearch` already settles the fulltext branch independently of the vector branch, so a fulltext failure leaves vector results intact.

## Risks

- The keyword expression is passed as a bound MATCH parameter, as today. Snippet expressions are built from normalizer output; quoting stays inside `Normalizer`.
- Per-term clauses beyond the first word: the single-column snippet expressions keep the same AND structure restricted to one column, so a title-only snippet is not produced for a row that matched by content.
- D1 limits: 1 bound JSON parameter per statement; candidate lists of several thousand ids stay well under the 100 KB statement and 2 MB value limits.

## Semantic branch on V5

- Candidates: `VectorMaintenanceService.queryArticles(query, { userId, limit: 100 })` with the raw V5 query vector, because the index stores raw representatives (the recommendation design makes the same choice). Measured for user 1, raw-vector candidates contained 22–28 of the 30 best centered matches, centered-query candidates only 7–22.
- Rescoring: `readArticles` returns the candidates' vectors; query and articles are centered with `center()` from `recommendationAlgorithms.ts` and compared by cosine. Ids are emitted as `<bookmarkId>_0`, so fusion and the legacy 0.4 filter path stay as they are; the 0.4 filter now applies only to the legacy branch.
- Threshold: no hit when the best centered score is below `SEMANTIC_MIN_TOP_SCORE = 0.35`; otherwise keep scores at or above `SEMANTIC_RELATIVE_FLOOR = 0.6` of the best. On nine probe queries for user 1 this kept 11–44 hits for real queries and 0–6 for nonsense, while an absolute 0.30 floor kept only 4 hits for "阅读". The values are initial and tied to `EMBEDDING_MEAN` version `ebb4b388aad2`; regenerating the mean requires recalibrating them.
- Tags: the V5 article index indexes `user_id`, `kind` and `recommendable` but not `bookmark_id`, so a tag-filtered query keeps the legacy encoder and buckets, which filter by eligible bookmark ids.
- Embedding cache: `VectorEmbeddingClient.cachedQuery` stores the query vector in `KV` under `search:embedding:<sha256(model:dimensions:text)>` for seven days and validates length and finiteness on read; read and write failures fall back to the provider.

## Fulltext relation mirror

`slax_user_bookmark` in the fulltext database mirrors PostgreSQL relations and is the fulltext candidate source. `deleteBookmark` already removed the mirror row; `batchDeleteBookmarksByIds` (import-failure cleanup), `checkAndCoverFailBookmark` (a failed or pending relation replaced by a new save of the same URL) and `UserDeletionService.deleteUserBookmarks` did not. All three now delete the mirror rows. Existing stale rows are removed by `fulltext:prune-relations`, which compares an exported mirror with PostgreSQL in a read-only transaction and writes DELETE statements; trashed relations stay because they can be restored.

## Non-Goals

- No change to `/v1/search` retrieval apart from the shared embedding cache, to normalizer tokenization, or to the FTS schema.
- No read replication or database relocation; those are separate operational work.
