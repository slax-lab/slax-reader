# Tasks

## 1. Review

- [x] 1.1 Record proposal review and the approved highlight bound and raw-text choice.

## 2. Repository

- [x] 2.1 Replace `seachBM25` with a single ranking query and a highlight batch in `BookmarkSearchRepo`; verify `fulltextEngine.integration.test.ts` (Miniflare D1 FTS5) covers ranking order, the `EXPLAIN QUERY PLAN` access path, and a two-row fixture that reproduces the FTS5 snippet defect.

## 3. Domain

- [x] 3.1 Rewrite `SearchService.fulltextSearch` to rank once, highlight the top `N`, and propagate failures; verify `searchHighlightSecurity.test.ts` covers unchanged fusion, the no-highlight fallback beyond `N`, escaped highlights, and a failing fulltext branch leaving vector results intact.

## 4. Scope extension (2026-11-24)

- [x] 4.1 Rank every fulltext shard of each bookmark and keep the best-scoring one; verify with `searchHighlightSecurity.test.ts`.
- [x] 4.2 Serve untagged semantic retrieval from V5 with mean-centered rescoring and the 0.35 / 0.6 bounds, keeping tag-filtered searches on the legacy buckets; verify with `searchHighlightSecurity.test.ts`.
- [x] 4.3 Cache search-term embeddings in KV for `/v1/bookmark/search` and `/v1/search`; verify with `vectorEmbeddingCache.test.ts` and `hybridSearch.test.ts`.
- [x] 4.4 Remove the redundant subscription lookup from `hybridSearch` and the unused `SubscriptionRepo` dependency.
- [x] 4.5 Delete fulltext mirror rows in the import-failure batch delete and account deletion, and add `fulltext:prune-relations`; verify with `pruneFulltextRelations.test.ts` and `generatorPaths.test.ts`.
- [x] 4.6 In the test environment compare untagged and tagged `/v1/bookmark/search` against the deployed build (hits, order, timings) and record them in `validation.md`.
- [x] 4.8 Hands-on acceptance of the search view in the local Web against the test API (excerpts beyond rank 50, V5 hits, tags, escaping); show the PostgreSQL title and description for semantic-only hits without fulltext rows; record in `validation.md`.
- [ ] 4.7 Run the pruning command against the production and test mirrors and record counts; applying the DELETE file is the operator's action.

## 5. Verification

- [x] 5.1 Run `pnpm api -- test`, the layer architecture test and `pnpm api -- build`; record results.
- [x] 5.2 Exercise `/v1/bookmark/search` in the test environment for single-term, multi-term and Chinese keywords; compare hit sets and timings with the current implementation and record them in `validation.md`.
- [x] 5.3 Run the local review in `REVIEW.md` and `openspec validate --all --strict` before any pull request.
