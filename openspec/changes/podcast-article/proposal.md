# Proposal

## Why

A saved podcast episode is saved today as an ordinary web page: show notes and, at best, a player. Readers cannot read what was said, highlight it, or jump to a moment. A clean transcript with speakers and times makes an episode readable like an article.

This work was built and reviewed in the legacy repositories (`unnoo/slax_reader_backend#874`, `unnoo/slax_reader_frontend#1623`). This change ports it into the monorepo. It depends on `youtube-ai-article`, which it extends from YouTube articles to media articles.

## What Changes

- Recognise podcast episode links from Xiaoyuzhou, Apple Podcasts, direct audio links, RSS feeds (the newest episode) and Spotify (embed only, no transcript), for accounts with the new Labs feature `podcast`. Other accounts, and links that are not an episode, save as normal pages.
- Get the transcript from the publisher first (VTT, SRT, Podcasting 2.0 JSON, or timed plain text). Without one, transcribe the audio URL with AssemblyAI. The Worker never downloads audio.
- Write a clean article in the original language, with no summary and nothing added. Every paragraph keeps its start time. The article becomes the bookmark body.
- Translate paragraph by paragraph for readers whose AI language differs, mapped back to the original paragraphs.
- Share one transcript and one article per episode between all its bookmarks. A later save of the same episode gets the body at once and costs nothing.
- Limit cost: $1 per episode, 5 new episodes per user per day, $30 per day site-wide, and 3 hours per episode.
- Run the work in a new `PodcastWorkflow`. Add `GET /v1/podcast/status` and `/translation` (owner and share visitors, by the snapshot access rule), `POST /v1/podcast/retry` (owner only), and a 5-minute sweep.
- Generalise the YouTube article repository to a media article repository with a `media_kind` column. The database tables keep their names, and the migration adds the new column, key and table.
- Drop the P0 unique key `(video_id, source_hash, prompt_version)` that `youtube-ai-article` kept (its contract step), so a caption version can hold several language rows again. This change must reach beta only after `youtube-ai-article` runs in production.
- Show a sticky audio player, transcript status, "listen from here" on paragraphs and selections, and the translation on the bookmark page.
- Add the `PODCAST_WORKFLOW` binding to `deploy/cloudflare/api.toml.example` and the `ASSEMBLYAI_API_KEY` secret to the Worker environment type.

## Capabilities

### New Capabilities

- `podcast-article`: podcast episode capture, transcription, article body, translation, cost limits, access and playback.

### Modified Capabilities

None. The media-article generalisation keeps every `youtube-ai-article` requirement.

## Impact

- API: `apps/api` crawl route, podcast domain and runner, AssemblyAI client, bounded public fetch, media article repository, Prisma schema and the migration `20261015000000_media_article`.
- Web: `apps/web` bookmark page, podcast player custom element, podcast processor, selection menu, status and translation components, en/zh copy.
- Contracts: `packages/contracts` API paths and response types.
- Deployment: set `ASSEMBLYAI_API_KEY` for core and edge, add the `PODCAST_WORKFLOW` binding to the private Wrangler configuration, and run the migration.
- Behaviour for users does not change until an account enables `podcast` in Settings.

## Non-goals

- Do not download or store audio.
- Do not support transcript languages other than Chinese and English, or episodes longer than 3 hours.
- Do not transcribe Spotify episodes.
- Do not port the legacy Chinese project documents.
