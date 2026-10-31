# Tasks

## 1. Truncation recovery in the runner

- [x] 1.1 Add failing runner tests: a model that truncates the whole chunk and answers each half; a chunk that still truncates at 4 parts ends `failed` with `chunk_truncated` and no automatic retry; part output joins in cue order.
- [x] 1.2 Implement `inParts` for the v1 call and the v2 edit and translation calls; make the 4-part truncation a `YoutubeArticleStop`; keep step results small.
- [x] 1.3 Add failing tests for `maxOutputTokens` at 10,000 for a 2,500-token user message and 4,000 at the floor; implement the clamp.

## 2. Truncation telemetry

- [x] 2.1 Add `thoughtTokens` to `ChatUsage` in the Vertex client with a unit test on `usageMetadata` mapping.
- [x] 2.2 Log `youtube_article_truncated` with counts and the repetition ratio; test that the log carries no transcript words and that a repeated tail scores near 1.

## 3. Explicit retry after budget_exceeded

- [x] 3.1 Add failing repository tests: `requeue(id, true)` accepts `budget_exceeded`, rejects `too_long`, and resets `cost_usd` and `retry_count`.
- [x] 3.2 Add failing service tests: `can_retry` for a `budget_exceeded` row, retry takes one manual daily start, `limit_reached` when none is left, and the allowance is given back when nothing starts.
- [x] 3.3 Implement the repository and service changes.

## 4. Verification and delivery

- [x] 4.1 Run the API tests, typecheck, changed-file lint and `pnpm exec openspec validate --all --strict`; record results in validation.md.
- [ ] 4.2 After the merge reaches beta (the API deploys from `dev`/`beta`/`main` pushes), retry `H9Bdv3t5VtQ` from a Labs account, confirm the article is published and the workflow instance shows the split calls and the truncation log; record the evidence in validation.md.
- [x] 4.3 Run the REVIEW.md pre-push review and resolve Important findings.
- [ ] 4.4 Commit on the task branch with the change record; open the pull request to `dev` with `OpenSpec: youtube-article-truncation-recovery`.
- [ ] 4.5 After the task pull request merges, retry the three failed production rows, then classify remaining tasks and archive this change through a documentation pull request.
