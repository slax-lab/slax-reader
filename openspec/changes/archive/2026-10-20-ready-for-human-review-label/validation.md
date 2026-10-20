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
- Label write permissions were probed on a real pull request with two throwaway workflows: with `issues: write` only (run 39410304244) `gh label create` succeeds but adding/removing a label on the pull request returns 403; with `pull-requests: write` only (run 39410437759) adding and removing the label on the pull request succeeds.
- The declared behaviour of the label itself is exercised end-to-end after merge; the results are in "End-to-end verification after deploy" below.

## Not validated (declared gaps)

- **The draft-decline race stays accepted.** A review run declined *because* the pull request was a draft can label it if the author marks it ready in the seconds before the gate executes. Closing it needs the gate's newer-run successor test applied to the label path; that was out of scope for this change (recorded in review round 1 above). The window is seconds long and the next gate result corrects the label.
- **A real Important-finding verdict was not used to force the gate failure** for task 2.4. The failure path is instead exercised with a deliberately cancelled on-demand review, which the gate fails closed; both end in the same `state=failure` branch that removes the label.

## Real-machine finding: label writes need `pull-requests: write`

Exercising the merged change on a real pull request (scratch PR #303) caught a defect that the static review could not: the gate run posted its status and then failed with `gh: Resource not accessible by integration (HTTP 403)` (gate run 39403843460), so the label was never added and the bridge never announced. The token log showed `Issues: write`, so the obvious permission was present; two throwaway probes against the same pull request isolated the real requirement — a label on a pull request is written through the issues API, but `issues: write` alone only covers repository-level label creation:

- `issues: write` only: `gh label create` exits 0; `POST`/`DELETE /issues/{n}/labels` return 403.
- `pull-requests: write` only: `POST`/`DELETE /issues/{n}/labels` succeed.

The follow-up fix (this pull request) grants `pull-requests: write` to the gate and the companion workflow, keeps `issues: write` on the gate for the label's colour and description, and records the requirement in `docs/CI.md`. The companion workflow had the same gap; its removal calls were silently swallowed by the expected-404 handling, which is why the earlier PR-review rounds read it as healthy.

## End-to-end verification after deploy (2026-10-20)

Environment: `dev` at `64c6b65` (workflows live) and the notification bridge deployed from `slax-notify-bridge` #54. The verification used throwaway docs-only pull requests, closed unmerged; nothing from them persists.

- **Label on a passing gate (task 2.2).** Scratch PR #303: the on-demand `/review` finished, gate run 39411446555 posted success for the current head and added `ready-for-human-review`. The bridge sent exactly one ready card, `om_x100b6240c0ba30accffe59cc680a0d5` (2026-10-20T18:56+08:00, title `#303 ✅ 自动检查通过 · 待人工评审`, mention of Whyjsee, PR/branch/team fields, next step and link). No creation-time card: it is the only message about #303 between 17:40 and 19:05.
- **Removal on a new head and no duplicate announcement (task 2.3).** Push `f2acc20` dropped the label within 15 seconds (companion workflow run success); the new head's gate re-added it, and the group still had exactly one ready card for #303 — the repeated ready state was suppressed by the bridge's per-PR association.
- **Paused reviews (bridge-side V17 context).** With `PR_REVIEW_ENABLED=false`, the review run for scratch PR #306 was `skipped`, the gate passed as "Review not run", the label appeared, and the bridge announced it (`om_x100b6240e8d010a8dd568f5e4f28cd6`, 19:02, mention of Whyjsee). The variable was deleted afterwards.
- **Merge requirements unchanged (task 2.5).** The release-branches ruleset still requires only `agent-config drift check` and `PR review gate`; the label is not a required context and does not participate in mergeability. #301 and #304 merged with passing gates.
- **Failure removes the label (task 2.4).** A second on-demand `/review` on PR #307 was cancelled while queued (run 39414147103); gate run 39414328159 posted `Review did not start (pre_activation: cancelled); failing closed` at 11:21:15Z and removed the label.
- **Cleanup.** All three pull requests were closed unmerged; the companion workflow removed their labels on close; the scratch branches were deleted.

## Known limitation: an unrelated comment can re-add the label

The gate treats any declined on-demand run as a passing skip, including a run created by an issue comment that does not start with `/review`: the on-demand workflow creates a run, every stage skips, and the gate reports "Review not run (not activated for this run)". Observed on PR #307 right after the task-2.4 failure: the verification comment itself created such a run (gate run 39414410716) and the passing skip re-added `ready-for-human-review` at 11:21:57Z. The same shape can overwrite a failing `PR review gate` status — that is pre-existing gate behaviour, which this change's label inherits.

Fixing it requires the gate to distinguish "declined because the run was never requested" (leave the prior verdict alone) from "declined because reviews are paused" (a passing skip is correct). That is a follow-up change to `pr-review-gate.yml`, out of scope here; until then, treat a label that appears after a failing verdict as suspect and check the gate status history.

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
