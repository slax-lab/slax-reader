# Validation

## Automated checks (2026-11-24)

- `pnpm api -- test`: 285 files passed, 20 skipped; 4,542 tests passed, 166 skipped (existing skips), on the final revision of the combined scope.
- `pnpm api -- test test/script/layerArchitecture.test.ts`: 45 passed.
- `pnpm api -- build` (with `gen:all`): passed.
- ESLint on the three changed source files: no errors; three warnings already present before this change (unused imports in `dbBookmarkSearch.ts`, `any` in `normalizer.ts` line 39).
- `test/infra/fulltextEngine.integration.test.ts` runs the real FTS5 schema in Miniflare D1 with the production Normalizer and Jieba WASM:
  - ranking 600 candidate rows: plan `SCAN slax_fts_bookmark VIRTUAL TABLE INDEX 0:M2 | LIST SUBQUERY 1 | SCAN json_each | CREATE BLOOM FILTER | SEARCH r USING INTEGER PRIMARY KEY`, no co-routine, 2 bound parameters, 1,400 rows read;
  - the two-row fixture fails `snippet()` on the two-column NEAR OR expression, and the single-column highlight queries return title and content highlights for both rows;
  - `processSearchKeyword` returns `full = (title) OR (content)` with single-column halves, and empty expressions for punctuation-only input.

## Running environment: test (`reader-api.slax.dev`, user 14412, 1,124 fulltext rows)

The baseline ran on the deployed `origin/dev` build; `reader-ai` was then deployed from this branch (final version `ab713c5f`) with the test configuration and the same requests were repeated. Both runs used the APAC fulltext database.

| Keyword | Fulltext branch, before | Fulltext branch, after | Fulltext hits before / after | Response order identical |
|---|---|---|---|---|
| AI | 3,302 ms | 711 ms | 300 / 300 | yes (397 results) |
| 阅读 | 2,499 ms | 418 ms | 120 / 120 | yes (148 results) |
| cloudflare worker | 362 ms | 283 ms | 19 / 19 | yes (127 results) |
| open source | 1,695 ms | 310 ms | 102 / 102 | yes (244 results) |

- No error logs in either run for these requests.
- Highlights are identical for the 50 best fulltext ranks of every keyword (all 19 for "cloudflare worker"). Differences start at fulltext rank 50, as designed; those rows show the first characters of the text, for example the first differing "AI" row appears at overall position 91 of 397.
## Review and validation

- Local `REVIEW.md` review (Bugs, Security, Compliance) before push: one finding fixed in `3bfab510` (bookmark shard handling, later removed as unreachable in `a8f6675c`).
- `openspec validate --all --strict`: 173 passed, 0 failed.

## Combined scope: test environment (`reader-api.slax.dev`, user 14412, 2026-11-24)

`reader-core` (`696bafc6`) and `reader-ai` (`e744b393`) were published to the test account from this branch's working tree, with `dev.toml` from slax-reader-config#17 (fulltext on the APAC database `be8e7fe6`). The baseline is the deployed `origin/dev` build on the old fulltext database. Times are the second of two requests.

| Keyword | Before | After | Results before → after | Semantic hits before → after |
|---|---|---|---|---|
| AI | 5.67 s | 3.32 s | 171 → 311 | 137 → 70 |
| 阅读 | 5.17 s | 4.11 s | 119 → 128 | 43 → 13 |
| cloudflare worker | 3.41 s | 3.52 s | 127 → 26 | 120 → 17 |
| open source | 6.85 s | 4.72 s | 244 → 121 | 143 → 23 |
| xqzv lorem 9981 (nonsense) | 2.95 s | 1.95 s | 143 → 0 | 143 → 0 |

- Fulltext: one ranking query over 1,128 shard rows, 0.27–0.77 s, no error logs. The baseline returned 41 fulltext hits for "AI" against 300 now, because baseline groups were dropped.
- Semantic (V5): best centered scores 0.486 (AI), 0.530 (阅读), 0.752 (cloudflare worker), 0.615 (open source), 0.321 (nonsense, so nothing kept). The branch took 1.0–2.1 s: measured from Singapore, embedding 0.25–0.45 s, native query 0.24 s, and reading 100 candidate vectors 0.4–1.1 s in five parallel `getByIds` batches. Reducing the candidate count or fetching values with the query is a follow-up.
- During the window in which a dev release had moved the test Workers back to the old fulltext database, one bookmark (1043940) was written there; its raw row and relation were copied to the APAC database before the comparison.

## Hands-on acceptance: local Web (2026-11-24)

The Web app from this branch ran locally (`pnpm web -- dev`, `http://localhost:3000`) against the test API (`reader-api.slax.dev`, `reader-core` `696bafc6`, `reader-ai` `e744b393`), signed in as user 14412. Only searches and reads were performed.

- "AI" in the Web search view: 311 results. The 50 best fulltext ranks show keyword-centred excerpts with `<mark>`; later rows show the opening text of the article as the excerpt, rendered as plain text with no layout change.
- "阅读" 128, "open source" 121, "cloudflare worker" 26 results; "xqzv lorem 9981" returns none. End to end 1.4–2.5 s from the browser.
- `<img src=x onerror=alert(1)>` as the keyword: every title and excerpt arrives escaped; the only element in any highlight is `<mark>`.
- Tag filters, with tag UUIDs read from the Web's PowerSync copy of `sr_user_tag`: "AI" with `software` returned 26 results and "AI" with `software` and `dev` 9; every result carries every requested tag. "startup" with `yc` returned 3. An unknown tag UUID returns no result.
- Finding, fixed in this change: 1–10 cards per keyword had an empty title and excerpt and showed only the "Semantic related" score (10 of 311 for "AI"). These were semantic hits on bookmarks that PostgreSQL holds as current, successful articles but that have no rows in the fulltext database, so `getBookmarkRaw` returned nothing for them. The legacy buckets never produced such hits because their candidates came from the fulltext mirror. Semantic-only hits without fulltext rows now show the PostgreSQL alias title or title and the description, cut to 50 characters and escaped like other semantic text; the data comes from the final admission query, so no query is added. Covered by `searchHighlightSecurity.test.ts`; the deployed test build predates the fix, so the fixed cards were not seen in a running environment.

## Not verified

- Production traffic: the change has not been deployed to beta or production.
- The fallback title and description for semantic-only hits in a running environment (unit test only; see above).
- Mobile rendering; Mobile uses the same `/v1/bookmark/search` response shape.
- `fulltext:prune-relations` has not been run against either mirror; applying its output is the operator's action.
