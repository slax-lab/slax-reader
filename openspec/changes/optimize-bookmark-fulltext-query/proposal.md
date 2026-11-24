# Proposal

## Why

`POST /v1/bookmark/search` spends most of its time in the fulltext branch. `SearchService.fulltextSearch` splits a user's fulltext row ids into groups of 50 and runs one `seachBM25` query per group in parallel. Each query materializes the group's `raw_content` in a CTE that SQLite evaluates as a co-routine and rescans for every FTS match, so one 50-id group reads about 2.25 million rows and takes 2–6 s for a common term. A user with 619 candidates issues 13 such queries; one with 2,940 issues 59.

Measured on production with read-only queries on 2026-11-23:

- `/v1/bookmark/search` for "阅读" and "AI" took about 9 s end to end for user 1; the fulltext branch accounted for 7.2–7.5 s.
- D1 rejected most groups with `D1 DB is overloaded`. `Promise.allSettled` drops rejected groups silently, so the returned fulltext hits were incomplete.
- Independently, a MATCH of the form `(title:NEAR(...)) OR (content:NEAR(...))` combined with `snippet()` fails with `SQLITE_CORRUPT_VTAB` for some row combinations. This is an FTS5 defect, reproduced in a fresh in-memory SQLite (3.53.4 and 3.54.0) with two rows; the index is not corrupt. Every multi-term keyword produces this expression, so the affected groups are also dropped silently.
- Every group returns full `raw_content` for all of its hits (average 8.7 KB, up to 1.48 MB per row). One search moved up to 16.7 MB into the Worker, of which `mapHighlight` keeps about 60 characters per hit.

## What Changes

- Rank once: a single statement ranks all of the user's fulltext rows with `bm25` and returns only row id, bookmark id and score. Candidate ids are bound as one JSON parameter read through `json_each`, so the statement stays within D1's 100-bound-parameter and 100 KB statement limits for any candidate count. Measured for user 1 (2,940 rows): about 25,000 rows read and under 50 ms of D1 time for "AI", against an estimated 130 million rows across 59 groups today.
- Bound the highlight work: snippets and `raw_title`/`raw_content` are fetched only for the 50 best-ranked fulltext rows, with three concurrent queries. Rows beyond the bound keep their rank and score and use the existing no-highlight fallback.
- Avoid the FTS5 defect: the content snippet and the title snippet are each produced with a single-column MATCH (`content:NEAR(...)`, `title:NEAR(...)`). The ranking statement keeps the existing expression, so matching rows and scores do not change. In 4,500 randomized local cases this produced no error and the same row set as the current expression.
- A ranking or highlight failure fails the fulltext branch instead of returning a silently partial result. Fusion and final admission are unchanged.
- Search every shard: a long article is stored as several fulltext rows, but the candidate list kept only the last row per bookmark, so terms in the other shards were never searched. All rows are ranked and each bookmark keeps its best-scoring shard.
- Semantic branch on V5: without tag filters, `/v1/bookmark/search` queries the V5 article index (restricted to the user), and rescores candidates by cosine after removing the platform embedding mean `EMBEDDING_MEAN`, as recommendation does. Raw V5 cosines sit between 0.5 and 0.8 even for nonsense queries (`xqzv lorem 9981` scored 0.675 against user 1's library); after centering, real queries top at 0.41–0.66 and nonsense at 0.31–0.33. No semantic hit is kept when the best centered score is below 0.35; otherwise hits within 0.6 of the best score are kept. On 2026-11-24 the V5 index held all 666 of user 1's current articles, matching PostgreSQL. Tag-filtered searches keep the legacy encoder and buckets, because the V5 index cannot filter by tag natively.
- Cache search-term embeddings in KV for seven days, keyed by model, dimensions and the SHA-256 of the text; both `/v1/bookmark/search` and `/v1/search` use it. Cache failures fall back to the provider.
- Remove the per-request subscription lookup in `hybridSearch`: both of its branches set the same vector input, so it only added a PostgreSQL round trip.
- Keep the fulltext relation mirror consistent: the import-failure batch delete and account deletion now also delete `slax_user_bookmark` rows in the fulltext database, and `pnpm api -- fulltext:prune-relations` produces the DELETE statements for mirror rows PostgreSQL no longer has. User 1's mirror held 4,557 rows for 666 current bookmarks.

## Capabilities

### Modified Capabilities

- `owned-bookmark-search-filtering`: the fulltext branch ranks every matching owned row in one query and highlights a bounded top set, without dropping rows to database overload or the FTS5 snippet defect.
- `vector-v5-runtime`: `/v1/bookmark/search` serves untagged semantic retrieval from the V5 index with mean-centered rescoring; tag-filtered searches keep the legacy buckets.

## Impact

- API only: `SearchService` (`search.ts`), `BookmarkSearchRepo`, `VectorEmbeddingClient.cachedQuery`, `HybridSearchService.queryEmbedding`, `BookmarkService.batchDeleteFailedImportBookmarkRelations`, `UserDeletionService`, a new read-only maintenance script, generated DI and their tests.
- No schema, migration, endpoint, request or response-field change. `/v1/search` fulltext retrieval (`searchCandidatePage`) is unchanged; it only reuses the embedding cache.
- Visible effects: rows beyond the highlight bound show the first 60 characters instead of a keyword-centred excerpt; untagged semantic hits come from the V5 model, so their membership and order change.

## Decisions

The change requester approved this proposal on 2026-11-24 with these choices:

- Highlight bound: 50 fulltext rows.
- Raw text for highlighted rows: full `raw_content`, so `mapHighlight` output is identical to today for those rows. Transfer is bounded by the 50-row cap (about 0.4 MB on average; 1.48 MB is the largest single row observed). A fixed-size window was rejected because it changed the chosen excerpt for 9–43% of hits in the measured sample.
- Vector branch: move untagged semantic retrieval to V5 with the platform mean as the scoring reference, the 0.35 floor and 0.6 relative bound, and keep tag-filtered searches on the legacy buckets. An earlier note here deferred the move because the V5 coverage estimate used the fulltext relation mirror as the denominator; that mirror holds stale rows, and PostgreSQL confirmed 666 current articles, all present in V5.
- Scope: the change requester asked for search performance, the fulltext database migration follow-ups and the five-Worker split follow-ups to ship as one pull request. The split follow-ups are tracked in `split-api-worker-tiers`.
