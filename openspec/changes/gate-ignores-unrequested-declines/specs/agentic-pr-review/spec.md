# Spec Delta

## MODIFIED Requirements

### Requirement: The merge gate reflects Important findings

The system SHALL expose a status check whose name is stable across runs. That check MUST report failure when the review produced at least one Important finding, and success when the review produced none. A passing result MUST rest on positive evidence about the run's own stages: the review system declined to activate the run — the pause, a fork pull request, and the other conditions its activation decision is compiled from — or the run was activated and its agent either executed or was deliberately not started by a configured guardrail (a budget cap). A declined on-demand run is passing evidence only when its trigger is confirmed as an accepted review request: the gate MUST read the trigger carried by the run and confirm that it is an accepted `/review` request — the request body forms and the actor admission the command path is compiled from, on this pull request — before it reports the run, and MUST report no status and MUST NOT change the readiness label when the trigger is not confirmed. A run that was not a confirmed review request is not a review the check applies to. A run that stopped for any other reason, including a configuration failure in a stage before the agent, MUST report failure whose description names the stage that stopped it; when no single stage stopped the run, the description MUST name the pre-agent stage outcomes rather than a stage. A description MUST NOT name a cause the check has not verified: a skip says that no review was produced unless the check can confirm the cause. For every review the check applies to — including a review that was skipped and a run that could not produce a review — it MUST report a result, and it MUST NOT leave a pull request waiting on an unreported review; a run whose stages end in a combination the gate does not recognize as a decline or a guardrail stop MUST fail closed rather than pass as a skip. The single exception to reporting is a cancelled run that a newer review run for the same pull request supersedes: such a run MUST report nothing, because the newest run reports on the pull request's current head, and a superseded failure would attach to a commit its own run is about to cover. A cancelled run with no newer review run is not superseded and fails closed as above.

#### Scenario: Important finding blocks merge

- **WHEN** a review reports one or more Important findings
- **THEN** the stable status check reports failure for the reviewed commit

#### Scenario: No Important finding allows merge

- **WHEN** a review reports only Nits or nothing at all
- **THEN** the stable status check reports success for the reviewed commit

#### Scenario: An unpublished run is described as unpublished

- **WHEN** a run ends without publishing a review, whether it was blocked by threat detection or the
  agent produced nothing
- **THEN** the status check's description says that no review was published rather than quoting a
  verdict about a review that does not exist

#### Scenario: Review failure is reported, not silent

- **WHEN** a run ends without producing a review (for example the model endpoint is unreachable)
- **THEN** the status check reports failure with an infrastructure message distinguishable from a findings verdict, and a subsequent `/review` request can replace it with a real verdict

#### Scenario: A run stopped before the agent fails the check

- **WHEN** a review run's activation stage fails — for example because the compiled workflow no longer matches its Markdown source, so the run is refused before the agent starts — and every later stage is skipped
- **THEN** the status check reports failure for the reviewed commit, and its description names the stage that stopped the run instead of reporting a skipped review

#### Scenario: An unrecognized stage outcome fails closed

- **WHEN** a review run's stages before the agent end in a combination that is neither a decline by the system nor a successful start (for example the run is cancelled before the agent begins and no newer review run exists for the pull request)
- **THEN** the status check reports failure rather than a passing skip

#### Scenario: A superseded cancelled run reports nothing

- **WHEN** a review run is cancelled and a newer review run exists for the same pull request
- **THEN** the status check posts no result for the cancelled run, and the pull request's current head is reported on by the newest run instead

#### Scenario: A review the system declined to activate still passes

- **WHEN** an automatic review run is not activated (reviews are paused, the pull request comes from a fork, the pull request is a draft, or another condition compiled into that decision declines it), or an admitted on-demand request is declined by the membership decision
- **THEN** the status check reports a passing skip, and the pull request is not blocked by the absent review

#### Scenario: A confirmed on-demand request still passes when declined

- **WHEN** an on-demand run is declined and its trigger is confirmed as an accepted `/review` request (for example reviews are paused)
- **THEN** the status check reports a passing skip, and the pull request is not blocked by the absent review

#### Scenario: An unconfirmed on-demand trigger reports nothing

- **WHEN** a comment creates an on-demand run and the comment is not an accepted `/review` request (it does not request a review, its author is not admitted, its body is malformed, or it is on a plain issue), or the trigger cannot be read back (the comment is gone, or the run predates the run name carrying the comment id)
- **THEN** the run is declined, the status check reports no status for it, and an existing result on the head — including a failure — is left in place

#### Scenario: An unconfirmed on-demand run can leave a head unreported

- **WHEN** a head's only review run is an unconfirmed on-demand run and the check reports nothing for it
- **THEN** the head carries no result for this context until a later review run reports on it, and the pull request is blocked rather than falsely cleared

#### Scenario: A skip description claims no unverified cause

- **WHEN** a review run is declined and the status check reports the passing skip
- **THEN** the description states that no review was produced, and names a cause only where the check can confirm one for that run

#### Scenario: An activated run whose agent a guardrail stopped still passes

- **WHEN** the review run is activated but its agent is deliberately not started because a configured guardrail (a budget cap) stopped it
- **THEN** the status check reports a passing skip, and the pull request is not blocked by the absent review

### Requirement: The merge gate declares readiness for human review

The system SHALL maintain the label `ready-for-human-review` on a pull request as the explicit state "automated checks finished with no blocker", consumed by notification tooling. The gate workflow MUST add the label when the status it reports for the pull request's **current head** is a passing result, the pull request is open, is not a draft, and its head branch lives in this repository; it MUST remove the label when that status is a failure or when the pull request is a draft, is closed, or has a head branch in another repository. The label describes a pull request that can enter human review now, so a passing skip about a pull request that cannot enter human review MUST NOT add it. A result about a commit that is no longer the pull request's head MUST NOT change the label: only a status for the current head may update what the open pull request says about itself. When the gate reports no status for a run it MUST NOT change the label.

The label MUST NOT change merge requirements: the required status check remains the only automated gate, and the label neither blocks nor authorises a merge. Adding an already-present label MUST be idempotent and MUST NOT be treated as an error. Removing a label that is not present MUST NOT be treated as an error.

A companion workflow MUST remove the label whenever the verified state no longer applies: a new commit on the head branch, a reopen, a draft conversion, a ready-for-review transition (which starts a new review), or a close. Failures of that removal MUST NOT fail the pull request's checks.

#### Scenario: A passing gate adds the label

- **WHEN** the gate reports a passing status for the pull request's current head
- **THEN** the pull request carries `ready-for-human-review`

#### Scenario: A draft is never labelled
- **WHEN** the review run is declined because the pull request is a draft (a passing skip), or the gate reports any result for a draft pull request
- **THEN** the pull request does not carry `ready-for-human-review`

#### Scenario: A closed or forked head is never labelled
- **WHEN** a passing verdict arrives for a pull request that is closed, or whose head branch lives in another repository
- **THEN** the pull request does not carry `ready-for-human-review`, and an existing label is removed

#### Scenario: A failing gate removes the label

- **WHEN** the gate reports a failing status for the pull request's current head
- **THEN** the pull request does not carry `ready-for-human-review`

#### Scenario: A superseded result does not touch the label

- **WHEN** the gate reports a result for a commit that is no longer the pull request's head
- **THEN** that result does not change the label

#### Scenario: A new head drops the label

- **WHEN** a commit is pushed to the head branch, or the pull request is reopened, converted to draft, marked ready for review, or closed
- **THEN** the companion workflow removes the label, and a missing label is not an error

#### Scenario: The label does not affect mergeability

- **WHEN** a pull request carries or lacks the label
- **THEN** the ruleset's required checks and review requirements alone decide whether it can merge

#### Scenario: An unconfirmed on-demand run does not change the label

- **WHEN** an on-demand run is created by a trigger the gate does not confirm as an accepted `/review` request
- **THEN** the gate reports no status for it and the pull request's `ready-for-human-review` label is unchanged

### Requirement: Reviews can be paused without blocking merges

The system SHALL provide a settings-only pause control that an operator can use to stop reviews for a period without editing repository files. The subject of the prohibitions below is this change's review system — the review agent, its deterministic jobs, and the command path that triggers it. They do not constrain people, who remain free to comment, approve, request reviews, or merge; they do not constrain GitHub; and they do not apply to other workflows.

While reviews are paused, the system MUST NOT execute the review agent, MUST NOT make model-provider requests, and MUST NOT write review content to the pull request: no submitted review, no review summary, no inline review comment, and no reviewer request. The one permitted output is a short reply to an explicit on-demand request (`/review`) that names the paused subject as the automated review, says the pause is deliberate rather than a failure, and states that human review is unaffected; automatic runs stay silent. A status check is not written content, so the merge gate MUST still report a passing result for a review the pause declined (as a skipped check rather than as a completed review), and the pause itself MUST NOT add or dismiss approvals or block a merge. An on-demand run whose trigger is not an accepted review request is not a review the pause declined: it reports nothing, as the merge-gate requirement states. The pause covers on-demand runs as well as automatic ones, and restoring the control MUST resume reviews for pull requests opened or re-requested afterwards.

#### Scenario: Pause stops execution and spend

- **WHEN** an operator pauses reviews and a pull request is then opened
- **THEN** no review agent executes, no model-provider request is made, and nothing is written to the pull request

#### Scenario: A paused on-demand request is answered without a review

- **WHEN** a user comments `/review` while reviews are paused
- **THEN** no review agent executes, no review is published, and the only output is a reply saying that the automated review is paused, that the pause is deliberate, and that human review is unaffected

#### Scenario: People are unaffected by the pause

- **WHEN** reviews are paused and a person comments, approves, or requests a review on a pull request
- **THEN** the system neither prevents nor reverses that action and reports no review of its own

#### Scenario: Automatic runs stay silent while paused

- **WHEN** a pull request is opened while reviews are paused and nobody requests a review
- **THEN** nothing is written to the pull request and the only visible trace is the skipped check

#### Scenario: Pausing does not disturb the merge path

- **WHEN** an operator pauses reviews and a pull request is opened while the gate is a required check
- **THEN** the gate reports a passing result, no approval is added or dismissed by the pause, and the pull request is not blocked by the absent review

#### Scenario: An unrelated comment during a pause reports nothing

- **WHEN** someone comments on a pull request while reviews are paused and the comment is not an accepted `/review` request
- **THEN** the run is declined and the gate reports nothing for it; the head's existing result and the readiness label are untouched

#### Scenario: Restoring the control resumes reviews

- **WHEN** an operator restores the pause control and a new pull request is opened
- **THEN** the review runs and its verdict is reported as before

#### Scenario: Pausing requires no repository change

- **WHEN** an operator pauses reviews for a day and later restores it
- **THEN** no commit, recompilation, or workflow edit was required

#### Scenario: A paused review is distinguishable from a completed review

- **WHEN** a pull request is opened while reviews are paused
- **THEN** the review's check reports as skipped and nothing is written to the pull request, so the pull request record distinguishes "not reviewed" from "reviewed and clean"
