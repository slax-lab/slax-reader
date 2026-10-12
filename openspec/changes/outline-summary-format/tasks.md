# Tasks

## 1. Remove the envelope request from the prompt

- [x] 1.1 Delete the `## 输出的格式如下，注意为JSON格式` block from `systemPrompt` in `apps/api/src/const/prompt.ts`, leaving the markdown requirements and the `</要求>` ending untouched, so the model is asked for markdown directly as before the fork added the envelope. Verify with `pnpm api -- test test/const/prompt.test.ts`.
- [x] 1.2 Pin the intent in `apps/api/test/const/prompt.test.ts`: the prompt keeps the markdown-only syntax requirement and contains no JSON output instruction and no `content` envelope.

## 2. Drop the server-side envelope handling

- [x] 2.1 Revert `apps/api/src/domain/aigc.ts` (`generateOutline`, `bookmarkSummary`) and `apps/api/src/domain/bookmark.ts` (`getBookmarkOutline`, `getUserBookmarkSummary`, `getUserBookmarkSummaryByMCP`, `getBookmarkSummaries`) to their pre-change state, and remove `apps/api/src/utils/summaryContent.ts` with its tests, so no layer wraps or unwraps outline/summary content. Verified: `git diff` against the branch base shows no change in `apps/api/src/domain`, and both write sites hand the model's bytes to the client and to `saveSummary` unchanged.

## 3. Regression and delivery checks

- [x] 3.1 Run `pnpm api -- test` and confirm no new failures, reporting the `test/script/**` files that time out under load and pass in isolation. Result: 1504 passed / 46 skipped, with 3 `test/script/**` files hitting their 5s timeout under the parallel run; the same 3 files pass in isolation (53 tests) and touch none of the changed files.
- [x] 3.2 Run `pnpm api -- typecheck` and `pnpm api -- lint` and confirm both pass. Result: typecheck passes; lint reports 0 errors.
- [x] 3.3 Run `pnpm exec openspec validate --all --strict` and confirm the change validates. Result: 11 passed / 0 failed.
- [ ] 3.4 Ask the owner to generate one outline/summary against the local stack and confirm the response body is markdown with no braces, key name, or fence — the only end-to-end check that exercises the model, which needs their credentials.

## 4. Review and delivery

- [x] 4.1 Complete the local pre-push review from `REVIEW.md` (three passes, including the compliance pass against `outline-summary-format`), resolve Important findings, and confirm the diff touches no frontend file and no stored row.
