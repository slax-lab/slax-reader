# Tasks

## 1. Bounded generation

- [x] 1.1 Raise `YOUTUBE_ARTICLE_LIMITS.maxCostUsd` from $0.30 to $1.00 so a plan inside the 6-hour/40-chunk limits fits; add the skip log with chunk count, duration, input size, expected cost and cap.
- [x] 1.2 Send `thinkingConfig: { thinkingBudget: 2048 }` on every YouTube and podcast article model call.
- [x] 1.3 Add a runner test for a long-but-supported caption and tests asserting the thinking budget on both runners.

## 2. Numeric fidelity

- [x] 2.1 List the chunk's numeric tokens in `buildUserMessage` and forbid words/Chinese numerals in the system rule.
- [x] 2.2 Add a utility test for the required-number line.

## 3. Podcast capture

- [x] 3.1 Add `CrawlService.fetchPodcastPage` using `SlaxFetch.zyte(url, true)` (Zyte browser mode) first for Xiaoyuzhou episode pages.
- [x] 3.2 Keep `parseXiaoyuzhouPage` as the only parser and pass its `audioUrl` to the existing podcast workflow and AssemblyAI.
- [x] 3.3 Treat a Zyte target 4xx as terminal (save as a page); on a Zyte API-level failure or target 5xx fall back to ScrapingBot browser mode, then a direct public fetch. Cover the chain in `15-podcastSave.test.ts`.
- [x] 3.4 Add the `20261022140000_seed_podcast_lab_users` migration and a migration test; preserve an explicit `enabled = false` row.
- [x] 3.5 Log the podcast Labs-off fallback in `CrawlWorkflow`.

## 4. Verification

- [x] 4.1 `pnpm api -- test` passes.
- [x] 4.2 `pnpm api -- typecheck` passes.
- [x] 4.3 `pnpm api -- lint` reports 0 errors.
- [x] 4.4 Apply the new migration to a temporary Postgres 17 database with podcast, explicit-off and normal-article rows.
- [x] 4.5 Record the test-environment evidence and remaining gaps in `validation.md`.
