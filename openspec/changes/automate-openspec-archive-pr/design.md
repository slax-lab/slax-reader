# Design

## Context

The repository already runs gh-aw with a pinned compiler, a DeepSeek-backed Copilot engine, read-only agent tokens, Safe Outputs, and generated lock-file drift checks. The review gate adds `ready-for-human-review`, and `slax-notify-bridge` announces that label to the existing Feishu group. The bridge currently drops events from `github-actions[bot]` because that login is absent from `TEAM_MEMBERS`.

OpenSpec archiving needs judgment for unchecked-task classification and same-capability ordering, so a deterministic move-only script is insufficient. A new cloud agent run is required because the original implementation session may no longer exist when the task PR merges. The generated PR, rather than a direct push or automatic merge, is the write boundary.

## Goals / Non-Goals

**Goals:**

- Start archive evaluation from the actual merge event and from an explicit manual replay for recovery and verification.
- Keep task classification and spec merging subject to evidence and strict validation.
- Serialize archive writes and bound their external effect to one reviewable documentation PR.
- Reuse the existing engine, review readiness, notification, and human-merge paths.
- Make the bridge roster change operational before the first real archive PR can be created.

**Non-Goals:**

- A general-purpose autonomous agent for resolving implementation work or spec conflicts.
- A deterministic script that infers task completion from checkbox counts alone.
- Changes to the existing review-gate semantics or notification-card design.
- Bulk processing of the historical backlog.

## Decisions

### D1. Use `pull_request.closed` plus a bounded manual replay

The workflow triggers on `pull_request` `closed` with `branches: [dev]`, and its job requires `github.event.pull_request.merged == true`. The branch filter applies to the PR base. A `workflow_dispatch` input, `issue_number`, allows an operator to replay a merged task PR for recovery and isolated trials without adding a second automatic trigger.

The agent reads the PR body and resolves the exact `OpenSpec:` line to one active change directory. It skips `n/a`, malformed or ambiguous identities, unmerged closures, missing active changes, and archive PRs. A repository-wide concurrency group serializes evaluations with no cancellation; a per-PR identity is used for logs and duplicate checks.

Alternative considered: a `push` trigger on `dev`. Rejected because recovering the originating PR and its change identity is less direct, and batch or promotion pushes do not have the required one-task semantics.

### D2. Let the agent classify, and make commands prove the result

The agent reads `proposal.md`, `tasks.md`, `design.md` when present, `validation.md`, delta specs, and the originating PR. It classifies each unchecked task as evidence-backed completion, an accepted historical gap, or genuine unfinished work. Only the first category may be checked off, with the evidence added to `validation.md`. Uncertain or unfinished work blocks the archive and produces a report on the originating PR.

The agent checks active same-capability deltas on the latest `dev` state and honors declared sequencing. It does not invent requirement text or force a conflict resolution. Once eligible, it runs `openspec archive <change-id> --yes`, records the archive outcome in the archived `validation.md`, and requires both `openspec validate --all --strict` and `git diff --check` to pass. It also checks that the diff is limited to the intended OpenSpec archive and living-spec outputs.

Alternative considered: archive whenever the CLI reports all tasks complete. Rejected because the current backlog contains stale checkboxes, post-merge verification, and dependency constraints that checkbox counts cannot classify.

### D3. Publish only through Safe Outputs

The agent receives read-only repository and PR permissions. It requests `create-pull-request` with title prefix `docs(openspec): archive ` and `team-reviewers: [reader-core]`; a separate safe-output job performs the branch and PR writes. It may use `add-comment` on the originating PR to report a blocker or an existing archive PR. No merge, approval, direct-push, issue-creation, or Feishu output is enabled.

Before creating a PR, the agent searches for an existing open PR with the same archive title and change identity and reports it instead of duplicating it. The workflow has a time budget and a pause switch, `OPENSPEC_ARCHIVE_ENABLED != 'false'`, matching the repository's existing operational pattern. It has no automatic retry loop.

Alternative considered: a direct GitHub script that pushes an archive branch. Rejected because task classification needs agent judgment and Safe Outputs preserves a narrower agent write boundary.

### D4. Extract only the shared DeepSeek engine configuration

A shared gh-aw import will own the engine, sandbox model fallback, model pricing, and AI budget currently embedded in `shared/pr-review-core.md`. Both the existing review core and the new archive workflow will import it. Repository-specific network access, GitHub tools, Safe Outputs, prompts, and verdict jobs remain in their respective workflows.

This avoids two copies of model and budget configuration without widening the archive agent's network or publishing capabilities. Generated lock files for all affected workflows are regenerated with the pinned gh-aw version and checked by the existing drift guard.

### D5. Reuse readiness notification, and sequence the bridge change first

The archive PR needs no archive-specific notification code. Its `slax-lab/reader-core` team review request is included in the PR payload; after the existing gate adds `ready-for-human-review`, the bridge sends its normal group card naming that team without mentioning an individual.

The default Safe Outputs author is `github-actions[bot]`. A separate `slax-notify-bridge` OpenSpec change will add that actual identity to `TEAM_MEMBERS`, update its current documentation and verification ledger, pass its verification suite, merge, and deploy before the main repository PR is allowed to merge. If the final implementation uses a different token identity, the bridge change uses the observed author login instead of assuming the default.

Deployment order:

1. Build and locally validate both repository changes.
2. Obtain the separate bridge proposal approval, then merge and deploy the bridge roster change.
3. Exercise the main workflow in an isolated gh-aw trial with a cloned repository and a known merged, archive-eligible change; pass that source PR through `--trigger-context`, which gh-aw maps to the workflow's `issue_number` input, and inspect the generated PR and captured notification-relevant fields.
4. Open and merge the main workflow PR. Its own merge is the first live trigger and should generate the archive PR for `automate-openspec-archive-pr`.
5. Confirm the real archive PR, gate readiness, and Feishu group card naming `slax-lab/reader-core`. Human review and merge of that archive PR completes this change.

Rollback: set `OPENSPEC_ARCHIVE_ENABLED=false` to stop new evaluations. Existing archive PRs remain ordinary reviewable branches; close an unmerged one to leave `dev` unchanged. Reverting the bridge roster entry is separate and does not delete already sent notifications.

### D6. Remove the archive-checkbox obligation without moving archive earlier

Edit `.rulesync/rules/overview.md` so post-merge archiving remains mandatory but `tasks.md` no longer needs a final archive item. Regenerate the agent entry files. Add apply guidance in `openspec/config.yaml` distinguishing implementation completion from post-merge archiving. Existing unchecked tasks still require classification; this change does not retroactively mark them complete.

### D7. Keep this change's live rollout observations out of its archive eligibility tasks

The first live archive evaluation cannot depend on tasks that require its own archive PR as evidence. This change therefore completes its implementation and isolated-trial acceptance before the main PR opens. Real trigger, archive-PR, readiness-label, Feishu-notification, and local-cleanup observations remain mandatory rollout evidence in `validation.md` and the archive PR, but they are not unchecked implementation tasks in `tasks.md`. This preserves the live checks without making the first automatic archive block on its own output.

## Risks / Trade-offs

- [Agent misclassifies an unchecked task] → Require explicit evidence, block on uncertainty, and expose the classification in both `validation.md` and the archive PR for human review.
- [Two merge events race on one capability] → Serialize all archive evaluations and reassess current `dev` before every archive.
- [A replay duplicates an archive PR] → Check the active-change state and existing open archive PR before writing.
- [The agent produces an over-broad diff] → Restrict the expected output surface, run strict validation and diff checks, and let Safe Outputs create only a human-reviewed PR.
- [The first archive PR is invisible] → Deploy the bridge roster change before merging the main workflow and verify the real ready-label card.
- [The live trigger fails only after the main PR merges] → Keep the pause switch and manual replay, and record any live gap rather than claiming success from compilation alone.
- [Global serialization delays independent archives] → Accept the small delay because archive frequency is low and spec correctness is more important than parallel throughput.
