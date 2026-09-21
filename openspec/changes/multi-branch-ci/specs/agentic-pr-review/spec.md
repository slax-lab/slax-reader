## MODIFIED Requirements

### Requirement: Review runs on pull request readiness and on demand

The system SHALL request exactly one review per pull request when the pull request is opened, reopened, or marked ready for review, regardless of which branch the pull request targets; a pull request opened as a draft MUST NOT be reviewed until it is marked ready. It SHALL accept an explicit `/review` comment as a request to re-run the review. It MUST NOT start a new review on ordinary pushes to an open pull request. `/review` requests from actors without write access to the repository MUST be ignored.

#### Scenario: New pull request is reviewed once

- **WHEN** a pull request is opened (or a draft is marked ready for review), whatever branch it targets
- **THEN** exactly one review run starts for that pull request

#### Scenario: Push does not trigger a new review

- **WHEN** commits are pushed to a pull request that has already been reviewed
- **THEN** no new review run starts

#### Scenario: Comment re-runs the review

- **WHEN** a user with write access comments `/review` on the pull request
- **THEN** a new review run starts for that pull request

#### Scenario: Unauthorized comment is ignored

- **WHEN** a user without write access comments `/review`
- **THEN** no review run starts

## ADDED Requirements

### Requirement: Reviews evaluate the pull request's own diff

The review MUST identify the changes under review as the diff between the pull request's head and the pull request's own base branch, for any base branch. Review guidance MUST NOT assume the default branch is the base: any git-based fallback for resolving the diff SHALL derive the base from the pull request itself.

#### Scenario: Pull request targeting a non-default branch is reviewed against its base

- **WHEN** a pull request targets `dev` or `beta` and its review runs
- **THEN** the reviewed diff is computed against that target branch, not against `main`

#### Scenario: No default-branch assumption in diff resolution

- **WHEN** the review instructions resolve the diff through git rather than the pull request tools
- **THEN** the merge base is derived from the pull request's base ref, and no instruction fixes the base to the default branch
