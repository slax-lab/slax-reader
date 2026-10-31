# Proposal

## Why

Every YouTube AI article run in production has failed since the feature shipped: three videos, zero articles. On each video one chunk makes the model hit the output limit (`chunk_truncated`) on every attempt. The runner then repeats the identical call 3 times per run, the sweeper starts up to 3 runs, and the beta worker (same database and bucket) claims the same row. One 57-minute video got 12 identical failed calls, spent about $0.69 of its $1.00 budget, and ended as `budget_exceeded`, a final error with no retry.

## What Changes

- When a chunk call ends with `MAX_TOKENS`, split the chunk's cues into parts and call the model per part instead of repeating the same input. A chunk that still truncates after the split limit fails the version without further automatic attempts.
- Set each call's output limit from the size of its input, so a looping reply stops early and costs less.
- Log token counts and a repetition ratio for every truncated reply, counts only, so the loop-or-thinking question is answered from production data.
- Let the owner's explicit retry recover a version that ran out of budget: the retry resets the spent amount with the attempt count and counts as one manual start of the day. `too_long` stays final.
- Sync the thinking requirement with the deployed code: YouTube calls use the Gemini 3 `LOW` thinking level; podcast calls keep the 2,048-token thinking budget.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `media-article-reliability`: truncated replies lead to a smaller input, not an identical repeat; output limits follow input size; truncation telemetry; the thinking requirement matches the deployed Gemini 3 setting.
- `youtube-ai-article`: the per-version budget rule allows one explicit owner retry after `budget_exceeded`, and every explicit retry counts as a manual daily start.

## Impact

- `apps/api/src/domain/youtubeArticleRunner.ts`: part splitting, output limit, truncation log.
- `apps/api/src/infra/external/vertexAIClient.ts`: expose thinking token count in `ChatUsage`.
- `apps/api/src/infra/repository/dbMediaArticle.ts` and `apps/api/src/domain/youtubeArticle.ts`: explicit retry after `budget_exceeded`; `can_retry` status.
- Tests under `apps/api/test/domain/youtubeArticleRunner.test.ts` and the repository tests.
- No API contract shape change, no schema migration, no Web, Extension, CLI or Mobile code. The Web client already shows the retry button from `can_retry`.
- Out of scope, for a separate decision: the beta worker shares the production database and bucket and runs production rows.

## Human review

On 2026-10-31, Luca reviewed the investigation in conversation and asked to proceed under the project workflow. This document records that scope for review before implementation. No material UX change: the failure and retry states already exist on the bookmark page.
