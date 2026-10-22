# Design

## Context

See `proposal.md` — Why for the incident. Three facts shape the approach.

**The gate decides from the observed run's own data.** `pr-review-gate.yml` runs on `workflow_run`, reads the observed run's workflow file path and event, then classifies it from the `pre_activation`, `activation`, `agent` and `review_verdict` job conclusions. Its passing branch is `activation: skipped` with `pre_activation` `success` or `skipped`; the same classification drives both the status it posts and the `ready-for-human-review` label block, so a run the gate does not report changes neither.

**The on-demand run shape cannot tell requests from unrelated comments.** `pr-review-command.lock.yml` (compiled by gh-aw v0.88.7 from `pr-review-command.md`) triggers on every `issue_comment` (created and edited). The `/review` filter is not in the trigger: gh-aw compiles the body match, the actor admission (`author_association` in OWNER/MEMBER/COLLABORATOR) and the pause switch onto the `pre_activation` job's own `if:` (`pr-review-command.lock.yml:1751-1752`), and the `activation` job repeats the match after `needs.pre_activation.outputs.activated == 'true'` (`:87-89`). An ordinary comment therefore skips `pre_activation` and every later job — the same all-skipped shape as a paused or declined automatic run. The `pre_activation: success, activation: skipped` shape is different: `pre_activation` ran, so the request was admitted, and the membership decision then refused it.

**The `workflow_run` payload carries no comment.** The run object exposes `event`, `head_sha`, `display_title`, `path` and timings, but no triggering comment, author association or event payload; jobs expose conclusions and step names only, and there is no documented run-to-comment mapping. The run name is the one run-scoped value a workflow can set itself and the gate can read, and the on-demand workflow already sets it (it must, because the run's head SHA is the default branch, not the pull request head). `pr-review-command.md` now appends the triggering `github.event.comment.id` to that name.

Evidence for the incident, and the two earlier records of this defect — the ready-label change's `validation.md` "Known limitation" and fail-gate's tasks 4.3/4.4 — are cited in `proposal.md`. The current spec requires a passing skip for any declined activation (the merge-gate requirement) and ties the label to the reported passing status; both requirements are modified by this change's delta.

## Goals / Non-Goals

**Goals:**
- A run that was not an accepted `/review` request cannot change the head's gate result or the readiness label.
- A paused repository, automatic skips (fork/draft/stack) and a confirmed but declined request keep their passing skip; the budget guardrail's `activation: success, agent: skipped` path is untouched.
- Confirmation rests on the trigger itself, not on guessing which gh-aw stage compiled which condition.

**Non-Goals:**
- A failure verdict for unrequested runs, or a change to the accepted `/review` forms (`proposal.md` Non-Goals).
- Changing the review workflows' triggers or jobs; the only compiled-workflow change is the run-name value.
- The watchdog's "a run exists" definition; recorded as follow-up 7.4.

## Decisions

### D1. Confirm the trigger through the run-name comment id

The gate reads the comment id the on-demand run name carries and fetches the comment through the Issues API. This is the only run-scoped way to answer "was this run created by a `/review` request?": the payload does not carry the comment, and no API maps a run back to it.

A shape-only stopgap (treat every all-skipped on-demand run as unrequested) was considered and rejected as the primary rule. It is exact while reviews are enabled — the compiled `pre_activation` `if:` contains the `/review` match — but it cannot separate a paused `/review` request from a paused unrelated comment, and its correctness depends on where gh-aw compiles the conditions. The confirmation answers the question directly, closes the paused case, and costs one comment read plus one pull-request read per declined on-demand run. Its unconfirmed outcome is the stopgap's safe behavior: report nothing.

### D2. Confirmation mirrors the acceptance conditions

The gate accepts a trigger only when all of the following hold:

- the body is exactly `/review`, starts with `/review `, or starts with `/review` followed by a newline — the three forms gh-aw v0.88.7 compiles;
- `author_association` is OWNER, MEMBER or COLLABORATOR — the compiled actor admission;
- the comment's `issue_url` belongs to the pull request named in the run name;
- the issue is a pull request — the compiled `github.event.issue.pull_request != null` condition;
- the comment has not been edited after the run was created (`updated_at` is not later than the run's `created_at`). An edit produces its own run, so a later body cannot be the trigger of the earlier run; without this check, editing a prose comment to `/review` would let the original declined run pass as a request.

Mirroring the compiled conditions keeps the gate's judgement aligned with what the workflow itself would accept, and makes an unauthorized or malformed `/review` a non-event for the gate instead of a green skip. It also duplicates gh-aw's matcher, so both sides must be re-read when the pin moves (7.3).

### D3. A confirmed decline keeps the passing skip; anything unconfirmed reports nothing

A declined run that the trigger proves was a `/review` request is exactly the decline the old passing branch was written for (paused reviews; the membership decision), so it keeps its passing skip. A run whose trigger cannot be confirmed — an ordinary comment, an unauthorized or malformed request, a plain-issue comment, a deleted comment, a run created before the new run name, or a failed lookup — is not a review event: the gate posts no status and leaves the label alone. A failure verdict is rejected because any repository visitor can comment on a public pull request, and a failure would let a passer-by block a merge and delete the label; silence is both truthful and unweaponizable. The head's existing result remains until a later real review supersedes it.

### D4. Confirmation is consulted only for the declined on-demand shape

The gate confirms the trigger only when the workflow is `pr-review-command.lock.yml` and `pre_activation` and `activation` are both `skipped` — the shape where a comment that was not a request is indistinguishable from a decline. Activated runs prove acceptance through their own stages and need no lookup; `pre_activation: success, activation: skipped` is an admitted request declined by the membership decision and keeps the passing skip the old behavior gave it. This bounds the API reads to the run type that needs them.

### D5. No pause special case is needed

While paused, a requested `/review` still has its comment and is therefore confirmed: the pause keeps its passing skip, and the paused description is chosen from the variable as before. A paused unrelated comment is unconfirmed and reports nothing, closing the paused residual a shape-only rule would leave open. Runs created before the run name carried the comment id cannot be confirmed at all; they report nothing — the safe direction, and a window that closes with the runs in flight at merge.

### D6. The watchdog is not changed

The watchdog treats any review run for the pull request since the head moved as evidence that a review is coming (`pr-review-gate-watchdog.yml`), and a declined on-demand run matches. With silence, a head that has no gate status at all and only such a run can stay `Expected` instead of being alarmed on. That is fail-closed and `AGENTS.md` already documents the `/review` remedy; changing the watchdog's run accounting is a separate decision (7.4).

## Risks / Trade-offs

- [The run name is an expression; if GitHub fails to evaluate it the name falls back to the workflow name and loses `#<n>`] → the expression only reads existing event contexts and the same construct already carries the pull request number; the post-merge drill checks the live display title, and a revert restores the previous name.
- [The comment can be edited or deleted between run creation and the gate] → the run is confirmed against the comment's state at read time, and a comment edited after the run's `created_at` is rejected outright; a deletion makes the lookup fail. Only an edit landing in the same second as the run's creation can escape the timestamp check, and a real review still reports on the head.
- [The gate duplicates gh-aw's accepted forms and actor list] → 7.3 re-reads both at the next pin bump; a mismatch can only suppress a passing skip (unconfirmed), not create a false one.
- [The confirmation reads the comment's current `author_association`, not the value in the triggering event, which `workflow_run` cannot access] → an administrator changing the actor's permission between the comment and the gate read can confirm an originally declined request or silence a paused one; the window is seconds wide and is declared in `validation.md`. Carrying the event's association in the run name was rejected because it would put user-controlled text into a run name.
- [Transient Issues API failure on a declined run] → the run is unconfirmed and reports nothing; the head's previous result stays. Only declined on-demand runs are affected.
- [Silence can leave the check `Expected` when the head never had a status] → fail-closed; `/review` or a new head reports; 7.4 records the watchdog question.
- [Rollover: pre-change declined runs cannot be confirmed] → they report nothing, which is safe; the window is the runs in flight at merge.
- [The membership-declined shape keeps its passing skip] → pre-existing, no runtime evidence observed, out of scope; revisit if it becomes reachable in practice.

## Migration Plan

The gate and the run-name change ship together. `workflow_run` only triggers workflows that exist on the default branch, so the change takes effect only after merge. Verification is split: offline replay of the new gate script against recorded runs (including synthetic run names for the confirmed and unconfirmed paths) before the pull request, then live drills on throwaway pull requests after merge (tasks.md 4.x and 6.x, recorded in `validation.md`). Rollback is a revert of the gate workflow and the on-demand source plus its recompiled lock; there is no state, rule or permission to unwind, and the next review run re-reports the head.

## Open Questions

None that change this change. The watchdog's run accounting and the matcher re-read are recorded as follow-ups rather than open design questions.
