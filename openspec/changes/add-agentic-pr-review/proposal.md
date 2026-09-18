# Add agentic PR review (gh-aw + own DeepSeek key)

## Why

PR review is currently 100% manual, even though `REVIEW.md` now pins down the review policy (passes, severity calibration, finding limits, compliance pass against the PR's linked OpenSpec change). Nothing executes that policy automatically, so reviewers re-derive it on every PR (e.g. #8, #9) and the compliance pass is easy to skip.

GitHub-hosted Copilot code review is not a viable executor for us: the org is on the **Free** plan (org rulesets unavailable), Copilot Business has **0 seats**, and the repository's only ruleset (`protect`) has no `copilot_code_review` rule — and even if it did, that product uses a fixed GitHub-tuned model mix and **does not support BYOK**, so our own key could never back it.

So we run the review ourselves: a GitHub Agentic Workflows (`gh-aw`) workflow whose Copilot engine runs in BYOK mode against our **DeepSeek** key (`deepseek-flash`, i.e. DeepSeek-V4.1-Flash, released 2026-09-10 — 1M context, tool calling, ~$0.15/M off-peak input and $0.6/M output).

## What Changes

- Add a `gh-aw` source workflow `.github/workflows/pr-review.md` plus its compiled `.github/workflows/pr-review.lock.yml`; both are committed (the lock file is required by Actions).
- **Engine**: `engine: copilot` with BYOK — `COPILOT_PROVIDER_BASE_URL: https://api.deepseek.com`, `COPILOT_MODEL: deepseek-flash`, `COPILOT_PROVIDER_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}`.
- **Triggers**: automatically once per PR on `opened` / `ready_for_review`, plus a manual `/review` slash command for re-runs. No run on every push.
- **Fork PRs are skipped** (gh-aw's default inbound-fork behavior). Fork PRs still must not be blocked by the required check this change introduces.
- **Review content is policy-driven**: the prompt reads `REVIEW.md` from the pull request's head branch and applies it as the review policy (passes, severity calibration, finding limits, recurring patterns, exclusions), then performs that policy's compliance pass against `openspec/changes/<change-id>/` using the `OpenSpec:` line in the PR body. The policy's contents stay in `REVIEW.md`; this change does not restate them.
- **Output**: exactly one PR review comment via `safe-outputs` (no direct write access for the agent, no PR approvals, no code suggestions applied automatically).
- **Gating**: the workflow exposes a required status check that fails when the review reports at least one Important finding and passes otherwise — including when the review is skipped (non-skippable skip path, so fork PRs and forks never leave the check pending).
- **Repo settings**: the `protect` ruleset gains that required check (performed by a repo admin, not by this change's code).
- **Config corrections specific to DeepSeek**: `sandbox.agent.model-fallback: false` (AWF's model catalog would otherwise rewrite the unrecognized `deepseek-flash` and return 404) and `api.deepseek.com` in `network.allowed` (required because the provider URL is passed via a secret expression).
- **Pause switch**: a repository variable `PR_REVIEW_ENABLED` gates the whole workflow — automatic reviews and `/review` re-runs alike — so an operator can stop reviews for a day with one settings change: no commit, no recompile, no new run. While paused the merge gate still reports a passing result, so merges keep flowing.
- **Budget guardrails**: explicit per-run and daily AI-credit caps (`max-ai-credits`, `max-daily-ai-credits`) bound what a runaway loop or a busy day can spend. Hitting a cap skips the agent job rather than leaving the required check unreported.

## Capabilities

### New Capabilities

- `agentic-pr-review`: automatic, policy-driven PR review — when it runs, what it must read and report, how it writes back to the PR, and when it blocks a merge.

### Modified Capabilities

None — `openspec/specs/` is still empty, so this change introduces the first capability.

## Impact

- **New files**: `.github/workflows/pr-review.md`, `.github/workflows/pr-review.lock.yml`.
- **New secret**: `DEEPSEEK_API_KEY` (repository secret; the key itself is never committed).
- **External dependency**: the `gh-aw` CLI (author-side authoring/compile tool) and, at runtime, the `@github/copilot` CLI + AWF containers installed by the lock file.
- **Settings**: repository variable `PR_REVIEW_ENABLED` (the pause switch), and the `protect` ruleset gains one required status check; without the ruleset change the gate has no effect, and with it the check must always report — hence the pause switch rather than disabling the workflow.
- **Cost**: DeepSeek tokens per review (off-peak $0.15/M cache-miss input, $0.6/M output) plus Actions minutes, which are free for this public repository; per-run and daily AI-credit caps bound the worst case.
- **Risks**: `deepseek-flash` is absent from AWF's model catalog; the Copilot CLI requires tool calling and streaming from the provider; a required check that is never reported would block all merges; running the review on untrusted PR content is only safe because the agent is sandboxed with read-only permissions and writes through `safe-outputs`; AI-credit accounting is an estimate and can differ from the provider's real bill.
