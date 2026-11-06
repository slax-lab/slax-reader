# Validation

Date: November 6, 2026. Branch: `fix/youtube-translation-delivery`, based on `origin/dev` at `dd30199e`.

## Configuration and scope

All text generation in YouTube and podcast article workflows uses `deepseek-flash` at the fixed `https://api.deepseek.com/chat/completions` endpoint. The only new binding is `DEEPSEEK_API_KEY`. The operator supplies it to the Edge Worker: `slax-read-backend` in production and `reader-backend-dev` in test. Local Worker configuration belongs in `deploy/local/.dev.vars`. No credentials were printed or committed. Unrelated summaries, chat, moderation, transcription and embeddings retain their providers. No schema, client contract or app package version changes.

## Automated verification

- `pnpm api -- test`: 2,906 passed, 116 skipped across 202 passing and 14 skipped files. Skipped tests require separately enabled integration/database environments or optional import fixtures.
- `pnpm api -- typecheck`: passed.
- `pnpm api -- gen:all`: passed using non-secret localhost placeholder database URLs for generation and the checked-in API template. No migration was run.
- Worker environment declarations regenerated from the baseline through `generateWorkerTypes` after removing the proposed API-base option; only `DEEPSEEK_API_KEY` remains.
- Targeted ESLint: zero errors; four existing `any` warnings in the two Workflow adapters.
- `pnpm exec openspec validate --all --strict`: 110 items passed.
- `git diff --check`: passed.

Fault tests cover malformed/empty responses, missing paragraphs, wrong language, truncation, amount/year diagnostics, provider rejection and timeout, saved-passage reuse, interrupted assembly repair, ownership loss, budget reservations, accounting failure, body publication failure, indexing failure, cleanup failure and sweep catch-up. Numeric differences remain diagnostic; this does not prove semantic accuracy.

## Running local exercise

`apps/api/test/runtime/deepseekDelivery.ts` executes the production runner and DeepSeek client. It uses filesystem-backed article objects, a local repository stand-in and local body/index writes, with a step adapter that exercises retry counts without Cloudflare backoff delays. It asserts exact cue order and coverage plus body-before-index-before-cleanup ordering.

Controlled HTTP runs for both public incident caption fixtures passed: fsTtKywmWlU (1,687 cues, 8 chunks, 129 paragraphs) and yP176MBG9Tk (1,318 cues, 7 chunks, 70 paragraphs), with peak concurrency five. These protocol runs are not provider quality or latency evidence.

The operator then provided the key and authorized actual provider runs. Command from apps/api:

```sh
node --env-file=../../deploy/local/.dev.vars --import tsx test/runtime/deepseekDelivery.ts --live /tmp/slax-cue-2f114e/caption.json /tmp/slax-dev-stall/new-caption.json
```

| Video | Actual provider result | Local elapsed | Cues / paragraphs | Estimated upper-bound cost |
| --- | --- | --- | --- | --- |
| fsTtKywmWlU | Ready, Chinese | 34.858 s | 1,687 / 129 | $0.029412 |
| yP176MBG9Tk | Ready, Chinese | 30.408 s | 1,318 / 70 | $0.0261504 |

Estimates use the published peak uncached DeepSeek Flash prices, $0.30 input / $1.20 output per million tokens, verified against https://api-docs.deepseek.com/quick_start/pricing/. Cache and off-peak discounts can reduce actual billing.

First-run artifacts are under `/tmp/slax-deepseek-delivery/ff18bc6bff1b-live-1793956481412` and `/tmp/slax-deepseek-delivery/3ffbbdd12114-live-1793956516272`. The runtime script emits each later run's artifact directory. Caption fixtures are public-video snapshots previously captured during incident investigation; temporary fixtures are not committed.

## Live fault recovery on the final fixed-endpoint implementation

The final `--live --faults` run injected exactly one of each: HTTP 429, an empty model response, an output-length finish reason, canonical JSON write failure, body publication failure and search-index failure. Both videos recovered and passed exact ordered cue coverage plus body/index ordering assertions:

| Video | Result | Elapsed | Cues / paragraphs | Estimated upper-bound cost |
| --- | --- | --- | --- | --- |
| fsTtKywmWlU | Ready, Chinese | 24.175 s | 1,687 / 129 | $0.0335913 |
| yP176MBG9Tk | Ready, Chinese | 23.940 s | 1,318 / 70 | $0.0269475 |

Artifacts: `/tmp/slax-deepseek-delivery/ff18bc6bff1b-live-1793956801212` and `/tmp/slax-deepseek-delivery/3ffbbdd12114-live-1793956825392`. Add `--faults` to the command above to reproduce fault injection. Provider latency varies between runs; the faster fault run does not mean failures improve performance. A preceding fault-harness run delivered the first video but its final assertion found repeated injected truncations caused by the harness reserving a fault after awaiting response JSON. That test-harness issue was corrected; the final run asserts exactly one injection of each failure.

## Verification limits

Local elapsed time includes actual model calls and local runner work, but excludes remote PostgreSQL/R2 latency, Cloudflare Workflow scheduling and production Jina indexing. No deployment or production mutation was performed. The running harness does not substitute for Cloudflare durable-engine replay or a real PostgreSQL/Jina integration run. Unit tests exercise the service eligibility and revision guards; the standalone harness writes local body and index artifacts. Frontend templates/styles/contracts were not changed, and no UI acceptance is claimed. Podcast runner regression tests passed, but no additional live podcast audio transcription was run.

## Local pre-push review

Bugs: checked provider finish reasons and usage before acceptance, bounded recovery, single generation path, complete source identity, concurrent accounting, body eligibility and ready-state preservation. Added a persistent publication retry record after finding that step-level indexing retries alone could leave work unqueued after exhaustion.

Security: fixed outbound provider endpoint, bearer key only in the request header, redirect rejection, sanitized provider errors, no source text or credentials in routine logs; no dependency additions.

Compliance: change `deliver-youtube-translations` implements the conversation-approved redesign and later DeepSeek-only provider choice. Real model and controlled verification are reported separately; skipped integrations and deployment limits are explicit. No Important findings remain in these passes; automated PR review remains pending until the PR opens.
