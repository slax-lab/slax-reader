---
name: OpenSpec Change Archiving
description: Evaluate merged task PRs and create reviewed OpenSpec archive PRs.
run-name: "OpenSpec archive for #${{ github.event.pull_request.number || inputs.pr_number || github.run_id }}"
on:
  pull_request:
    types: [closed]
    branches: [dev]
  workflow_dispatch:
    inputs:
      pr_number:
        description: Merged task pull request number to re-evaluate
        required: true
        type: number

permissions:
  contents: read
  pull-requests: read
  copilot-requests: none

if: vars.OPENSPEC_ARCHIVE_ENABLED != 'false' && (github.event_name != 'pull_request' || github.event.pull_request.merged == true)

concurrency:
  group: openspec-archive-dev
  cancel-in-progress: false

timeout-minutes: 30

imports:
  - shared/deepseek-engine.md

network:
  allowed:
    - defaults
    - api.deepseek.com
    - registry.npmjs.org

tools:
  github:
    toolsets: [repos, pull_requests]
  bash: [":*"]

safe-outputs:
  report-failure-as-issue: false
  threat-detection:
    continue-on-error: false
  noop:
    report-as-issue: false
  add-comment:
    max: 1
    target: "*"
  create-pull-request:
    title-prefix: "docs(openspec): archive "
    team-reviewers: [reader-core]
---

# OpenSpec change archiving

You evaluate one merged task pull request and, only when eligible, request one documentation archive pull request. You do not resume the implementation task and you never approve or merge a pull request.

## Resolve the source and change

1. Resolve the source PR number from `github.event.pull_request.number` for an automatic run or `inputs.pr_number` for a manual replay. Read that PR with the GitHub tools. Confirm that it is merged into `dev`; if it is open or closed without merge, stop with `noop`.
2. Read the PR body and find exactly one line matching `OpenSpec: <change-id>`. For `OpenSpec: n/a`, a missing or malformed line, or multiple conflicting identities, stop with `noop`. Do not infer a change from the branch name or title.
3. Search for an existing open archive pull request whose title is `docs(openspec): archive <change-id>`. If one exists, report its URL on the source PR with `add_comment` and stop. Do not create a duplicate.
4. Work from the checked-out merged `dev` state. If `openspec/changes/<change-id>/` is absent, the change is already archived or invalid; stop with `noop`. Never use a local task worktree or the original agent session as an input.

## Classify archive eligibility

Read `proposal.md`, `tasks.md`, `design.md` when present, `validation.md`, and every delta spec under the active change. Read the source PR's evidence when needed. Apply all of these rules:

- Classify every unchecked task before archiving. Only evidence-backed completed work may be checked off, and the evidence must be added to `validation.md`.
- Preserve an accepted historical gap as unchecked with its reason and acceptance record. Do not present it as completed work.
- Genuinely unfinished or uncertain work blocks archiving. An unverified post-merge task blocks archiving. Do not silently check off, drop, narrow, or archive around it.
- Run `openspec list --json` and inspect every other active change for delta specs affecting the same capability. Honor each declared archive order. If the candidate must wait, or no safe order is established, block archiving. Do not invent requirement text or force a spec conflict resolution.
- A new evaluation must reassess the current `dev` state even when the source PR merged earlier.

When blocked, do not modify files or request an archive PR. Report the concrete task or dependency and the missing evidence or required order in one `add_comment` on the source PR.

## Archive and verify

For an eligible change:

1. Use the pinned OpenSpec CLI with `npx --yes @fission-ai/openspec@1.13.1`. The required archive operation is `openspec archive <change-id> --yes`; invoke it through that pinned package. Do not hand-move the change or hand-merge delta specs.
2. Record the archive outcome, task classifications, spec updates, command results, and any remaining accepted gaps in the archived change's `validation.md`. Create that file in the archive when no prior validation record exists.
3. Run `openspec validate --all --strict` through the same pinned CLI and run `git diff --check`. Both must pass.
4. Inspect `git status` and the complete diff. It must contain only the intended dated archive, living-spec updates, and archive evidence. If any command fails or the diff is broader or semantically wrong, stop without requesting a PR and report the failure on the source PR.

## Publish

For a successful archive, call `create_pull_request` once. Set its title to `<change-id>` so the configured prefix produces `docs(openspec): archive <change-id>`. Its body must use the repository PR structure and include:

- a change summary naming the archived change and source PR;
- `OpenSpec: n/a` because this is a documentation-only archive PR;
- the spec updates and every unchecked-task classification;
- the exact successful validation commands and results;
- any preserved historical gaps and remaining review considerations.

The configured Safe Output requests `reader-core` as the team reviewer, which the existing notification path names as `slax-lab/reader-core` without an individual Feishu mention. Do not call any merge, approval, direct-push, issue-creation, review-submission, or notification tool. Do not retry automatically and do not create a second archive PR.
