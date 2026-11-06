# Validation

Date: November 6, 2026. Branch: `fix/youtube-translation-delivery`, originally based on `origin/dev` at `dd30199e`; synchronized with `origin/dev` at `b63b379c` before the final push.

## Configuration and scope

All text generation in YouTube and podcast article workflows uses `deepseek-flash` at the fixed `https://api.deepseek.com/chat/completions` endpoint. The only new binding is `DEEPSEEK_API_KEY`. The operator supplies it to the Edge Worker: `slax-read-backend` in production and `reader-backend` in the test account (the deployed service behind `reader-api.slax.dev`, verified through Cloudflare domain bindings). Local Worker configuration belongs in `deploy/local/.dev.vars`. No credentials were printed or committed. Unrelated summaries, chat, moderation, transcription and embeddings retain their providers. No schema, client contract or app package version changes.

## Automated verification

- `pnpm api -- test`: 3,795 passed, 117 skipped across 240 passing and 15 skipped files after synchronization with dev. Skipped tests require separately enabled integration/database environments or optional import fixtures.
- `pnpm api -- typecheck`: passed.
- `pnpm api -- gen:all`: passed using non-secret localhost placeholder database URLs for generation and the checked-in API template. No migration was run.
- Worker environment declarations regenerated from the baseline through `generateWorkerTypes` after removing the proposed API-base option; only `DEEPSEEK_API_KEY` remains.
- Targeted ESLint: zero errors; four existing `any` warnings in the two Workflow adapters.
- `pnpm exec openspec validate --all --strict`: 112 items passed after synchronization with dev.
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

Compliance: change `deliver-youtube-translations` implements the conversation-approved redesign and later DeepSeek-only provider choice. Real model and controlled verification are reported separately; skipped integrations and deployment limits are explicit. No Important findings remain in these passes; PR #527 is open; automated PR review is pending on the synchronized head.

## Synchronization with current dev

Merged `origin/dev` at `b63b379c` (including #525), resolved the eight conflicting files, and compared the final patch against that base. Preserved its media revision/ownership guards, failed-capture recovery and source vector-maintenance calls. The publication recovery sweep also invokes the new vector-maintenance path before indexing. No compatibility selector was introduced. Repeated Bugs, Security and Compliance review of the resolved files found no Important findings.

Repeated the full API suite, typecheck, generation and strict OpenSpec validation after resolution. Both incident fixtures also passed another actual DeepSeek run with exactly one injection each of HTTP 429, empty output, truncation, storage failure, publication failure and indexing failure:

| Video | Result | Local elapsed | Cues / paragraphs | Estimated upper-bound cost |
| --- | --- | --- | --- | --- |
| fsTtKywmWlU | Ready, Chinese | 25.184 s | 1,687 / 129 | $0.032877 |
| yP176MBG9Tk | Ready, Chinese | 24.447 s | 1,318 / 70 | $0.0275007 |

Artifacts: `/tmp/slax-deepseek-delivery/ff18bc6bff1b-live-1793957433388` and `/tmp/slax-deepseek-delivery/3ffbbdd12114-live-1793957458599`. The harness supplies a no-op vector-maintenance callback; remote Jina behavior is covered by the merged regression suites, not claimed as live integration evidence. The other verification limits above still apply.

## Workers redirect incident after PR #527

On November 6, bookmark `f4f6746f-d2b2-49a9-94fc-0fd510cf9433` (video `5_0dVHMpJlo`) failed on the deployed test Worker. Its article Workflow started at 09:59:40.496 UTC and ended at 10:02:51.659 UTC with business output `retry`. All seven chunks exhausted three attempts, reporting `model_request_failed`; two waves of 30 s / 60 s retry delays accounted for approximately 180 s. The 47.964 s bookmark update interval was not translation completion.

The defect was introduced in the DeepSeek client: Workerd rejects `redirect: 'error'` when constructing the outbound request. A direct Workerd reproduction reported `Invalid redirect value, must be one of "follow" or "manual"`. Node accepts this option, so the earlier Node-only live calls and fetch mocks missed the deployment failure. The actual deployed Worker has the DeepSeek key binding; this runtime failure occurs before contacting the provider.

The follow-up uses `redirect: 'manual'` and rejects non-2xx responses through the existing sanitized HTTP error path. Credentials are never forwarded to a redirect destination. Added an actual Workerd regression using the production client and the runtime's outbound-service boundary (no JavaScript fetch stub): it failed before the fix and passes after it. It covers successful JSON, 301/302/303/307/308 rejection, and 401/429/500 errors, asserting exactly one outbound request to the approved endpoint. Added safe provider-code/status logging and a regression proving arbitrary error messages are not logged.

Real provider verification now runs the client inside Workerd with its actual outbound fetch. The surrounding article runner, repository, object storage and publication remain local stand-ins. Command from apps/api:

```sh
node --env-file=../../deploy/local/.dev.vars --import tsx test/runtime/deepseekDelivery.ts --live --workerd /tmp/slax-monitor-f4f6746f/caption.json /tmp/slax-cue-2f114e/caption.json /tmp/slax-dev-stall/new-caption.json
```

| Video | Provider runtime | Result | Local elapsed | Cues / paragraphs |
| --- | --- | --- | --- | --- |
| 5_0dVHMpJlo | Workerd | Ready, Chinese | 29.817 s | 1,321 / 72 |
| fsTtKywmWlU | Workerd | Ready, Chinese | 25.447 s | 1,687 / 129 |
| yP176MBG9Tk | Workerd | Ready, Chinese | 34.995 s | 1,318 / 70 |

Artifacts: `/tmp/slax-deepseek-delivery/dc1d08008673-live-1793960093899`, `/tmp/slax-deepseek-delivery/ff18bc6bff1b-live-1793960123724` and `/tmp/slax-deepseek-delivery/3ffbbdd12114-live-1793960149176`. Complete ordered source coverage and local publication were asserted. These timings still exclude Cloudflare deployment scheduling and remote PostgreSQL/R2/Jina. No remote fix or article retry has been performed yet; test-environment recovery remains unverified pending operator authorization for deployment.

Follow-up checks: `pnpm api -- test` passed 3,803 tests with 117 environment-dependent skips; typecheck, generation, targeted source lint, diff whitespace checks and all 112 strict OpenSpec validations passed. Generated output has no residual diff. Local Bugs/Security/Compliance review of this follow-up found no Important issues; the fixed endpoint, manual redirect rejection, unchanged delivery rules, sanitized diagnostics and explicit runtime evidence match the existing approved change. API-only change; no client package version bump applies.
