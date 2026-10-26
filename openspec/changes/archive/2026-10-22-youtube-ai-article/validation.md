# Validation

Date: 2026-10-14. Branch: `feat/youtube-ai-article`, based on `origin/dev`.

## Source

The code is the legacy implementation from `unnoo/slax_reader_backend` (`feat/youtube-article-p1`, commit `59c28fba`, base `dcc004f3`) and `unnoo/slax_reader_frontend` (`feat/youtube-article-p2`, commit `840566f9`, base `f7a1b3b6`). Each changed file was merged with `git merge-file` (legacy base, monorepo file, legacy change). Legacy `config/` and `docs/` were not ported.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm api -- typecheck` | Passed. |
| `pnpm api -- test` with `RUN_PG_INTEGRATION_TESTS=1` on an isolated Postgres 17 | All tests passed except `collectionTelemetryLogs.integration.test.ts`, which needs the separate logs database. |
| `prisma migrate deploy` on an empty Postgres 17, then `prisma migrate diff --from-config-datasource --to-schema prisma/pgsql.prisma --exit-code` | All migrations applied; no difference. |
| `pnpm api -- lint` | 0 errors. |
| `pnpm api -- build edge` and `build core` with `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example` | Offline dry runs passed; edge binds `YOUTUBE_ARTICLE_WORKFLOW`. |
| Web `vue-tsc` | 10 errors, identical to `origin/dev`. |
| `pnpm web -- test` | All passed except 2 tests in `userLocaleFallback.spec.ts`, which fail the same way on `origin/dev`. |
| ESLint on new Web files | 0 errors. |
| `openspec validate --all --strict` | Passed. |

The integration test `labRepo.integration.test.ts` already failed on `origin/dev` (it expected only `youtube`); it now expects the full Labs list.

## Review

The local `REVIEW.md` review found the one-step unique-key migration Important. The first PR review confirmed it and found a second Important issue: a save-triggered start did not count against the daily automatic limit. Both are fixed:

- The migration is expand-only and keeps the old key. `recordEvaluation` and `ensureLanguageRow` handle the old key without failing; Postgres integration tests cover both.
- `triggerAfterCrawl` takes an automatic daily slot before it starts and gives it back when nothing started; unit tests cover the count and the limit.

PR review Nits that were fixed: content requests that keep failing now show "Could not load the article" with a retry (status and content failures are counted apart); a paragraph with more than half of its cues in the previous chunk is dropped as overlap; `/v1/youtube_article/content` is `private, no-store`; a failed ref unlink during bookmark deletion is logged on its own. The Labs Nit is answered in `proposal.md`: hiding the row is a UI rule only, as for `youtube` and `pdf`. The `takeDaily` race Nit does not apply: Redis `INCR` is atomic, so concurrent callers get distinct counts.

New UI uses existing `--slax-*` tokens and no `v-html`.

## Not validated

No run with the real model, no run inside the Workers runtime, and no browser check of the bookmark page. Vertex keys and Worker secrets are not available locally.

## Follow-up 2026-10-22: per-article budget

Test-environment evidence: crawl instance `16454df9-6c20-44fb-aeee-7c38a9be8c68` triggered `yta-XVOhygutivE-c16085654bab-zh-v1-mviw0hw7`, whose `prepare` step returned `{"kind":"skip","reason":"too_long"}`. The video is 10,055 seconds (2h47m), inside the 6-hour limit, but the original $0.30 cap is below the expected ~$0.95 cost of a plan near the 40-chunk limit, so long videos were silently skipped as `too_long`. The cap is now $1.00, the same per-item cap as a podcast episode; the runner logs the expected cost when a plan is still skipped.

The same test session exposed a second failure: the short video `LPZh9BOjkQs` (7,525 input chars, one chunk) ran `chunk-0` for five minutes and then failed three attempts with `chunk_truncated` (`finishReason=MAX_TOKENS`). Thinking tokens share `maxOutputTokens`, and the runner sent no budget, so the preview model could consume the whole 16,000-token output allowance while thinking. Both media runners now send `thinkingConfig: { thinkingBudget: 2048 }`, the same bound the Chat path uses; a runner test asserts every article call carries it and a podcast runner test does the same.

A later retry (`yta-LPZh9BOjkQs-...-mvj4vnx9`, 14:02) got through `chunk-0` after two truncations, but `assemble` failed quality with `number_coverage: 5/7 = 0.714` (threshold 0.85). The caption numbers are `3, 24, 7, 2600, 10000, 100, 2017`; the likely misses are `10,000`/`100 million` rendered as Chinese numerals and the `24-7` pair. The user message now repeats the chunk's numeric tokens in a "Required numbers (write each exactly as digits, never as a word)" line, and the system rule explicitly forbids words or Chinese numerals. A utility test covers the list. The failed row stays retryable; a new attempt is needed after deploy.

| Command | Result |
| --- | --- |
| `pnpm api -- test` | 2,319 passed, 71 skipped. |
| `pnpm api -- typecheck` | Passed. |
| `pnpm api -- lint` | 0 errors (341 pre-existing warnings). |

Not validated: no new real-model run and no deployed-Worker run; neither the 2h47m video nor the short video was regenerated in this task.
