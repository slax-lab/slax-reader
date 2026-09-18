---
name: PR Review
description: Automated, policy-driven pull request review on our own DeepSeek key.
on:
  pull_request:
    # `reopened` is included so a reopened pull request is reviewed again.
    types: [opened, ready_for_review, reopened]

permissions:
  contents: read
  pull-requests: read
  # Inference is billed by DeepSeek through BYOK, never by GitHub-hosted routing.
  copilot-requests: none

# Pause switch: an operator flips this repository variable to stop reviews for a
# day. A skipped job still reports a passing result for required checks, which is
# why pausing must not be done by disabling the workflow.
if: vars.PR_REVIEW_ENABLED != 'false'

concurrency:
  group: pr-review-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true

timeout-minutes: 20

imports:
  - shared/pr-review-core.md
---

Review the pull request described by the imported instructions.
