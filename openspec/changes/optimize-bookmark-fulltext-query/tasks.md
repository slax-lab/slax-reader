# Tasks

## 1. Review

- [x] 1.1 Record proposal review and the approved highlight bound and raw-text choice.

## 2. Repository

- [x] 2.1 Replace `seachBM25` with a single ranking query and a highlight batch in `BookmarkSearchRepo`; verify `fulltextEngine.integration.test.ts` (Miniflare D1 FTS5) covers ranking order, score equality with the current expression, `EXPLAIN QUERY PLAN` access path, and a two-row fixture that reproduces the FTS5 snippet defect.

## 3. Domain

- [x] 3.1 Rewrite `SearchService.fulltextSearch` to rank once, highlight the top `N`, and propagate failures; verify `hybridSearch.test.ts` and `searchHighlightSecurity.test.ts` cover unchanged fusion, the no-highlight fallback beyond `N`, escaped highlights, and a failing fulltext branch leaving vector results intact.

## 4. Verification

- [x] 4.1 Run `pnpm api -- test`, the layer architecture test and `pnpm api -- build`; record results.
- [x] 4.2 Exercise `/v1/bookmark/search` in the test environment for single-term, multi-term and Chinese keywords; compare hit sets and timings with the current implementation and record them in `validation.md`.
- [x] 4.3 Run the local review in `REVIEW.md` and `openspec validate --all --strict` before any pull request.
