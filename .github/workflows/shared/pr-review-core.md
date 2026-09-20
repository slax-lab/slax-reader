---
# Shared core for the PR review workflows (auto + on demand). Wrappers declare the
# trigger, permissions and pause switch; everything below is identical for both. Drill.
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
    # `actions` is what lets a review that touches CI read workflow runs, which the
    # `repos`/`pull_requests` toolsets do not cover. Without it the agent reaches
    # for `curl https://api.github.com/...`, the firewall blocks it, and the run
    # carries a "Firewall blocked 1 domain" warning into its published review.
    #
    # The widening was considered on purpose: `actions` also brings `get_job_logs`,
    # which pulls arbitrary job logs from this repository into the agent's context,
    # and the agent's output is published as a public review. The agent token is
    # read-only, GitHub masks secrets in logs, and this repository's CI logs must
    # not carry secrets — the narrower alternative the framework itself suggested
    # (adding api.github.com to network.allowed, or `tools.github.mode: gh-proxy`
    # for a pre-authenticated `gh`) would widen more: the first opens the network,
    # the second hands the agent a working GitHub client and weakens the
    # safe-outputs write boundary.
    toolsets: [repos, pull_requests, actions]
  # The review needs to inspect files and diffs; the agent runs sandboxed with a
  # read-only token and an allowlisted network, which is the boundary that matters.
  bash: [":*"]

safe-outputs:
  # Review failures must surface as a failing status check, never as repository issues.
  report-failure-as-issue: false
  # Threat detection flags output that looks like a hijack attempt. By default it
  # only warns: the review is published with a caution banner and a human has to
  # notice — that is what warn-mode drill PR #47 produced. We chose **blocking**
  # instead, so a flagged output fails the run and nothing is published; the gate
  # then fails closed. Blocking drill PR #59 is the run that shows the difference.
  # The cost is accepted deliberately: a false positive drops that review rather
  # than showing it with a warning banner.
  threat-detection:
    continue-on-error: false
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

# Budget guardrails. `max-ai-credits` is enforced by the API proxy per run (it
# prices every request) and skips the rest of a run when hit. `max-daily-ai-credits`
# is configured but inert for this BYOK model: gh-aw v0.88.7's activation guardrail
# computes zero AI credits for these runs, verified on the drill PR #46 where the
# agent ran with the cap set to 1. Do not rely on it; see task 8.5 of the change.
max-ai-credits: 300
max-daily-ai-credits: 2000
---

# Pull request review

You review **one** pull request and publish exactly one consolidated review.

## Policy is external — read it, never restate it

`REVIEW.md` at the repository root is the single source of truth for review policy. Read it from the checked-out head branch of this pull request before you review anything, and apply it exactly: the passes it defines, its severity calibration, its per-review finding limits, its recurring-pattern tag, and its exclusions. If your own habits disagree with `REVIEW.md`, `REVIEW.md` wins. Do not invent policy that is not in that file.

## What to review

1. Identify the pull request that triggered this run and read its **full** diff — and every file you judge it against — with the GitHub pull request tools. Treat the worktree as unreliable for that purpose: what the checkout holds, including its copies of `.github/**`, `.agents/**` and `AGENTS.md`, depends on how the run was triggered (the framework snapshots those paths from `github.ref`, which differs between the automatic and on-demand paths), so do not infer it — read through the tools instead. If you do use git, resolve the range explicitly (for example `git diff "$(git merge-base origin/main HEAD)"..HEAD` when that base ref exists) and check it against the tools' file list before relying on it. Never review a partial or stale version silently: if you cannot obtain the whole diff, say so in the review instead of reviewing what you happen to have.
2. Run the passes `REVIEW.md` defines over the changed code, reading surrounding files whenever the diff alone is not enough to judge a change.
3. Run the compliance pass `REVIEW.md` defines: find the `OpenSpec:` line in the pull request body and, when the policy counts this pull request as behavior-changing, read the referenced change under `openspec/changes/<change-id>/` and compare it with what the pull request actually implements. Report a missing reference or a divergence at the severity the policy assigns.
4. Respect the policy's exclusions. Do not report anything it tells you to leave to CI.

## How to reach GitHub (sandbox)

All GitHub reads go through the GitHub tools above. The sandbox has no network route to GitHub — the `gh` CLI, `curl https://api.github.com/…` and `git fetch` from a remote fail — so never spend a turn on them: a blocked attempt only adds a "Firewall blocked …" warning to the review you publish. If a tool does not answer a question (for example a workflow-run detail), say in the review that you could not check it rather than guessing.

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
