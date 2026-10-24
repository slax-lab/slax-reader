# Proposal

## Why

With `youtube-ai-article`, a saved YouTube video shows the raw transcript as its body and the AI article in a separate block below it. Readers then scroll past a long raw transcript, and marks, search and Chat use the raw text. Podcast bookmarks already use the clean article as the body. YouTube bookmarks should work the same way.

This work was built and reviewed in the legacy repositories (`unnoo/slax_reader_backend#875`, `unnoo/slax_reader_frontend#1624`). This change ports it into the monorepo. It depends on `youtube-ai-article` and `podcast-article`.

## What Changes

- When a YouTube article version is ready, write it as the body of every bookmark of that video and caption version whose owner has `youtube_article` enabled and reads that language. Skip bookmarks flagged by moderation.
- Keep the body of a bookmark that has any non-deleted highlight or comment; the page then shows the article below the body as before. Check marks last, just before the write.
- Give a later save of a processed video the article body at once, without a workflow run, a model call or a daily count.
- Keep the raw transcript body for videos that the eligibility rules skip.
- Add `body_mode` (`article` | `transcript`) and `body_ready` to the status. When the owner reads the status, write a ready article that is not yet in the body. Visitors only read.
- Share one body writer (`MediaBodyService`) between YouTube and podcasts: body objects, word count, search index and cached overview.
- On takedown, restore the raw captions from `data-cues` before deleting the article objects.
- On the bookmark page, show a slim status line above a raw-transcript body, reload the body in place when it becomes ready (not while the video plays), and fall back to the article block below the body when the body stays raw. Article times seek the player, the playing paragraph is marked and followed, and "listen from here" works, with the same code path as podcasts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `youtube-ai-article`: the article becomes the bookmark body when no marks exist, instead of always staying outside it.

## Impact

- API: `apps/api` new `MediaBodyService`, YouTube runner `publish-body` step, status fields, takedown, shared media renderer, `MediaArticleRepo.listRefs`.
- Web: `apps/web` bookmark page, new `YoutubeArticleBar`, `youtubeBody` helpers, YouTube player state events, YouTube processor.
- Contracts: `packages/contracts` status fields.
- No migration and no new configuration.

## Non-goals

- Do not lock between the mark check and the body write.
- Do not protect marks that exist only in an unsynced local-first client.
