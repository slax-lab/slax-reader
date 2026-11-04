# Validation

Date: 2026-10-31. Branch `fix/youtube-article-truncation`, cut from `origin/dev` at `6deae73c`.

## Baseline

Production evidence (Cloudflare Workflows, `wrangler workflows instances describe`):

- `youtube-article-workflow` has 5 instances since the feature shipped. Every one ends in `finish-retry` or `finish-failed`; no article was ever published.
- Video `H9Bdv3t5VtQ` (zh, v2): chunks 0–3 complete in 23–27 s with 5.6k–5.9k output tokens each. Chunk 4 ends with `Error: chunk_truncated` on all 3 step attempts in 4 runs (prod `mvvoihba` 08:44, beta `mvvp91su` 09:05, beta `mvvpypkr` 09:25, prod `mvvqib4d` 09:40), 12 identical calls. Run `mvvr8aa5` (10:00) stops in `prepare` with `budget_exceeded`.
- R2 (`slax-reader-backend`): `…-zh-v2/3.json.source` exists, `…-zh-v2/4.json.source` does not, so the English edit call is the one that truncates. The chunk's input is ordinary: 224 cues, 7,133 characters.
- Videos `d9y30vB88zg` (chunk 0, v1) and `WdWVlQgkVe4` (chunk 21, v1) fail the same way.

Before the fix, the new runner tests failed as expected: `outputTokenLimit`/`repetitionRatio` did not exist (7 failures), and a truncating model drove the row to `pending` with 3 identical calls instead of a split.

## Automated checks

Run from `apps/api` on the final diff:

- `pnpm vitest run --config vitest.config.ts`: 199 files passed, 14 skipped; 2,709 tests passed, 113 skipped. Two earlier runs showed one timing-dependent failure each in `test/script` (dev port guard, gen-config offline path); both pass in this run and on `origin/dev`, and neither touches this change.
- `pnpm vitest run test/domain/youtubeArticleRunner.test.ts`: 40 passed. New: whole-chunk truncation → 3 calls and a complete article; multi-chunk split keeps the overlap on the first part only and covers all 300 cues once; always-truncating model → `failed`, `chunk_truncated`, 3 calls (whole, half, quarter), `retry_count` 1; `maxOutputTokens` equals `outputTokenLimit(estimateTokens(user))` on every call (10,000 at 2,500 tokens, 4,000 floor, 16,000 ceiling); `youtube_article_truncated` log carries `article_id`, `chunk`, `parts`, `input_tokens`, `candidate_tokens`, `thought_tokens`, `repetition_ratio` and no transcript words; v2 edit split with translation per part (3 edit calls, 2 translation calls, 40 cue ids in order); a single-section translation that truncates fails with one call; repetition ratio > 0.9 for a loop and < 0.1 for prose.
- `pnpm vitest run test/domain/youtubeArticleService.test.ts`: passed. Covers: `budget_exceeded` row → `can_retry: true`, `can_generate: false`; the retry resets `retry_count` and `cost_usd`, keeps `lifetime_cost_usd`, takes no daily start, and works after 5 manual starts; `lifetime_budget_exceeded` and `too_long` → neither flag, retry refused; private-variant (capture) retry gate per reason: `budget_exceeded` reopens, `too_long` and `lifetime_budget_exceeded` refuse, generate refuses all three.
- `pnpm vitest run test/infra/vertexAIUsage.test.ts`: 2 passed (`thoughtTokens` mapping).
- `RUN_PG_INTEGRATION_TESTS=1 pnpm vitest run test/infra/youtubeArticleRepo.integration.test.ts` against the local `dev-postgres` container (port 15432, all 57 `pg_migrations` applied with `prisma migrate deploy`): 15 passed, including `requeue(id, true, { recoverBudget: true })` on a `budget_exceeded` row → `pending`, `retry_count` 0, `cost_usd` 0; the plain retry and generate still refuse that row; `too_long` refused for every path.
- `pnpm exec tsc --project tsconfig.json --noEmit`: passed.
- `pnpm exec eslint` on the six changed source files: 0 errors; 13 pre-existing `no-explicit-any` warnings in untouched code (`vertexAIClient.ts` `chatStream`, `youtubeArticle.ts`).
- `pnpm exec openspec validate --all --strict`: 90 passed, 0 failed.
- `git diff --check`: passed.

## Exercised in a running environment

- Repository behavior on a real PostgreSQL (integration test above): the explicit retry recovers a `budget_exceeded` row and refuses `too_long`.
- Runner replay against the real model was prepared: the production caption and chunks 0–3 of `H9Bdv3t5VtQ` were loaded from R2 into an in-memory bucket and the new runner started with `VertexAIClient`. The run reused chunks 0–3 and reached chunk 4, then stopped with `Authentication is not set up`: this machine has no `VERTEX_API_KEY`. Scenario "One split recovers the chunk" is therefore covered by the runner tests only.

## Review round 2 (2026-10-31)

The automated review on `932c67f8` found no Bugs or Security issue. Nits fixed in the next commit: later parts of a split chunk get a continuation instruction (no lede, no "already covered" clause); the `chunk-N` step timeout grows to the 10-minute lease because a split step can make several calls; the `request()` doc comment states that a retry counts as a manual start; `design.md` and the delta spec name the real helper and field. The remaining Important finding is a Compliance judgement about UI acceptance, recorded below for the human reviewer.

## Round 3 and decisions (2026-10-31)

The automated review on `f19fe480` found no Bugs or Security issue. Its one Important Compliance finding asked for a human decision on the Retry button that now shows for `budget_exceeded`. Luca decided, recorded in `proposal.md` → Human review: (1) the button change is accepted as an intended effect, with no Web or Extension code change; (2) a $2.00 total spend cap per version across retries; (3) the retry takes no daily start.

Implementation and checks for those decisions (commit after `f19fe480`):

- Migration `20261031000000_media_article_lifetime_cost` applied to the local `dev-postgres` with `prisma migrate deploy`; `information_schema.columns` shows `lifetime_cost_usd double precision NOT NULL DEFAULT 0`. Expand-only: no drop, rename or type change.
- `pnpm vitest run --config vitest.config.ts`: 199 files passed, 14 skipped; 2,713 tests passed, 113 skipped.
- Runner: a retried version with `cost_usd` 0 but `lifetime_cost_usd` 1.99 stops before any model call with `lifetime_budget_exceeded`; a run that crosses $2.00 after its first call stops with the same code after exactly 1 call.
- `RUN_PG_INTEGRATION_TESTS=1` YouTube and podcast repository tests on real PostgreSQL: 25 passed. `addCost` raises both columns; the recovering retry zeroes `cost_usd` and keeps `lifetime_cost_usd`; `lifetime_budget_exceeded` is refused by every `requeue` path.
- Nits from round 3: a truncated introduction now stores `chunk_truncated: introduction` (a split stores `chunk_truncated: parts=N`), so the stored error says which call truncated; the private-variant retry gate has a per-reason test.

## Not verified, and why

- The real model's reply to chunk 4 after the split (whether halves of that passage complete). No Vertex credential is available locally; the API deploys from `dev`/`beta`/`main` pushes only. Planned: after this merges and reaches beta, retry `H9Bdv3t5VtQ` from a Labs account and read the `youtube_article_truncated` and `youtube_article_chunk` events in the workflow instance (task 4.2). The truncation telemetry exists for this purpose.
- Site-wide daily cap and alert: unchanged code, covered by existing service tests.
- UI hands-on acceptance: decided by Luca on 2026-10-31 (see above). This change is API-only. No `apps/web` or `apps/extension` presentation code changes; the retry button already ships, and only the server-side `can_retry` flag now also covers `budget_exceeded`. The beta retry of `H9Bdv3t5VtQ` above is functional verification of the runner, not a UI acceptance step.
- Podcast articles share `MediaArticleRepo.requeue`. The budget recovery is an explicit option (`recoverBudget`) that only the YouTube retry passes; the podcast retry keeps `budget_exceeded` final. Covered by the integration test (plain retry refused, recovering retry accepted) and by the unchanged podcast service tests.
