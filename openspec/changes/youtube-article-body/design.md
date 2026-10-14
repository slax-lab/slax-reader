# Design

## Decisions

### Body writer

`MediaBodyService` writes a cleaned media article into one bookmark body: it replaces the HTML and text objects at the same keys, then updates the word count and the search index, and deletes the cached overview. Podcasts and YouTube both use it. `renderMediaArticle(doc, version, cues, kind)` renders both kinds; podcast output is byte-identical to before. `HtmlBuilder.buildYoutubeArticleBody` keeps the player snippet and its `data-cues`, so the side transcript panel and seeking keep working.

### When a body is written

- The YouTube runner adds a `publish-body` step after publish. It writes every eligible bookmark of the video and caption version. A failure only logs; the article stays `ready`.
- A save of a video whose article is ready writes the body at once.
- When the owner reads the status and the article is ready but not in the body (articles made before this change, or a failed write), the service writes it.

### Marks rule

Marks are anchored to the body as it is. A bookmark with any non-deleted highlight or comment, by anyone, keeps its body. A missing user bookmark counts as marked, so an unknown state never loses marks. The check runs just before the write. There is no lock between check and write; a mark created in that gap can lose its anchor. Accepted for Labs.

### Takedown

Takedown first rebuilds the raw caption body from `data-cues` for each affected bookmark, then deletes the article objects. Marks made on the article body lose their anchors.

### Client

The page decides from `body_mode` and `body_ready`:

- Article body: no separate article block and no fold.
- Raw body with an article coming: `YoutubeArticleBar` above the body shows making, skipped ("generate anyway"), failed (retry) and limit states. When the status says the body is ready, the page reloads the body in place and remounts it, at most 4 times 15 seconds apart, and never while the video plays (a button instead).
- Raw body that stays raw (marks, a visitor in another language, a failed write): the article block below the body, as in `youtube-ai-article`.

Article paragraphs use the podcast markup and code path (`bindMediaText`, `MediaFollower`, `listenStartOf`). The YouTube player now reports its play state.

## Risks / Trade-offs

- No lock between the mark check and the write (see above).
- Unsynced local-first marks are invisible to the server check.
- No end-to-end run with the real model and no browser test; check on beta with an internal account.
