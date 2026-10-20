# Proposal

## Why

A saved YouTube video shows only the player and its raw captions. Raw captions have no punctuation and no paragraphs, and automatic captions repeat lines. Many talks, interviews, courses and news videos carry their value in speech. A faithful written article lets a reader read, highlight and revisit such a video like an article.

This work was built and reviewed in the legacy repositories (`unnoo/slax_reader_backend#873`, `unnoo/slax_reader_frontend#1622`). Those repositories are retired. This change ports the work into the monorepo and adapts it to the monorepo's access rule, Labs list and configuration layout.

## What Changes

- Generate one AI article per video, caption version and target language (`en` or `zh`). Every user who saved the video and reads in that language shares it.
- Start generation after a save that passed moderation, when the owner opens a bookmark without a version in the owner's AI language, or when the owner asks for "generate anyway" or "retry". Visitors only read finished articles.
- Run generation in a new `YoutubeArticleWorkflow`. Large data stays in R2; workflow steps return only keys and counts. Each run holds its row by `run_id`, so claim and publish are idempotent.
- Limit cost: $0.30 per article version across all attempts, 20 automatic and 5 manual starts per user per day, and $20 per day site-wide with one alert.
- Add `GET /v1/youtube_article/status` and `/content` (owner and share visitors, by the snapshot access rule), `POST /v1/youtube_article/generate` and `/retry` (owner only), and `POST /m/youtube_article/backfill` (team only).
- Sweep on the existing 5-minute cron: recover dead runs, start deferred requests, delete article versions without a bookmark for 7 days, and clean up takedowns. Add `script/youtube-article-takedown.ts`.
- Add the Labs feature `youtube_article`, off by default. Settings showed its row hidden with `youtube` at delivery time; `unhide-youtube-labs` later shows both rows.
- Keep the old unique key `(video_id, source_hash, prompt_version)` while production code still writes through it (expand/contract). Until `podcast-article` drops it, a caption version holds one language row.
- Show the article below the player on the bookmark page, with generating, ready, skipped, failed, limit-reached and slow states. Render from structured data with text bindings only. Fold the original transcript when the article is ready and the bookmark has no marks.
- Add the `YOUTUBE_ARTICLE_WORKFLOW` binding to `deploy/cloudflare/api.toml.example` and the Worker environment type.

## Capabilities

### New Capabilities

- `youtube-ai-article`: generation, sharing, cost limits, access and presentation of AI articles for saved YouTube videos.

### Modified Capabilities

None. The Settings rule for the new Labs row is an additional requirement in this change's own capability; it does not change the in-flight `settings-labs-visibility` delta.

## Impact

- API: `apps/api` domain, repository, workflow, cron, HTTP controllers, generated DI, Prisma schema and the migration `20261014000000_youtube_article_target_language`.
- Web: `apps/web` bookmark page, `BookmarkArticle` `after-body` slot, new `YoutubeAiArticle` component and composable, Labs visibility predicate, en/zh copy.
- Contracts: `packages/contracts` API paths and response types.
- Deployment: operators add the `YOUTUBE_ARTICLE_WORKFLOW` binding to their private Wrangler configuration before deploy, and run the Postgres migration.
- Behaviour for users does not change until an account enables `youtube_article`. The Settings row is visible after `unhide-youtube-labs`; enabling remains a UI action only, and a signed-in user can also enable it through `user/setting/enable`. The per-user daily limits and the site-wide daily budget bound the cost of such accounts.

## Non-goals

- Do not replace the original body HTML or plain text, and do not add the article to highlights or full-text search.
- Do not support target languages other than English and Chinese.
- Do not backfill old bookmarks automatically.
- Do not port the legacy Chinese project documents; this change and the legacy PRs are the record.
