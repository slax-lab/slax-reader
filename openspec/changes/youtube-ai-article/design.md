# Design

## Context

The P0 work (already in the monorepo) normalizes YouTube captions into `youtube/canonical/captions/{videoId}/{sourceHash}.json`, links each bookmark to its caption version through `sr_youtube_article_ref`, and records a shadow eligibility result in `sr_youtube_article`. P0 does not call a model and shows nothing to readers.

This change adds the asynchronous generation backend (legacy P1) and the bookmark-page presentation (legacy P2). The code is the reviewed legacy implementation, merged file by file into the monorepo.

## Goals / Non-Goals

Goals: a faithful article in the reader's AI language, shared per video, with bounded cost, no effect on the save flow, and no change to the original body, marks, search or Chat.

Non-goals: see the proposal.

## Decisions

### Content layers

The original player HTML (`html/body/{uuid}.html`) and plain text (`text/body/{uuid}.txt`) do not change. The article is a separate, versioned artifact:

```
youtube/canonical/articles/{videoId}/{sourceHash}-{targetLanguage}-{schemaVersion}-{promptVersion}.{json,html,txt}
youtube/canonical/chunks/{videoId}/{sourceHash}-{targetLanguage}-{promptVersion}/{chunkIndex}.json
```

`sr_youtube_article` has one row per `(video_id, source_hash, target_language, prompt_version)`. A caption change gives a new `source_hash`, so an old article can never publish over new captions. Visibility comes from the bookmark, never from the row or the R2 key.

### Workflow

`YoutubeArticleWorkflow` runs on the edge Worker. The event carries only references (video id, source hash, caption key, target language, prompt version, trigger user). Steps: load source, eligibility rules, chunk, generate chunks, merge and validate, render, publish. Steps return keys and counts only. A run claims its row with a `run_id` lease; claim and publish are compare-and-set on that id, so a retried step does not bill twice or publish twice. A failure never changes the bookmark status.

### Generation contract

- Model `gemini-3-flash-preview` through the existing `VertexAIClient`, JSON response with a response schema, temperature 0.2, at most 16,000 output tokens per chunk.
- Chunks follow cue boundaries (about 2k to 4k tokens) with a small cue overlap. Merge removes overlap by `source_cue_ids`, not by text similarity.
- The transcript is untrusted input. The prompt forbids instructions from the transcript, new facts, summaries and Markdown.
- Validation fails the run on invalid cue references, wrong language, number coverage under 85%, a length ratio outside the per-language-pair range, duplicate paragraphs or empty blocks. An unknown speaker name becomes `null`.
- The renderer writes escaped HTML with a fixed tag set. The Web client renders from the JSON with text bindings only and never uses `v-html` for the article.
- Publish order: write JSON, HTML and TXT, read them back, then compare-and-set the row to `ready`. If the compare-and-set fails, delete the new objects.

### Eligibility

Captions are necessary but not sufficient. Zero-cost rules (caption density, noise, music and applause share, fragment and repeat ratio, visual-dependency hints, length) decide `eligible` or `skipped` and record reason codes. A skipped version offers "generate anyway" to the owner, unless it was skipped for length.

### Cost limits

| Limit | Value |
|---|---|
| Per article version, all attempts, failed calls included | $0.30 |
| Automatic starts per user per day (opening a bookmark or saving a video) | 20 |
| Manual starts per user per day | 5 |
| Site-wide model spend per UTC day | $20, then new runs are deferred and one alert is sent |
| Concurrently running rows | bounded; extra rows are deferred for the sweep |

Counters and the start lock live in Redis (`yt_article:*`). Spend is estimated per call and stored in `cost_usd`.

### Access

The monorepo already has one read rule for snapshots: `BookmarkService.getBookmarkReadAccess` (owner always; others only if the bookmark is not trashed, not moderated, the owner exists, and the share record is on, or there is no share record and the owner shares snapshots). The legacy branch had its own copy of this rule (`visitorCanRead`) that read the share from bookmark metadata. The port drops that copy and calls `getBookmarkReadAccess`, so the article and the snapshot page cannot disagree. Only the owner can generate or retry. A moderated bookmark shows no article, also to the owner.

### Labs and Settings

`youtube_article` is a Labs feature, not a gated save route: without it, YouTube saves behave as before and the article API answers `unavailable`. The monorepo originally hid the `youtube` row in Settings (`hide-youtube-pdf-labs`), so the article row was hidden with it. `unhide-youtube-labs` now shows both rows; the backend always listed the feature, and enabled accounts keep it.

### Presentation

`BookmarkArticle` gets an `after-body` slot outside `.article-detail`, so the original DOM, processors and marks do not change and the article cannot be highlighted. When the article is ready and the bookmark has no marks, the page folds the original transcript with `display: none` and offers "Show original transcript". Chapter times are buttons that send the existing `slax:youtube-seek` event. Status text lives in a persistent live region. Polling runs at 2, 4, 8 and 15 seconds, then every 15 seconds, for at most 10 minutes. Styles use existing `--slax-*` tokens only.

### Configuration

The monorepo keeps one public Wrangler template. The binding goes into `deploy/cloudflare/api.toml.example`; the sweep uses the `*/5` trigger that is already there. The legacy `script/gen-cron.ts` fix for jobs that share a schedule is not needed: the monorepo generator already runs every job of a schedule.

## Risks / Trade-offs

- The migration is expand-only. It adds `target_language` and the new unique key, and it keeps the old key `(video_id, source_hash, prompt_version)`, because beta runs migrations against the production database before production code updates, and the production P0 code upserts on the old key. The contract migration in `podcast-article` drops the old key. Because PR #220 was merged into this branch, both ship in one release, and migrations run before the new code deploys, so this code never runs while the old key exists and writes language rows through the language-aware key only. The window that matters is on the production side: during the beta-to-production window, the P0 caption write in production fails softly (`saveYoutubeCaptionArtifacts` never throws), so a YouTube save by a Labs user in that window gets no article row until a later save. Promote `dev` → `beta` → `main` in one pass to keep that window short.
- Prompt quality, validation thresholds and cost factors were tested only against a fake model. Mitigation: the feature is off by default and its Settings row is hidden; turn it on for internal accounts and calibrate with about 10 real videos first.
- The Gemini list price is hard-coded. Mitigation: check against the Vertex price page before rollout.
- Folding the transcript after the reading position is restored can shift the position for local-first owners. Accepted for Labs.
