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

## Non-Goals

- No change to `/v1/search` (`HybridSearchService`), vector search, embedding, normalizer tokenization, or the FTS schema. Moving this endpoint's vector branch to the v5 index waits until v5 covers existing libraries.
- No read replication or database relocation; those are separate operational work.
