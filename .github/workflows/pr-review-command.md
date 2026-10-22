---
name: PR Review (on demand)
description: Re-runs the pull request review when somebody comments /review.
# The gate workflow parses "#<n>" and "comment <id>" from this run name — the
# pull request it must report on and the comment that triggered the run. Both
# are essential here: this workflow runs from the default branch (issue_comment),
# so the run's head SHA is not the pull request head, and the gate's workflow_run
# payload does not carry the comment (design D4). The comment id is what lets the
# gate confirm that a declined run was actually a requested review before it
# reports anything for it.
run-name: "PR review (on demand) for #${{ github.event.issue.number || github.run_id }} comment ${{ github.event.comment.id || 'none' }}"
# Separate from the automatic review workflow on purpose: a workflow that carries a
# slash_command trigger also applies gh-aw's command-position check to the pull
# request body, which silently skipped every automatic review (observed on #18:
# "None of the commands [/review] matched the first word (found: '##')"). Inline
# strategy is fine here because this workflow has no pull_request trigger; note
# that comment-triggered workflows run from the default branch, so /review only
# works once this file is on the default branch.
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
  # No cancel-in-progress: a cancelled run is not a passing required check.
  group: pr-review-command-${{ github.event.pull_request.number || github.run_id }}

timeout-minutes: 20

imports:
  - shared/pr-review-core.md
---

Review the pull request described by the imported instructions.
