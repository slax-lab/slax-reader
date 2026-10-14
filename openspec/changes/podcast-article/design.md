# Design

## Context

`youtube-ai-article` adds versioned, shared AI articles for YouTube videos. Podcasts need the same building blocks (a shared source, versioned articles, references from bookmarks, a lease-based workflow, cost limits, a sweep) plus audio transcription and a body that replaces the saved page.

## Decisions

### Capture

The podcast branch runs in `CrawlWorkflow` after the PDF probe and the inline-content branch, only for `regular` routes whose URL `classifyPodcastUrl` recognises, and only when the owner has the `podcast` Labs feature. `podcast` is not a gated save route: without it, the link saves as before. All outbound fetches go through `fetchPublicText`, which screens every redirect hop and caps body size. Errors that will repeat (blocked address, too large, 4xx, unreadable answer) fall back to a normal page; transient errors throw, so the crawl step retries.

### Transcript

Publisher transcripts come first. Without one, AssemblyAI transcribes the audio URL; the workflow polls it with `step.sleep`. A provider job id is stored before polling, so a retried step never bills twice. `asr_cost_job_id` records the job whose cost was counted, so a retry that polls the same finished job does not count it again. If AssemblyAI refuses speaker labels for a language, the client asks again without them. Speech density and moderation decide whether the episode continues.

### Article and body

One article per episode in the original language, built from the transcript with the same faithful-cleanup rules as the YouTube article (no summary, no new facts). Paragraphs keep their start times. The rendered article becomes the body of every bookmark of the episode, and the word count follows it. Translations are separate `sr_media_article` rows per target language and map one-to-one to the original paragraphs.

### Media articles in the database

The legacy migration renamed `sr_youtube_article(_ref)` to `sr_media_article(_ref)` and `video_id` to `source_id`. In the monorepo, beta runs migrations against the production database before production code updates, so a rename would break the code that production runs in that window. The port keeps the table and column names and maps them in Prisma (`@@map("sr_youtube_article")`, `source_id @map("video_id")`). The migration only adds `media_kind` (default `youtube`) to both tables, a new unique key that starts with `media_kind`, and the new `sr_podcast_episode` table. The language-aware key of `youtube-ai-article` stays: a YouTube video id and a podcast source id (a hash of the audio URL) never collide, so it never blocks a valid row.

The migration is also the contract step of `youtube-ai-article`: it drops the P0 key `(video_id, source_hash, prompt_version)`. Only the P0 code upserts on that key, so the drop is safe once production runs `youtube-ai-article`. Release order: promote `youtube-ai-article` to production first, then merge this change. Raw SQL uses the database names and aliases `video_id` back to `source_id`.

### Access

`PodcastService` uses `BookmarkService.getBookmarkReadAccess`, the same rule as the snapshot page and the YouTube article. Only the owner retries. Visitors see a running episode as pending and a failed one as unavailable, at the transcript stage and at the article stage, and never get a failure reason.

### Cost limits

| Limit | Value |
|---|---|
| Per episode, transcription and model calls | $1 |
| New episodes per user per day | 5 |
| Site-wide spend per UTC day | $30 |
| Episode length | 3 hours |

### Presentation

The podcast player is a custom element in the article body, kept sticky while reading. A processor adds "listen from here" to timed paragraphs, and the selection menu offers it for a selection. A status bar above the body (a new `before-body` slot, outside `.article-detail`) shows transcribing, failed and limit states, and remounts the body when the article arrives. Readers whose AI language differs can switch to the translation. Styles use `--slax-*` tokens; the Shadow DOM player uses token fallbacks like the existing YouTube player.

### Settings

The `podcast` row is visible in Settings. It does not depend on the hidden `youtube` row.

## Risks / Trade-offs

- Transcription and the article were tested only with fake providers. AssemblyAI's price ($0.17 per hour) comes from a third-party summary. Mitigation: test a Chinese Xiaoyuzhou episode, an English RSS episode with a publisher transcript and an Apple episode without one on beta with an internal account, and check the price against the contract.
- Chinese diarization support in AssemblyAI is not documented. Mitigation: the client retries without speaker labels.
- The old unique key on `sr_youtube_article` stays until a later cleanup; it costs one extra index.
