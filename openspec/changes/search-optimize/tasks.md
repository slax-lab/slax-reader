# Tasks

## 1. Retrieval and bounds

- [x] 1.1 Correct fulltext grouping to `ceil(rows / 50)` and order the row list by newest raw id.
- [x] 1.2 Add `seachBM25Batch` using `DB_FULLTEXT.batch()` in 10-statement groups; keep the rowid-scoped SQL and 50-row bindings unchanged.
- [x] 1.3 Collect at most 300 fulltext candidates (pruned at 500) and publish at most 100 RRF results.
- [x] 1.4 Apply the 600-group / 30,000-row guardrail with `search_scope_truncated` logging.

## 2. Highlighting

- [x] 2.1 Replace `mapHighlight` with the O(n+k) difference-array implementation preserving the 60-character output.
- [x] 2.2 Highlight only the published results.

## 3. Ownership

- [x] 3.1 Remove the inert subscription lookup and `search:valid_bm_ids`; validate the final 300 candidates with `deleted_at IS NULL`.

## 4. Resilience and writes

- [x] 4.1 Add 800 ms embedding, 500 ms vector, and 500 ms segmentation timeouts with fulltext fallback.
- [x] 4.2 Split `createBookmarkRaw` into 16-row inserts inside a transactional D1 batch.

## 5. Maintenance

- [x] 5.1 Add the daily 03:17 UTC FTS `optimize` cron and the public configuration schedule.
- [x] 5.2 Regenerate cron/DI artifacts with `pnpm api -- gen:all`.

## 6. Verification

- [x] 6.1 Update existing search tests and add coverage for grouping, top-K bounds, timeouts, and raw-write chunking.
- [x] 6.2 Run API typecheck, search tests, full relevant test suite, lint, and `openspec validate --all --strict`.
- [x] 6.3 Exercise the search endpoint locally against workerd D1 with a synthetic library and record timings/bounds in `validation.md`.
- [x] 6.4 Run the `REVIEW.md` Bugs/Security/Compliance passes and resolve Important findings before pushing.
