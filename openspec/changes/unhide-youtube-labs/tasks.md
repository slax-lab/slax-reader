# Tasks

## 1. Show the YouTube Labs rows

- [x] 1.1 Remove the key-based hiding set and predicate; filter Labs rows only by translated name in the Settings card and the Features navigation.
- [x] 1.2 Update the Web unit tests so `youtube` and `youtube_article` render, toggle, and preserve their state, while untranslated rows stay hidden.
- [x] 1.3 Update the unarchived `youtube-ai-article` delta so its Settings requirement matches the visible row.

## 2. Validate

- [x] 2.1 Run the Web unit tests and typecheck; record results in `validation.md`.
- [x] 2.2 Run `openspec validate --all --strict`.
- [x] 2.3 Run the local pre-push review from `REVIEW.md` and resolve Important findings.
