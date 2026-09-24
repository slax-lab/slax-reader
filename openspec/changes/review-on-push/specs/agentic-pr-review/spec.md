# Spec Delta

## MODIFIED Requirements

### Requirement: Review runs on pull request readiness and on demand

The system SHALL request exactly one review per pull request when the pull request is opened, reopened, or marked ready for review, regardless of which branch the pull request targets; a pull request opened as a draft MUST NOT be reviewed until it is marked ready. When commits are pushed to an open pull request whose head branch lives in this repository, the system SHALL request a new review for the pushed head; a draft pull request MUST NOT be reviewed on push. Pushes to a pull request whose head branch lives in a fork MUST NOT start a review; fork pull requests are reviewed only through `/review`. The system SHALL accept an explicit `/review` comment as a request to re-run the review. `/review` requests from actors without write access to the repository MUST be ignored.

When pushes arrive faster than reviews complete, the system MAY let a superseded in-progress review finish rather than cancelling it; a review that never started MUST be dropped in favor of the newest push. Every review run MUST evaluate the pull request head that triggered it, so the merge gate's verdict always attaches to the commit that run reviewed.

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
- **THEN** the in-progress run finishes, the queued review for the intermediate head is dropped, and a review for the latest head runs

#### Scenario: Comment re-runs the review

- **WHEN** a user with write access comments `/review` on the pull request
- **THEN** a new review run starts for that pull request

#### Scenario: Unauthorized comment is ignored

- **WHEN** a user without write access comments `/review`
- **THEN** no review run starts
