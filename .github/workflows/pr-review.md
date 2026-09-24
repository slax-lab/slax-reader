---
name: PR Review
description: Automated, policy-driven pull request review on our own DeepSeek key.
# The gate workflow parses "#<n>" from this run name to find the reviewed pull
# request (design D4).
run-name: "PR review for #${{ github.event.pull_request.number || github.run_id }}"
on:
  pull_request:
    # `reopened` is included so a reopened pull request is reviewed again, and
    # `synchronize` so a push to an open pull request re-reviews the pushed head.
    # Pushes on fork heads and drafts still start nothing: the compiled activation
    # carries the same-repository-head and draft guards for every event type.
    types: [opened, ready_for_review, reopened, synchronize]
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
  # No cancel-in-progress: a superseded in-progress run finishes rather than
  # being cancelled. GitHub still replaces the queued pending run on the next
  # push, so intermediate heads are never reviewed; the merge gate recognizes
  # that cancelled-and-superseded shape and stays silent for it (design D5).
  group: pr-review-${{ github.event.pull_request.number || github.run_id }}

timeout-minutes: 20

imports:
  - shared/pr-review-core.md
---

Review the pull request described by the imported instructions.
