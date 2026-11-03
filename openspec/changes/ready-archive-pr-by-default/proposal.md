# Proposal

## Why

The first live archive PR was created as a draft. That prevented the configured team-review request from taking effect and excluded the PR from the existing readiness gate, requiring an unplanned manual ready-for-review transition before the intended review flow could start.

## What Changes

- Create archive pull requests in the ready-for-review state by explicitly disabling gh-aw's draft default.
- Preserve the default `GITHUB_TOKEN`, read-only agent, `slax-lab/reader-core` team reviewer, and human-controlled merge boundaries.
- Make the archive PR body tell the task PR author how to start workflows: approve the approval-required runs or comment `/review` when an on-demand review is needed.
- Eliminate the manual draft-to-ready transition. After the archive PR is created, the task PR author must still start review by approving the approval-required workflows or commenting `/review`. If review is already running, no additional start action is needed.
- Allow `github-actions[bot]` as an actor only in the automatic PR Review workflow, so approving those workflows also allows the review agent to execute. Do not add the bot to the on-demand `/review` command workflow.
- Update operational documentation and generated workflow contracts to distinguish non-draft creation from readiness after the review gate.
- A separate, sequenced `slax-notify-bridge` change will send the new start-review instruction directly to the task PR author. This repository change does not implement that notification.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-change-archiving`: archive pull requests must be created as non-draft, request the review team successfully, and present clear workflow-start instructions before the existing readiness notification.
- `agentic-pr-review`: the automatic review workflow admits the archive bot after human workflow approval while the on-demand command path remains unchanged.

## Non-goals

- No PAT, GitHub App credential, empty-commit trigger, or new repository secret.
- No automatic approval, merge, or readiness-label mutation by the archive agent.
- No bot allowlist in `pr-review-command.md` and no change to existing readiness-card or review-gate semantics.
- No bridge code changes in this repository.

## Impact

- `.github/workflows/openspec-archive.md`, `.github/workflows/pr-review.md`, and their generated lock files.
- `tooling/openspec-archive-workflow.test.mjs`, the PR review workflow contracts, and the existing Tooling CI command.
- `docs/CI.md` plus the `openspec-change-archiving` and `agentic-pr-review` living specifications.
- The next live archive PR, used to verify non-draft creation, team review request, and the documented workflow-start choices.
