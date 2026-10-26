# Validation

Date: 2026-10-22. Branch: `feat/fix-media-article`, cut from `origin/dev` at `7089a16e`.

## Test-environment evidence

All evidence comes from `wrangler workflows instances describe` and a live `wrangler tail` against the dev Worker `reader-backend` (`reader-api.slax.dev`).

### YouTube

- `yta-XVOhygutivE-c16085654bab-zh-v1-mviw0hw7` (video 10,055 s = 2h47m) returned `{"kind":"skip","reason":"too_long"}` from `prepare-1`. The video is inside the 6-hour limit; the $0.30 budget was below the ~$0.95 expected cost of a plan near the 40-chunk limit.
- `yta-LPZh9BOjkQs-bd3f56fb8a82-zh-v1-mvj44ua2` (7,525 caption chars, one chunk) failed `chunk-0` three times with `chunk_truncated` (`finishReason=MAX_TOKENS`), then `finish-retry` set the row `pending`.
- Retry `yta-LPZh9BOjkQs-...-mvj4vnx9` got through `chunk-0` after two more truncations, but `assemble-1` returned `quality_failed` with `number_coverage: 0.714` (5 of 7; threshold 0.85). Caption numbers: `3, 24, 7, 2600, 10000, 100, 2017`. The likely misses are `10,000`/`100 million` written as Chinese numerals and the `24-7` pair.

### Podcast

- `crawl-workflow` `4a6f4a98-8451-46c9-b8dd-a2d6bd0cb775` (Xiaoyuzhou `vol.152`) had no `podcast-trigger-1` step. A live tail on the next save showed the exact cause: `Podcast fetch for https://www.xiaoyuzhoufm.com/episode/6aba277de742e36efcbc2cc0 gave up (http_403); saving as a page`.
- The `sr_user_lab_feature` rows read `podcast = true`, so the Labs switch was not the cause.

## Changes and local verification

| Change | Verification |
| --- | --- |
| `YOUTUBE_ARTICLE_LIMITS.maxCostUsd` $0.30 → $1.00; skip log | Runner test: a 3,000-cue (about 22 chunks) caption now reaches `ready`; budget guards still stop a call that would cross $1.00; a temporarily lowered cap covers the `too_long` log fields |
| `thinkingConfig: { thinkingBudget: 2048 }` on YouTube and podcast model calls | Runner tests assert every call carries the budget |
| Required-number line and no-words rule | `buildUserMessage` test asserts `2600` and `10000` are listed |
| `fetchPodcastPage` starts with `SlaxFetch.zyte(url, true)` and falls back to ScrapingBot, then a direct public fetch | Test asserts `zyte` is called with `(url, true)`; fixture parses into `kind: xiaoyuzhou`; fallback chain tests cover API 429, target 403 and both providers failing |
| Zyte target 4xx is terminal; provider fallback otherwise | Podcast-save tests cover target `FetchError(403)` → reject (no ScrapingBot), Zyte API `FetchError(429)` → ScrapingBot browser mode, and both providers failing → direct public fetch |
| Podcast Labs seed migration | Applied to a temporary Postgres 17 database: Xiaoyuzhou, Apple episode (`?i=`), Spotify and `.oga` users enabled; an Apple show without `?i=` and a query-only `.mp3` left untouched; an explicit `false` preserved |
| Labs-off fallback log | Code inspection; the deployed Worker cannot log it until this branch ships |

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm api -- test` | 2,319 passed, 71 skipped (179 test files passed, 12 skipped) |
| `pnpm api -- typecheck` | Passed |
| `pnpm api -- lint` | 0 errors (341 pre-existing warnings) |
| Migration SQL against temporary Postgres 17 | Applied; xiaoyuzhou/Apple/Spotify/audio users enabled, explicit false preserved, normal article untouched |

## Review follow-up 2026-10-22

The automated review's one Important finding was that Xiaoyuzhou capture hard-depended on Zyte: a missing key or a Zyte API 4xx would retry and fail the crawl instead of degrading to a normal page. `fetchPodcastPage` now tries Zyte browser mode first, falls back to ScrapingBot browser mode on an API-level failure or target 5xx, and finally tries `fetchPublicText`. A Zyte target 4xx remains terminal and produces a normal page save. Tests cover all three paths.

## Not validated

- The branch is not deployed. The dev Worker still runs the old code, so the 403, `too_long`, `chunk_truncated` and `number_coverage` behaviors remain there until the next API deploy.
- No real Vertex or AssemblyAI call was made with the new prompt or thinking budget; the quality improvement is verified only through the prompt test and the model contract.
- Existing YouTube rows are `skipped`/`failed`; they need a re-save or a retry after deploy. The podcast migration must run before a re-save can use it.
- No browser check.
