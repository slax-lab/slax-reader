# Validation

Date: 2026-10-14. Branch: `feat/podcast-article`, stacked on `feat/youtube-ai-article`.

## Source

The code is the legacy implementation from `unnoo/slax_reader_backend` (`feat/podcast-article`, commits `59c28fba..89514077`) and `unnoo/slax_reader_frontend` (`feat/podcast-article`, commits `840566f9..e4b880c9`), merged file by file with `git merge-file`. Legacy `config/` and `docs/` were not ported.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm api -- typecheck` | Passed. |
| `pnpm api -- test` with `RUN_PG_INTEGRATION_TESTS=1` on an isolated Postgres 17 | 2,223 passed, 41 skipped; only `collectionTelemetryLogs.integration.test.ts` failed, because it needs the separate logs database. |
| Podcast and YouTube repository integration tests | Passed, including orphan sweeps and the takedown script against the mapped table names. |
| `prisma migrate deploy` on an empty Postgres 17, then `prisma migrate diff --exit-code` | All migrations applied; no difference. |
| `pnpm api -- lint` | 0 errors. |
| `pnpm api -- build edge` with the public template | Offline dry run passed; edge binds `PODCAST_WORKFLOW`. |
| Web `vue-tsc` | Identical to `origin/dev`. |
| `pnpm web -- test` | All passed except the 2 `userLocaleFallback.spec.ts` failures that also exist on `origin/dev`. |
| ESLint on new Web files | 0 errors. |
| `openspec validate --all --strict` | Passed. |

The integration tests found one port defect, now fixed: raw SQL used the new model names, and `SELECT a.*` returned `video_id` instead of `source_id`.

## Review

Local `REVIEW.md` review: the legacy table rename was an Important migration finding. It is fixed with Prisma name mapping (see `design.md`). The migration now also carries the contract step of `youtube-ai-article` (drop of the P0 unique key); the multi-language Postgres integration tests pass after it.

PR review Nits that were fixed:

- `PodcastPlayer`: an `AbortError` from `play()` (a quick second click) no longer shows the "can't play" message.
- `podcastMedia`: Space on a focused time stamp (`role="button"`, `data-media-seek`) no longer stops the text from following.
- `addAsrCost`: a retry that polls an already counted AssemblyAI job does not add its cost again (unit and Postgres tests).
- `/v1/podcast/translation`: now `private, no-store`, like the YouTube content endpoint.
- `test/fixtures/podcast/apple-lookup.json`: trailing whitespace removed; the parsed JSON is unchanged.

The second PR review found one Important issue, now fixed: at the article stage, a share visitor still got `failed`/`skipped` and the failure reason (for example `too_long`). Visitors now get `unavailable` for a failed or skipped article and no reason for a running one; a new service test covers both. Its Nits were fixed too: the contract `DROP INDEX` uses `IF EXISTS`; the podcast bar says "Could not get the latest status" with "Check again" when polling gives up; chunk keys include the schema version, like article keys; the site-wide cost record retries once; an empty `data-media-seek` does nothing; the unreachable IPv4-mapped check in `outboundUrlProblem` is removed (the IPv6 rule already rejects every mapped literal).

Answered without a change: a deferred podcast start (busy, over budget, create failed) keeps its daily slot because the sweep starts it later, the same rule as YouTube; `fetchPublicText` keeps its own screening for the Apple lookup, feeds and other public files.

## Not validated

No real AssemblyAI or Vertex calls and no browser check. The AssemblyAI price is not confirmed against the contract.

## Follow-up 2026-10-22: seed the Labs switch

Test-environment evidence: two Xiaoyuzhou saves (`crawl-workflow` instances `655b426e-6f35-4f57-8be1-6875b3245444` and `1f012da6-e96b-48cb-b285-7d4c3acf96b6`) have no `podcast-trigger-1` step, and their `fetch` output carries empty `byline` and `siteName`, so both went through the normal-page route. The account never had `podcast` on; task 3.4's manual Settings step was the missing rollout action. Migration `20261022140000_seed_podcast_lab_users` now enables `podcast` for accounts that already saved a podcast link and preserves an explicit false row.

The SQL was applied to a temporary Postgres 17 database with one Xiaoyuzhou, Apple Podcasts, Spotify and direct-audio user, one account that had `podcast=false`, and one normal-article user. The four podcast users were enabled, the explicit false row stayed false, and the normal-article user was untouched. Unit tests: `pnpm api -- test` (2,319 passed, 71 skipped), `pnpm api -- typecheck` passed, `pnpm api -- lint` 0 errors.

The first re-save after the switch was already on still went to the normal-page route. A live `wrangler tail reader-backend` on bookmark 1043874 showed the exact cause:

```text
(warn) Podcast fetch for https://www.xiaoyuzhoufm.com/episode/6aba277de742e36efcbc2cc0 gave up (http_403); saving as a page
```

Xiaoyuzhou answers the Worker's direct `fetchPublicText` with HTTP 403. The Xiaoyuzhou episode page now goes through `fetchPodcastPage`, which calls `SlaxFetch.zyte(url, true)` (Zyte browser mode, rendered HTML) first, then ScrapingBot browser mode and a direct public fetch if Zyte is unavailable; the parser extracts the audio URL from that HTML and the existing workflow hands it to AssemblyAI. Unit tests assert the browser-mode call, the provider fallback chain, and a terminal Zyte target 4xx saving the link as a page.

Not validated: the Zyte browser-mode path has not run in the deployed Worker yet; it needs the next API deploy and one more Xiaoyuzhou save.
