# Validation

## Automated checks (2026-11-24)

- `pnpm api -- test`: 280 files passed, 20 skipped; 4,520 tests passed, 166 skipped (existing skips).
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
## Known pre-existing limitation

`getUserBookmarkItem` keeps one fulltext row id per bookmark (the last shard listed), so other shards of a long article are not searched. This change preserves that behavior.

## Review and validation

- Local `REVIEW.md` review (Bugs, Security, Compliance) before push: one finding fixed in `3bfab510` (bookmark shard handling, later removed as unreachable in `a8f6675c`).
- `openspec validate --all --strict`: 169 passed, 0 failed.

## Not verified

- Production traffic: the change has not been deployed to beta or production.
- Web and Mobile rendering of rows beyond the highlight bound was not inspected; the response shape and escaping are unchanged and covered by `searchHighlightSecurity.test.ts`.
