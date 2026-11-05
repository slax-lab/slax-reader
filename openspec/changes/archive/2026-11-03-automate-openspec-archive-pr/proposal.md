# Proposal

## Why

Merged task pull requests are accumulating as active OpenSpec changes because archiving depends on an author agent returning after the merge, but no execution trigger exists at that point. Requiring a final archive checkbox also leaves otherwise complete changes permanently `in-progress`, so the built-in completion signal cannot provide a useful handoff.

## What Changes

- Add a merge-triggered agentic workflow for task pull requests merged into `dev`. Read the `OpenSpec: <change-id>` identity, inspect the merged change, and create a documentation archive pull request instead of relying on the original agent session.
- Archive only after classifying unchecked tasks and same-capability dependencies. Report blockers without archiving, automatically checking off uncertain work, or bypassing spec-sync ordering.
- Run strict OpenSpec validation on the archive result and publish the archive through gh-aw Safe Outputs with the `slax-lab/reader-core` team as reviewer. Do not merge the archive pull request automatically.
- Remove the requirement for every `tasks.md` to end with an archive checkbox, and clarify that completed implementation tasks make a change ready for its task pull request while archiving still waits for merge.
- Route the generated archive pull request through the existing ready-for-human-review notification path. In `slax-notify-bridge`, make the actual archive-bot identity eligible for team notifications through a separately reviewed configuration change; no direct Feishu integration is added to this repository.
- Triage the existing active-change backlog separately. Do not bulk-archive it as part of enabling the workflow.

### Non-goals

- Self-contained archiving inside the implementation pull request.
- Automatic approval or merge of archive pull requests.
- Automatic resolution of uncertain tasks, same-capability conflicts, or failed validation.
- Direct messages to reviewers, additional notification groups, a second reminder system, or a new archive dashboard.
- Application package-version changes.

## Capabilities

### New Capabilities

- `openspec-change-archiving`: Merge-triggered archive eligibility, task and dependency classification, validated documentation pull request creation, human completion, and reviewer notification for archived OpenSpec changes.

### Modified Capabilities

None.

## Impact

- New `.github/workflows/openspec-archive.md` source and its generated gh-aw outputs, plus focused workflow tests or checks where the repository already has a matching test surface.
- Updated `.rulesync/rules/overview.md` and regenerated agent entry files, and updated `openspec/config.yaml` apply guidance.
- New change artifacts and validation evidence for `automate-openspec-archive-pr`.
- A separate, sequenced `slax-notify-bridge` OpenSpec configuration change for the archive-bot roster entry and its operational documentation.
- GitHub Actions, gh-aw Safe Outputs, the existing pull-request review gate and ready-label workflow, and the existing Feishu notification bridge.
