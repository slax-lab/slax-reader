# Tasks

## 1. Evidence and decision record (complete before implementation)

- [x] 1.1 Reconstruct the incident from GitHub for PR #307: head sha `153775b788731fd8966113429b1deaeddb1434f9`, gate statuses 56779448678 / 56779791514 / 56780095321 / 56780138883, declined run 39414403579, trigger comment 6289715051, review runs 39412596780 / 39413212481 / 39414147103; recorded in `proposal.md` and `design.md` — verify every id still resolves with `gh api` before the pull request.
- [x] 1.2 Establish the shape from the compiled workflow rather than assumption: the `/review` body match, actor admission and pause switch compile onto `pre_activation`'s `if:` (`pr-review-command.lock.yml:1751-1752`), so a non-request comment leaves every job skipped; recorded in `design.md` D2 — verify by reading the lock at the pinned gh-aw v0.88.7.
- [x] 1.3 Confirm the spec conflict and prior records: the merge-gate requirement currently passes every declined activation; the ready-label change's `validation.md` and fail-gate's tasks 4.3/4.4 record the follow-up — quoted in `proposal.md`/`design.md`; verify against the current spec text and both archived files.
- [x] 1.4 Record the label timing correction: #307 had closed before the 11:21:57Z gate ran, so the run took the removal branch and no `labeled` event follows 11:21:16Z — the overwrite is the confirmed defect, the label add is the mechanism on an open pull request; verified from the issue timeline and label events.
- [x] 1.5 Establish that the `workflow_run` payload carries no comment and that the run name is the only run-scoped carrier the gate can read (payload fields, jobs API and the lack of a documented run-to-comment mapping) — recorded in `design.md` Context; verify against the run object of 39414403579 and the GitHub event documentation before the pull request.

## 2. On-demand run name and compiled workflow

- [x] 2.1 Append `comment <id>` (the triggering `github.event.comment.id`) to the `run-name` in `.github/workflows/pr-review-command.md`, and document the cross-workflow contract in its comment — verify the `#<n>` pull request token and the `comment <id>` token both appear in the planned run name.
- [x] 2.2 Recompile with the pinned gh-aw v0.88.7: `gh aw compile --strict --purge --no-check-update` — verify the lock diff contains only the run-name line and the gh-aw metadata hash, that `bash tooling/check-gh-aw-drift.sh` passes, and that no other lock file changed.

## 3. Gate implementation

- [x] 3.1 Add the trigger confirmation to `.github/workflows/pr-review-gate.yml`: parse the comment id from the run name and fetch the comment through the Issues API; accept the trigger only when the body is one of the three `/review` forms gh-aw compiles, `author_association` is OWNER/MEMBER/COLLABORATOR, the comment belongs to the pull request named in the run name, and the issue is a pull request — verify the jq predicates against fixture bodies (`/review`, `/review `, `/review\n` accepted; `/review\r\n`, ` /review`, `review` rejected) and against real comments.
- [x] 3.2 Apply the rule at the declined on-demand shape: when the workflow is `pr-review-command.lock.yml` and `pre_activation` and `activation` are both `skipped`, a confirmed request continues to the passing-skip classification and an unconfirmed one reports nothing (no status, no label) — verify by replaying recorded runs with the final script and the status/label POSTs replaced by prints.
- [x] 3.3 Replay the following rows and record the results: (a) run 39414403579 with its real pre-change run name (no comment id) → nothing; (b) the same run with a synthetic run name pointing at the prose comment 6289715051 → nothing; (c) a synthetic run name pointing at the real `/review` comment 6289543179 → passing skip, and with `PAUSED=true` the paused description; (d) a nonexistent comment id → nothing; (e) a comment from another pull request → nothing; (e2) the confirmed comment with an `updated_at` later than the run's creation → nothing (an edit after the run cannot be its trigger); (f) recorded automatic fork/draft runs → their existing passing skip; (g) recorded activated review runs (clean, findings, stale-lock activation failure) → unchanged results.
- [x] 3.4 Update the workflow's header comment so it states the confirmation rule, the shapes it distinguishes and its dependence on gh-aw compiling the on-demand conditions — verify the comment matches the shipped conditions line by line.
- [x] 3.5 Update `docs/CI.md`'s readiness-label bullets: only a status the gate reports may change the label; an unconfirmed on-demand run reports nothing; and the run-name comment-id contract is documented. Verify no sentence still claims every declined run adds the label.

## 4. Spec, checks and validation record

- [x] 4.1 Run `pnpm exec openspec validate --all --strict` and verify the delta touches only `agentic-pr-review` and passes strict validation after the implementation edits.
- [x] 4.2 Run `pnpm exec rulesync doctor --strict`, `pnpm exec rulesync generate --check`, and `bash tooling/check-gh-aw-drift.sh`; verify all pass.
- [x] 4.3 Write `openspec/changes/gate-ignores-unrequested-declines/validation.md`: commands run, the replay rows and results, what was exercised, and declared gaps — verify it reads completely without any media.
- [ ] 4.4 Open the implementation pull request against `dev` with `OpenSpec: gate-ignores-unrequested-declines` in the body and a Test plan summarizing `validation.md`.

## 5. Local review before push

- [ ] 5.1 Run the three `REVIEW.md` passes (Bugs, Security, Compliance) on the final diff and resolve every Important finding before the pull request — verify the compliance pass reads this change's artifacts and the pull request body names the change id.
- [ ] 5.2 Re-read the changed gate script for fail-open regressions: every unrecognized shape must still fall closed, no other workflow or event shape may be silenced by the new guard, and a confirmation failure must never create a passing skip.

## 6. Post-merge live verification (before archive)

- [ ] 6.1 On an open throwaway pull request, confirm a new on-demand run's display title carries the comment id, create a real gate failure (post `/review`, cancel the queued on-demand run), and then post an ordinary comment; verify the latest `PR review gate` status stays the failure, no new status is posted, and the label is not added.
- [ ] 6.2 Pause drill: set `PR_REVIEW_ENABLED=false`, post an ordinary comment (gate reports nothing) and then a `/review` (gate reports `success — Review not run (reviews are currently paused)`), then delete the variable.
- [ ] 6.3 Verify the ordinary automatic path on an open pull request still reports `Reviewed:` or a findings failure normally after merge.
- [ ] 6.4 Record every drill (run/status/label ids, display titles and variable state) in `validation.md` before archiving.

## 7. Archive and follow-ups outside this change

- [ ] 7.1 After the implementation pull request merges and 6.x is recorded, archive in a separate small pull request: `openspec archive gate-ignores-unrequested-declines`; verify no active change remains and the requirements are folded into `openspec/specs/agentic-pr-review/spec.md`.
- [ ] 7.2 Re-read the gate's confirmation predicates against gh-aw's matcher at the next pin bump: the accepted `/review` forms, the actor admission and the pause switch are mirrored in the gate, and the run-name expression is the carrier between the workflows.
- [ ] 7.3 Decide whether the watchdog should ignore declined on-demand runs when counting "a review run exists", so a head with no gate status and only such a run is alarmed on instead of staying `Expected`; `AGENTS.md`'s `/review` remedy is the interim answer.
- [ ] 7.4 Decide whether the `pre_activation: success, activation: skipped` membership-declined shape should keep its passing skip if it is ever observed in practice; it is unchanged by this change.
