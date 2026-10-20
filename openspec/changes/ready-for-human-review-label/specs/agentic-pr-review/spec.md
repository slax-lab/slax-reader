## ADDED Requirements

### Requirement: The merge gate declares readiness for human review

The system SHALL maintain the label `ready-for-human-review` on a pull request as the explicit state "automated checks finished with no blocker", consumed by notification tooling. The gate workflow MUST add the label when the status it reports for the pull request's **current head** is a passing result and the pull request is not a draft, and MUST remove it when that status is a failure or when the pull request is a draft. A result about a commit that is no longer the pull request's head MUST NOT change the label: only a status for the current head may update what the open pull request says about itself.

The label MUST NOT change merge requirements: the required status check remains the only automated gate, and the label neither blocks nor authorises a merge. Adding an already-present label MUST be idempotent and MUST NOT be treated as an error. Removing a label that is not present MUST NOT be treated as an error.

A companion workflow MUST remove the label whenever the verified state no longer applies: a new commit on the head branch, a reopen, a draft conversion, a ready-for-review transition (which starts a new review), or a close. Failures of that removal MUST NOT fail the pull request's checks.

#### Scenario: A passing gate adds the label

- **WHEN** the gate reports a passing status for the pull request's current head
- **THEN** the pull request carries `ready-for-human-review`

#### Scenario: A draft is never labelled
- **WHEN** the review run is declined because the pull request is a draft (a passing skip), or the gate reports any result for a draft pull request
- **THEN** the pull request does not carry `ready-for-human-review`

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
