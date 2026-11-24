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
- A ranking or highlight failure fails the fulltext branch instead of returning a silently partial result. The vector branch, fusion and final admission are unchanged.

## Capabilities

### Modified Capabilities

- `owned-bookmark-search-filtering`: the fulltext branch ranks every matching owned row in one query and highlights a bounded top set, without dropping rows to database overload or the FTS5 snippet defect.

## Impact

- API only: `apps/api/src/domain/search.ts` (`fulltextSearch`), `apps/api/src/infra/repository/dbBookmarkSearch.ts` (`seachBM25` replaced by a ranking query and a highlight batch), and their tests.
- No schema, migration, endpoint, request or response-field change. The unified `/v1/search` path (`HybridSearchService.fulltext`, `searchCandidatePage`) is out of scope.
- Rows beyond the highlight bound show the first 60 characters instead of a keyword-centred excerpt.

## Decisions

The change requester approved this proposal on 2026-11-24 with these choices:

- Highlight bound: 50 fulltext rows.
- Raw text for highlighted rows: full `raw_content`, so `mapHighlight` output is identical to today for those rows. Transfer is bounded by the 50-row cap (about 0.4 MB on average; 1.48 MB is the largest single row observed). A fixed-size window was rejected because it changed the chosen excerpt for 9–43% of hits in the measured sample.
- Vector branch: moving `/v1/bookmark/search` to the v5 article index is deferred. On 2026-11-24 the v5 index held 309 of 347 sampled owned articles across nine users but only 665 of user 1's 4,557, so switching now would drop most semantic hits for large libraries. The legacy shard queries already run concurrently; no vector change is made here.
