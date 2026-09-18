---
# Shared core for the PR review workflows (auto + on demand). Wrappers declare the
# trigger, permissions and pause switch; everything below is identical for both.
engine:
  id: copilot
  env:
    COPILOT_PROVIDER_BASE_URL: https://api.deepseek.com
    COPILOT_PROVIDER_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
    COPILOT_MODEL: deepseek-flash

sandbox:
  agent:
    # Keep AWF from rewriting the model name through its built-in catalog.
    model-fallback: false

# The AWF API proxy prices every request to enforce max-ai-credits. deepseek-flash
# is not in its built-in table, so a fallback rate is mandatory (without it the
# proxy rejects the request with HTTP 400 before it reaches DeepSeek). These are
# DeepSeek V4.1-Flash peak rates in USD per 1M tokens, so AIC over-estimates
# off-peak usage rather than under-estimating it.
models:
  default-ai-credits-pricing:
    input: 0.3
    output: 1.2
    cache_read: 0.006

network:
  allowed:
    - defaults
    - api.deepseek.com

tools:
  github:
    toolsets: [repos, pull_requests]
  # The review needs to inspect files and diffs; the agent runs sandboxed with a
  # read-only token and an allowlisted network, which is the boundary that matters.
  bash: [":*"]

safe-outputs:
  # Review failures must surface as a failing status check, never as repository issues.
  report-failure-as-issue: false
  report-failed-jobs: false
  noop:
    report-as-issue: false
  # Findings are published through review surfaces only: at most one review whose
  # body is the summary, plus inline comments. No conversation comments.
  create-pull-request-review-comment:
    max: 10
  submit-pull-request-review:
    allowed-events: [COMMENT]
    max: 1
  # Deterministic merge gate (design D4). This job's status is the required check
  # that fails when the review reports Important findings; the agent job's status
  # is required alongside it so a crashed run cannot pass silently.
  jobs:
    review-verdict:
      description: "Record the review verdict (Important finding count) so the merge gate can act on it"
      runs-on: ubuntu-latest
      inputs:
        important_findings:
          description: "Number of Important findings the review reported"
          required: true
          type: string
        summary:
          description: "One-line summary of the review"
          required: true
          type: string
      steps:
        - name: Fail the gate when Important findings exist
          run: |
            set -euo pipefail
            if [ ! -f "${GH_AW_AGENT_OUTPUT:-}" ]; then
              echo "::error::No agent output found, so the review verdict is unknown. Failing closed."
              exit 1
            fi
            IMPORTANT=$(jq -r '[.items[] | select(.type == "review_verdict") | (.important_findings | tonumber? // 0)] | max // 0' "$GH_AW_AGENT_OUTPUT")
            SUMMARY=$(jq -r '[.items[] | select(.type == "review_verdict") | .summary] | last // ""' "$GH_AW_AGENT_OUTPUT")
            echo "Verdict: ${IMPORTANT} Important finding(s). ${SUMMARY}"
            if [ "$IMPORTANT" -gt 0 ]; then
              echo "::error::Automated review reported ${IMPORTANT} Important finding(s); this pull request is blocked until they are addressed and the review passes."
              exit 1
            fi
            echo "No Important findings; the gate passes."

# Budget guardrails: bound what a runaway loop or a busy day can spend. Hitting a
# cap skips the agent job, which still reports a passing required check.
max-ai-credits: 300
max-daily-ai-credits: 2000
---

# Pull request review

You review **one** pull request and publish exactly one consolidated review.

## Policy is external — read it, never restate it

`REVIEW.md` at the repository root is the single source of truth for review policy. Read it from the checked-out head branch of this pull request before you review anything, and apply it exactly: the passes it defines, its severity calibration, its per-review finding limits, its recurring-pattern tag, and its exclusions. If your own habits disagree with `REVIEW.md`, `REVIEW.md` wins. Do not invent policy that is not in that file.

## What to review

1. Identify the pull request that triggered this run and read its diff (the GitHub pull request tools or `git diff` against the base branch).
2. Run the passes `REVIEW.md` defines over the changed code, reading surrounding files whenever the diff alone is not enough to judge a change.
3. Run the compliance pass `REVIEW.md` defines: find the `OpenSpec:` line in the pull request body and, when the policy counts this pull request as behavior-changing, read the referenced change under `openspec/changes/<change-id>/` and compare it with what the pull request actually implements. Report a missing reference or a divergence at the severity the policy assigns.
4. Respect the policy's exclusions. Do not report anything it tells you to leave to CI.

## How to publish

- Submit **one** pull request review whose body is your summary, using the `submit_pull_request_review` tool with event `COMMENT`. Use the exact pass names from `REVIEW.md` as headings, and follow its summary conventions.
- Attach inline comments only for specific, concrete problems, using `create_pull_request_review_comment`, and stay within the policy's limits.
- Never approve and never request changes: blocking is the merge gate's job, not yours.
- Do not post conversation comments and do not create issues.

## Verdict (mandatory)

Call the `review_verdict` tool **exactly once**, after you have submitted the review, with:

- `important_findings`: the number of findings the policy classifies as Important (use `0` when there are none), and
- `summary`: one line naming the passes you ran and the outcome.

This call is what moves the merge gate. Omitting it leaves the gate unable to reach a verdict, so never skip it — even when the pull request looks clean.
