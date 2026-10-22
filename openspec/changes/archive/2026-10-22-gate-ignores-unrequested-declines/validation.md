# Validation — gate-ignores-unrequested-declines

Date: 2026-10-22

Change type: CI workflow behavior (the required `PR review gate` status and the `ready-for-human-review` label). No application runtime behavior; UI-visible: n/a — there is no UI surface. Human hands-on acceptance: n/a — the running environment is the GitHub pull request and Actions.

## Commands run

- `gh aw compile --strict --purge --no-check-update` (gh-aw v0.88.7, the repository pin) → `Compiled 2 workflows: 2 succeeded, 0 warnings`; the only lock-file change is `pr-review-command.lock.yml` (run-name line plus the gh-aw metadata hash).
- `bash tooling/check-gh-aw-drift.sh` with the change staged → `Compiled workflows match their sources.`
- `pnpm exec openspec validate --all --strict` → `Totals: 70 passed, 0 failed (70 items)`.
- `python3` YAML load of `.github/workflows/pr-review-gate.yml` and the frontmatter of `.github/workflows/pr-review-command.md` → parsed.
- `pnpm exec rulesync doctor --strict` → no problems; `pnpm exec rulesync generate --check` → all files up to date; `CI=1 pnpm exec openspec update` → no generated-skill drift (`git status` clean for the generated paths).
- Offline gate replay: the new gate script was extracted from the workflow's step `run:` block and executed against recorded GitHub data. A replay `gh` wrapper in `PATH` sends every GET to the real API and intercepts (and logs) every mutation (`-X POST`, `-X DELETE`, `gh label create`), so no status or label was written. For rows that need a run name or comment state the recorded data does not carry, `SYNTHETIC_TITLE` rewrites only the run object's `display_title` and `SYNTHETIC_COMMENT_UPDATED` rewrites only the comment's `updated_at`; jobs, pull request and review reads stay real.

## What was exercised (offline replay against recorded runs)

Replay rows below run the extracted script with `REPO=slax-lab/slax-reader`, `READY_LABEL=ready-for-human-review`, and the listed `RUN_ID`/`PAUSED`/`SYNTHETIC_TITLE`. "Old gate" rows run the `origin/dev` script against the same input for comparison.

| Row | Input | New gate | Old gate |
| --- | --- | --- | --- |
| N1 | run 39414403579, real run name — declined on-demand run created by the prose comment 6289715051 | reports nothing: `was not a requested review (trigger 'none' not confirmed); leaving the status and label untouched` | posts `success — Review not run (not activated for this run)` on `153775b…` (O1) — the incident overwrite |
| N2 | N1 with `PAUSED=true` | reports nothing (no pause exception for an unconfirmed trigger) | posts `success — Review not run (reviews are currently paused)` (O2) |
| N3 | run 39414403579 with synthetic name `… for #307 comment 6289715051` | reports nothing: trigger not confirmed (the comment is prose) | posts `success — Review not run (not activated for this run)` (O3) |
| N4 | run 39414403579 with synthetic name `… for #307 comment 6289543179` (the real `/review` comment on #307) | `was created by an accepted /review request`; classification `success — Review not run (not activated for this run)` | — |
| N5 | N4 with `PAUSED=true` | `success — Review not run (reviews are currently paused)` — the pause keeps its passing skip | posts the same paused skip (O4) |
| N6 | synthetic name with comment 999999999 (does not exist) | reports nothing | — |
| N7 | synthetic name `… for #307 comment 6289414503` (a comment on PR #303) | reports nothing | — |
| N8 | synthetic name `… for #303 comment 6289543179` (the comment belongs to #307) | reports nothing | — |
| N9 | N4's input with the comment's `updated_at` overridden to `11:30:00Z`, after the run's `11:21:46Z` creation | reports nothing (the comment was edited after the run, so it cannot be that run's trigger) | — |
| N10 | automatic fork run 35429105440 | `success — Review not run (not activated for this run)` | unchanged (O10) |
| N11 | automatic draft run 35501003126 | `success — Review not run (not activated for this run)` | — |
| N12 | activated clean review run 35499204394 | `success — Reviewed: no Important findings` | unchanged (O12) |
| N13 | findings failure run 35431067850 | `failure — Review reported Important findings` | — |
| N14 | stale-lock activation failure run 35490678495 | `failure — Review did not start (activation failed at 'Check workflow lock file'); failing closed` | unchanged (O14) |
| N15 | command-workflow `pull_request` run 35499204404 | routing: `not a command. Leaving the status untouched.` | — |
| N16 | manually cancelled run 39414147103 | `failure — Review did not start (pre_activation: cancelled); failing closed` — the same report the incident record shows at 11:21:15Z | — |

Confirmed-trigger rows N4/N5 also exercise the status and label paths: the replay wrapper blocked and logged the `POST /statuses` call and the label `DELETE` for the now-closed PR #307, proving the arm that writes them was reached only for a confirmed request. The unconfirmed rows attempt no mutation at all, and the automatic fork row attempts its status write and label removal exactly as `origin/dev` does.

The confirmation predicates were also exercised directly with local fixtures:

- Body: `/review` → true; `/review please` → true; `/review` + newline → true; `/review\r\n` → false; ` /review` → false; `review` → false; `/reviewx` → false; `please /review` → false.
- Actor: `OWNER`, `MEMBER`, `COLLABORATOR` → true; `CONTRIBUTOR`, `NONE` → false.
- Issue: comment `issue_url` ending `/issues/307` for PR #307 → true; `/issues/303` → false; `/issues/3070` → false.
- Pull request: `repos/slax-lab/slax-reader/issues/307` → `has("pull_request")` true; plain issue #323 → false.
- Timestamp: a comment whose `updated_at` is later than the run's `created_at` is rejected before the body checks (replay N9; the comparison is a plain ISO-8601 string comparison on values of the same shape).

Real comment fixtures used: `/review` comment 6289543179 (`MEMBER`, `issue_url` …/issues/307), prose comment 6289715051 (`MEMBER`, prose body), prose comment 6289414503 (on #303).

## Not validated (declared gaps)

- **Live gate behavior.** `workflow_run` only triggers workflows that exist on the default branch, so the merged gate cannot act on the branch that changes it. The post-merge drills in `tasks.md` 6.1–6.4 are the live evidence and will be recorded in the "Post-merge verification" section below before archive.
- **Run-name rendering at runtime.** That GitHub renders `github.event.comment.id` into the on-demand `display_title` is verified only by the merge and the first live run; it is checked in drill 6.1.
- **Partial jobs-read race (pre-existing).** The jobs API can be read before all jobs appear; the gate then fails closed with a spurious failure (observed on run 39420656163 outside this change). This change neither introduces nor removes that race; its guard relies on the same conclusions the rest of the gate reads.
- **Cancelled-run successors cannot be replayed historically.** The gate's successor query lists workflow runs newest-first, so a month later the immediate successor of run 39414147103 is outside the page the query returns; N16 reproduces the incident-time failure rather than the later supersession. The cancelled path is unchanged by this change.
- **Author-association drift between the comment and the gate read.** The confirmation reads the comment's current `author_association`; the compiled admission used the event's value, which `workflow_run` does not carry. An administrator changing the actor's permission in the seconds between the comment and the gate read can confirm an originally declined request or silence a paused one. The window is tiny and depends on a permission change in it.
- **Same-second comment edits.** GitHub timestamps have second precision, so an edit landing in the same second as the run's creation can evade the `updated_at` check and be confirmed against the edited body. The edit's own run reports separately; this is recorded rather than claimed closed.
- **Membership-declined shape** (`pre_activation: success`, `activation: skipped`) has no recorded runtime sample; it keeps the existing passing-skip behavior and is unchanged structurally.

## Pre-push review (REVIEW.md, three passes)

- **Bugs**: the replay table above is the evidence. Unconfirmed triggers (prose, missing/cross-pull-request comment, plain issue, edited-after-run comment) report nothing; a confirmed `/review` decline keeps the passing skip, paused description included; automatic fork/draft runs, activated clean/findings runs and the stale-lock activation failure are unchanged; the routing rows still skip non-review runs. Fail-open checks done by reading the script: the confirmation gate is scoped to the on-demand workflow plus the all-skipped shape, an unconfirmed trigger can only suppress a report (it cannot create a passing skip or a label change), and every shape outside the passing branches still reaches the existing fail-closed classifier. The `updated_at` guard closes the edit-after-run false confirmation; the same-second edit is declared as a gap instead of claimed closed. The guard runs before the pull-request read, which also keeps a plain-issue comment from aborting the step on this path.
- **Security**: no new secret, permission, dependency or network destination; the existing `issues: write`/`pull-requests: write` token reads the comment. Values reaching shell commands and API paths are numeric ids parsed from the workflow-set run name plus the pull request number; the comment body is only compared through jq predicates and never echoed or logged. The change removes a way for an unrelated comment to clear a failing required check and to add the readiness label; a failure verdict for unrequested triggers was deliberately rejected because any commenter could then block a merge and delete the label.
- **Independent review**: a separate read-only review agent replayed every row against the committed script, re-checked the confirmation fixtures and the delta/main-spec headers, and reported no Important findings; its two compliance Nits (the pause requirement and the unreported-head residual) and its two declared-gap suggestions (the membership-declined path and the author-association drift) were folded into this change before the follow-up push.
- **Compliance**: the diff matches `openspec/changes/gate-ignores-unrequested-declines` — proposal What Changes, design D2–D5, the delta spec's merge-gate and readiness-label requirements, and the tasks marked complete. The only gh-aw change is the run-name value and its recompiled lock, both included; `docs/CI.md` and the gate header comment state the same rule the script implements. The pull request body names `OpenSpec: gate-ignores-unrequested-declines` and its Test plan summarizes this file; the live-drill gap is declared rather than implied.

## Post-merge verification (2026-10-22)

Environment: the parent change landed on `dev` in `5846f5c`; the drill branch is based on `247bd2f93e5fff159337415e749a68400dc294df` and its head is `696d3db07ca83c259de2ed9b95213d1ac4134a61`. The drill used throwaway pull request #328 (`chore/gate-unrequested-decline-drill`), closed unmerged; its branch was deleted and no repository variable is left set. Each status's `target_url` points at the review run it was reported for, not at the gate run that posted it; both are cited below.

- **Automatic path unchanged (task 6.3).** #328's automatic review run `39707200527` finished with `No Important findings`; gate run `39707655045` posted status `56949757159` — `success — Reviewed: no Important findings` — at 01:47:05Z, and the readiness label was added at 01:47:07Z.
- **A cancelled on-demand request still fails closed (task 6.1, baseline).** `/review` comment `6330712715` created on-demand run `39707770799`; the run was cancelled while queued/running, and gate run `39707904470` posted status `56949878022` — `failure — Review did not start (pre_activation: cancelled); failing closed` — at 01:49:45Z; the label was removed at 01:49:46Z.
- **An ordinary comment reports nothing (task 6.1, the fix).** Prose comment `6330736818` created on-demand run `39707944691`, whose display title was `PR review (on demand) for #328 comment 6330736818` — the comment-id carrier renders live. Its gate run `39707950124` exited without posting: the `PR review gate` status count on the head stayed at two, the latest remained the failure above, and the label stayed absent. `origin/dev` before the change posted a passing skip for this exact shape on PR #307.
- **Paused reviews (task 6.2).** With `PR_REVIEW_ENABLED=false`: prose comment `6330755780` created run `39708091533`; its gate run `39708098426` posted no status (count stayed two, latest still the failure). `/review` comment `6330766092` created run `39708174191`; gate run `39708179285` posted status `56950002459` — `success — Review not run (reviews are currently paused)` — at 01:52:35Z and added the label at 01:52:37Z. The variable was deleted afterwards (`gh variable list` empty).
- **Cleanup.** #328 was closed unmerged and its branch deleted; the label-dropping companion ran on close. Nothing from the drill persists.

The live evidence above closes the "Live gate behavior" and "Run-name rendering at runtime" gaps; the remaining declared gaps are unchanged.

## Review rounds

### Round 1 (PR #324, automated review run 39704908899, commit ca616c5)

No Important findings. Two Nits, both fixed before the follow-up push: the gate header and `docs/CI.md` now scope the confirmation wording to the all-skipped declined shape and name the membership-declined shape as unchanged, and the tasks completed by the open PR and the pre-push review are checked off.

An independent read-only review agent re-ran every replay row against the committed script, re-checked the confirmation fixtures, the delta headers and the tasks, and reported no Important findings. Its compliance Nits were fixed in the same round: a MODIFIED "Reviews can be paused without blocking merges" requirement scopes the pause's passing result to a review the pause declined, and the merge-gate requirement gains a scenario for the unreported-head residual. Its two suggested gaps (the unchanged membership-declined overwrite path and the author-association drift) are recorded above.

### Round 2 (PR #324, automated review run 39705767146, commit 4d2c63f)

No Important findings. Two Nits, both fixed before the next push: `docs/CI.md` now names the all-skipped shape instead of "declined before activation", which also described the unconfirmed membership-declined shape; and the pull-request predicate captures the `gh api` value instead of piping into `grep -q`, so a producer that closes early cannot turn a successful match into a failed confirmation through `pipefail`.
