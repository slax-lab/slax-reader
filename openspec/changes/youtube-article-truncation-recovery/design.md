# Design

## Context

See proposal.md, Why. Evidence from the production workflow logs on 2026-10-31:

- Video `H9Bdv3t5VtQ` (57 min, 8 chunks, English captions, target `zh`, prompt `v2`): chunks 0 to 3 complete in about 25 s each with 5.6k to 5.9k output tokens. Chunk 4 ends with `MAX_TOKENS` on all 12 calls across 4 runs (2 prod, 2 beta). The failing call is the English edit call: R2 holds `3.json.source` but no `4.json.source`. The chunk's input is normal: 224 cues, 7.1k characters.
- Videos `d9y30vB88zg` (chunk 0, prompt `v1`) and `WdWVlQgkVe4` (chunk 21, prompt `v1`) fail the same way.
- The runner throws `chunk_truncated` as a retryable error. The step engine retries it 2 more times with the same input, and `finishAttempt` sets the row back to pending until 3 runs are used. `prepare` then returns `budget_exceeded`, which `FINAL_ERRORS` makes permanent.
- The reply is discarded on truncation and no text is logged, so production gives no evidence whether the output loops or the thinking grows. Each truncated call lasted 60 s to 100 s, consistent with about 16k generated tokens.
- The `media-article-reliability` spec still requires `thinkingBudget: 2048` for every call; the YouTube runner on `main` sends `thinkingLevel: 'LOW'` (Gemini 3 flash preview rejects the budget form). The podcast runner keeps the budget.

Constraints: step results stay small (keys, counts, states); logs carry no transcript or article text; no new dependency.

## Goals / Non-Goals

Goals:

- A deterministic truncation costs one extra round of smaller calls, not 9 to 12 identical calls.
- A version our own failed attempts bankrupted can be retried by its owner with one click.
- Production tells us which failure mode is real.

Non-Goals:

- Changing the prompt text, the model or the chunk target size.
- Salvaging a truncated JSON reply.
- Separating the beta worker from the production database and bucket (deploy decision, tracked in the proposal's Impact).
- Changing the podcast runner.

## Decisions

### 1. Split the chunk on truncation instead of retrying it

In the `chunk-i` step, wrap the edit call (v2) or the single call (v1) in `inParts(cues, run)`. Start with `parts = 1`. On `MAX_TOKENS`, double `parts` (2, then 4) and call the model once per equal cue slice; join the parts' `sections` in order. The translation call (v2, other-language target) runs per part on the part's edited sections, so its output stays bounded too. The chunk's `lede` comes from the first part. The step stores one chunk object as today.

At `parts = 4` a truncated part throws `YoutubeArticleStop('chunk_truncated')`, so the outer handler finishes the row as `failed`, not `retry`. `YoutubeArticleStop.code` gains that value. `chunk_truncated` is not added to `FINAL_ERRORS`, so the owner's explicit retry stays possible.

Alternatives considered:
- Retry with a higher temperature. Non-deterministic, may still loop, keeps the full cost per attempt.
- Lower the chunk target for every video. Doubles call count and cost for the 95% of chunks that work.
- Treat `chunk_truncated` as `failed` at once. Cheap, but gives no article at all for an input that a smaller call handles.

Part-level results are not cached in R2. The step engine still retries the whole chunk step twice on `chunk_invalid_json`, which would redo the parts; that cost is bounded by the smaller output limit and is rare, so the extra keys are not worth it.

### 2. Output limit from input size

`maxOutputTokens = clamp(4 × estimateTokens(user), 4000, 16000)`. Measured ratios on healthy chunks: edit output about 1.3× the user message, v1 one-shot Chinese output about 2.4× (thinking tokens included in `usage.outputTokens`). 4× leaves room; a loop on a 2.5k-token chunk now stops at 10k tokens instead of 16k, and at 4k for a quarter part.

### 3. Truncation telemetry

`ChatUsage` gains optional `thoughtTokens` (from `usageMetadata.thoughtsTokenCount`); `outputTokens` keeps the summed meaning the cost code uses. In `ask`, before throwing on `MAX_TOKENS`, log `youtube_article_truncated` with `chunk`, `parts`, `input_tokens`, `candidate_tokens`, `thought_tokens`, `repetition_ratio`. The ratio is `1 - distinct / total` over 40-character shingles of the reply's last 4,000 characters; a loop gives a ratio near 1, a normal reply near 0. No text is logged. This also follows `media-article-reliability`'s existing log rule (ids, counts, hashes).

### 4. Explicit retry after `budget_exceeded`

`requeue(id, resetAttempts = true, { recoverBudget: true })` keeps the `too_long` exclusion but drops the `budget_exceeded` exclusion, and sets `cost_usd: 0` with `retry_count: 0`. `MediaArticleRepo` is shared with podcast articles, so the recovery is an explicit option that only the YouTube retry passes; the podcast retry (`requeue(id, true)`) keeps every final error. `isFinalError` keeps both codes, so `can_generate` (the "generate anyway" path, which does not reset) is unchanged; `can_retry` becomes `status === 'failed' && !error.startsWith('too_long')`. `requestArticle` in `retry` mode calls `takeDaily(owner, 'manual')` and gives it back when the requeue or start does not happen, the same as the `manual` path. The per-user manual limit (5 per day) and the site-wide daily cap bound the extra spend.

Alternative: exclude truncated-call cost from `cost_usd`. Rejected: the money is spent; hiding it breaks the site-wide cap's meaning.

### 5. Spec sync for thinking

Record in `media-article-reliability` that YouTube calls use `thinkingLevel: 'LOW'` and podcast calls keep `thinkingBudget: 2048`. No code change; the existing runner test already asserts the level.

## Risks / Trade-offs

- [Splitting does not stop a content-driven loop] → telemetry (decision 3) shows the mode; the part limit caps spend at about 1 + 2 + 4 smaller calls; the version fails without automatic retries.
- [4× output limit too tight for some chunk] → the call returns `MAX_TOKENS`, the split halves the input, and the limit never drops below 4,000 tokens. Runner tests cover a part at the floor.
- [Part boundaries cut a sentence] → cue slices keep order and ids; `completeCueCoverage` and the length-ratio check still run on the joined chunk. A heading may repeat at the seam; the existing merge step already tolerates adjacent sections.
- [A user retries a bankrupt version 5 times a day] → bounded by the manual limit and the $20 site cap; each retry after the fix costs about $0.40, not $1.

## Migration Plan

1. Deploy the API. No schema change: `cost_usd`, `retry_count` and `error_message` already exist.
2. The three failed production rows show `can_retry`; Luca retries them from the bookmark page, which also verifies the fix on real data.
3. Rollback: revert the deploy. Rows reset by a retry keep working under the old code.

## Open Questions

- Which failure mode is real (output loop or thinking growth). Answered by the telemetry after deploy; it changes a later tuning step, not this change.
