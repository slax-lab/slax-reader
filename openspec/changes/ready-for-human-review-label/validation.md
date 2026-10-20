# Validation — ready-for-human-review-label

Date: 2026-10-20

Change type: CI workflows plus a notification contract (observable behavior: pull-request labels and the Feishu review announcement). UI-visible: n/a — no application UI. Human hands-on acceptance: n/a — there is no UI surface; the GitHub pull request page is the running environment.

## Commands run

- `python3` YAML load of `.github/workflows/pr-review-gate.yml` and `.github/workflows/ready-for-review-label.yml` with `yaml.BaseLoader`, plus structural assertions on the gate's `permissions.issues`, the step's `READY_LABEL`, the companion's `on.pull_request.types` and its single job → passed.
- `pnpm exec openspec validate --all --strict` → 70 passed, 0 failed (branch head; the count includes every active change in the repository).
- `git diff origin/dev...HEAD` reviewed line by line against the change's delta-spec scenarios (label add, label removal, superseded result, draft exclusion, companion events, non-effect on mergeability).

## What was exercised

- Both workflow files and the OpenSpec change were statically validated (above).
- The companion removal workflow ran in a running environment on this pull request's `synchronize` event: run 39400716498 completed successfully, exercising the expected-404 delete path.
- The repository's configuration guard on this pull request (`agent-config drift check`) passed, which exercised the pinned strict OpenSpec validation and the OpenSpec skill drift guard against a change that edits OpenSpec artifacts.
- The declared behaviour of the label itself is exercised end-to-end only after this pull request merges; see the declared gaps.

## Not validated (declared gaps)

- **The gate's label add/remove path cannot run before merge.** `workflow_run`-triggered workflows execute the definition from the default branch (`dev`), so the edited `pr-review-gate.yml` is only live after this pull request merges. Reason: GitHub's default-branch rule for `workflow_run`.
- **The companion removal workflow** (`ready-for-review-label.yml`) runs on this pull request's `pull_request` events once the pull request exists; `opened` is deliberately not one of its triggers. Observed on this pull request: the `synchronize` event from commit `a9d5114` produced a successful run (run 39400716498) that exercised the delete path with the label absent (expected 404). A non-trivial removal (label present) still requires a pull request that has been gated, which requires the merge above.
- **The Feishu announcement** depends on `slax-lab/slax-notify-bridge` being deployed with the consuming policy change after this pull request merges. Its real-machine checks are tracked in that repository as V15–V17 and here as tasks 2.2–2.5.

## Review round 1 (PR #301, 2026-10-20)

The automated review reported **no Important findings** and five Nits. Four were fixed before the next push:

- `gh label create` now passes `--repo "$REPO"`; without it the call fails in a job with no checkout and the label would silently keep GitHub's default colour and description.
- The gate now also requires the pull request to be open and its head to live in this repository before adding the label; a `/review` finishing after a merge can no longer label a closed pull request, and a fork's read-only companion can never leave a stale label behind.
- The companion workflow's header comment and the docs/spec statements about forks were corrected to match the guards above.
- This evidence trail's stale OpenSpec count and task 1.1's deferred "real gate run" wording were corrected.

One Nit was answered, not fixed: a review run declined *because* the pull request was a draft can label it if the author marks it ready in the seconds before the gate executes (the head does not change, so the superseded-commit guard does not catch it). Closing that window needs the gate to apply its newer-run successor test to the label path as well; that is a larger change to the most sensitive workflow, so it is recorded here rather than folded into this one. The window is seconds long, and the next gate result corrects the label.

## Pre-push review (REVIEW.md, three passes)

- **Bugs**: a passing skip on a draft pull request would have added `ready-for-human-review` to a draft, which cannot enter human review. Fixed before pushing: the gate now reads `.draft` on a passing head and never labels a draft; the docs and delta spec state the exclusion. No other logic, edge-case or regression findings.
- **Security**: the gate gains `issues: write` for label maintenance only; the companion uses `GITHUB_TOKEN` with `issues: write` and constant inputs, interpolates only `github.repository` and the numeric pull-request number, adds no secrets, no new network destinations and no code execution from the pull request.
- **Compliance**: the diff matches `openspec/changes/ready-for-human-review-label` (proposal, tasks, delta spec); the change will be named in the pull request body as `OpenSpec: ready-for-human-review-label`; no task is marked complete without its implementation; the evidence trail is this file plus the pull request Test plan. No UI-visible surface, so no DESIGN.md matrix applies.
