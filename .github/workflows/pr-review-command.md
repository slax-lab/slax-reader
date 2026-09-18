---
name: PR Review (on demand)
description: Re-runs the pull request review when somebody comments /review.
# Separate from the automatic review workflow on purpose: a workflow that carries a
# slash_command trigger also applies gh-aw's command-position check to the pull
# request body, which silently skipped every automatic review (observed on #18:
# "None of the commands [/review] matched the first word (found: '##')"). Inline
# strategy is fine here because this workflow has no pull_request trigger; note
# that comment-triggered workflows run from the default branch, so /review only
# works once this file is on `main`.
on:
  slash_command:
    name: review
    events: [pull_request, pull_request_comment]
  status-comment: false

permissions:
  contents: read
  pull-requests: read
  copilot-requests: none

if: vars.PR_REVIEW_ENABLED != 'false'

concurrency:
  group: pr-review-command-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true

timeout-minutes: 20

imports:
  - shared/pr-review-core.md
---

Review the pull request described by the imported instructions.
