# Spec Delta

## MODIFIED Requirements

### Requirement: Review runs on pull request readiness and on demand

The system SHALL request exactly one review per pull request when the pull request is opened, reopened, or marked ready for review, regardless of which branch the pull request targets; a pull request opened as a draft MUST NOT be reviewed until it is marked ready. When commits are pushed to an open pull request whose head branch lives in this repository, the system SHALL request a new review for the pushed head; a draft pull request MUST NOT be reviewed on push. Pushes to a pull request whose head branch lives in a fork MUST NOT start a review; fork pull requests are reviewed only through `/review`. The system SHALL accept an explicit `/review` comment as a request to re-run the review. `/review` requests from actors without write access to the repository MUST be ignored.

When pushes arrive faster than reviews complete, the system MAY let a superseded in-progress review finish rather than cancelling it; a review that never started MUST be dropped in favor of the newest push. A dropped or superseded run MUST NOT leave a failing merge-gate result on the pull request's current head: the merge gate reports no status for a cancelled run when a newer review run for the same pull request exists, leaving the head's result to the newest run. A cancelled run with no newer review run — a manual cancellation — MUST still fail closed.

#### Scenario: New pull request is reviewed once

- **WHEN** a pull request is opened (or a draft is marked ready for review), whatever branch it targets
- **THEN** exactly one review run starts for that pull request

#### Scenario: Push to a same-repository pull request re-runs the review

- **WHEN** commits are pushed to an open, non-draft pull request whose head branch lives in this repository
- **THEN** a new review run starts for the pushed head

#### Scenario: Push to a draft pull request does not trigger a review

- **WHEN** commits are pushed to a pull request still marked as draft
- **THEN** no new review run starts

#### Scenario: Push does not trigger a new review

- **WHEN** commits are pushed to a pull request whose head branch lives in a fork of this repository
- **THEN** no new review run starts, and the merge gate still reports a non-pending, passing result for the pushed head

#### Scenario: Rapid pushes review the latest head, not every intermediate one

- **WHEN** two pushes arrive in quick succession while a review for an earlier head is still running
- **THEN** the in-progress run finishes, the queued review for the intermediate head is dropped without posting a failing merge-gate status, a review for the latest head runs, and the merge gate's result on the latest head comes from that newest run

#### Scenario: Manually cancelled review fails closed

- **WHEN** a review run is cancelled and no newer review run exists for the same pull request
- **THEN** the merge gate reports a failing result rather than passing or staying silent

#### Scenario: Comment re-runs the review

- **WHEN** a user with write access comments `/review` on the pull request
- **THEN** a new review run starts for that pull request

#### Scenario: Unauthorized comment is ignored

- **WHEN** a user without write access comments `/review`
- **THEN** no review run starts

### Requirement: The merge gate reflects Important findings

The system SHALL expose a status check whose name is stable across runs. That check MUST report failure when the review produced at least one Important finding, and success when the review produced none. A passing result MUST rest on positive evidence about the run's own stages: the review system declined to activate the run — the pause, a fork pull request, and the other conditions its activation decision is compiled from — or the run was activated and its agent either executed or was deliberately not started by a configured guardrail (a budget cap). A run that stopped for any other reason, including a configuration failure in a stage before the agent, MUST report failure whose description names the stage that stopped it; when no single stage stopped the run, the description MUST name the pre-agent stage outcomes rather than a stage. A description MUST NOT name a cause the check has not verified: a skip says that no review was produced unless the check can confirm the cause. The check MUST report a result for every pull request it applies to, including a review that was skipped and a run that could not produce a review; it MUST NOT leave a pull request waiting on an unreported check, and a run whose stages end in a combination the gate does not recognize as a decline or a guardrail stop MUST fail closed rather than pass as a skip. The single exception to reporting is a cancelled run that a newer review run for the same pull request supersedes: such a run MUST report nothing, because the newest run reports on the pull request's current head, and a superseded failure would attach to a commit its own run is about to cover. A cancelled run with no newer review run is not superseded and fails closed as above.

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

- **WHEN** a review run's stages before the agent end in a combination that is neither a decline by the system nor a successful start — for example the run is cancelled before the agent begins and no newer review run exists for the pull request
- **THEN** the status check reports failure rather than a passing skip

#### Scenario: A superseded cancelled run reports nothing

- **WHEN** a review run is cancelled and a newer review run exists for the same pull request
- **THEN** the status check posts no result for the cancelled run, and the pull request's current head is reported on by the newest run instead

#### Scenario: A review the system declined to activate still passes

- **WHEN** the review run is not activated — reviews are paused, the pull request comes from a fork, or another condition compiled into that decision declines it
- **THEN** the status check reports a passing skip, and the pull request is not blocked by the absent review

#### Scenario: A skip description claims no unverified cause

- **WHEN** a review run is declined and the status check reports the passing skip
- **THEN** the description states that no review was produced, and names a cause only where the check can confirm one for that run

#### Scenario: An activated run whose agent a guardrail stopped still passes

- **WHEN** the review run is activated but its agent is deliberately not started because a configured guardrail (a budget cap) stopped it
- **THEN** the status check reports a passing skip, and the pull request is not blocked by the absent review
