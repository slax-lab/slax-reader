# Proposal

## Why

The dev/test environment exposed four reliability gaps in the media-article pipeline:

- A 2h47m YouTube video was inside the advertised 6-hour/40-chunk limits but was skipped as `too_long`, because the $0.30 per-article budget is below the expected cost of a plan near those limits.
- A 7.5k-character video produced `chunk_truncated` (`MAX_TOKENS`) because thinking tokens share `maxOutputTokens` and the runner sent no thinking budget.
- A successful chunk then failed `number_coverage` (5 of 7 numbers preserved), because the model rendered numbers such as `10,000` as Chinese numerals.
- Xiaoyuzhou answered the Worker's direct episode-page fetch with HTTP 403, so the podcast link silently fell back to a normal page instead of reaching AssemblyAI.

## What Changes

- Raise the YouTube per-article budget from $0.30 to $1.00, the same per-item cap as a podcast episode, and log the chunk count, duration, expected cost and cap whenever a plan is still skipped.
- Send `thinkingConfig: { thinkingBudget: 2048 }` on every YouTube and podcast article model call.
- Repeat the chunk's numeric tokens in the user message and forbid words/Chinese numerals in the system rule.
- Fetch Xiaoyuzhou episode pages through Zyte browser mode (`browserHtml: true`) first, parse the audio URL from the rendered HTML, and hand it to AssemblyAI. On an API-level Zyte failure or a target 5xx, fall back to ScrapingBot browser mode and then to a direct public fetch; a target 4xx stays terminal and saves the link as a normal page.
- Seed the `podcast` Labs feature for accounts that already saved a podcast link; an explicit `enabled = false` row is preserved. Log the Labs-off fallback for any remaining account.

## Capabilities

### New Capabilities

- `media-article-reliability`: bounded generation, numeric fidelity and stable podcast capture for YouTube and podcast AI articles.

### Modified Capabilities

None.

## Impact

- API: `apps/api/src/utils/youtubeArticle.ts`, `apps/api/src/domain/youtubeArticleRunner.ts`, `apps/api/src/domain/podcastRunner.ts`, `apps/api/src/domain/crawl.ts`, `apps/api/src/entry/edge/workflows/crawlWorkflow.ts`, `apps/api/src/infra/external/podcastFetch.ts`.
- Data: new additive migration `20261022140000_seed_podcast_lab_users`.
- Tests: runner, utility, crawl-flow and podcast-save suites; a migration test.
- Existing bookmarks keep their article/body state. A skipped YouTube row must be re-saved, and a podcast link must be saved again after the migration, to use the new paths.

## Non-goals

- No change to the YouTube or podcast quality thresholds.
- No change to the AssemblyAI or Vertex providers.
- No Apple Podcasts/Spotify page scraping: those sources use the iTunes lookup, RSS and oEmbed APIs; only the Xiaoyuzhou page is rendered by Zyte.
