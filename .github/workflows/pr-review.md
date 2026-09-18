---
name: PR Review
description: Automated, policy-driven pull request review on our own DeepSeek key.
# The gate workflow parses "#<n>" from this run name to find the reviewed pull
# request (design D4).
run-name: "PR review for #${{ github.event.pull_request.number || github.run_id }}"
on:
  pull_request:
    # `reopened` is included so a reopened pull request is reviewed again.
    types: [opened, ready_for_review, reopened]
    # Drafts are excluded: `opened` also fires for drafts, which would review the
    # same pull request twice (once as a draft, once at ready_for_review).
    draft: false

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
  # No cancel-in-progress: a cancelled run is not a passing required check, so a
  # superseded run must be allowed to finish rather than being cancelled.
  group: pr-review-${{ github.event.pull_request.number || github.run_id }}

timeout-minutes: 20

imports:
  - shared/pr-review-core.md
---

Review the pull request described by the imported instructions.
