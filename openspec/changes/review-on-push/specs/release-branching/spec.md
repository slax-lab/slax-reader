# Spec Delta

## MODIFIED Requirements

### Requirement: Uniform protection on all long-lived branches

All three long-lived branches MUST be protected identically: changes arrive only through pull requests (direct pushes are rejected), deletion and non-fast-forward updates are rejected, and merging requires one approving review including a code-owner review plus the required status checks `agent-config drift check` and `PR review gate`. Squash, rebase, and merge-commit merging MUST all be permitted, so that promotion and sync-back pull requests can use the merge method the branching model requires. Protection MUST be defined in a branch ruleset whose name identifies the release branches, applied to all three refs.

When a promotion or sync-back pull request cannot obtain the required approving review — because its author is the repository's only active administrator, self-approval does not count, and rulesets cannot exempt by a pull request's head branch — a human repository administrator merges it, bypassing the review requirement, with the merge-commit method, after the required status checks report success. If the `PR review gate` status has not reported — the review workflow does not fire for a pull request opened with conflicts — the sync-back merge that resolves the conflicts re-triggers the review automatically, because the review triggers include `synchronize`; if no run fires (for example the pull request is still conflicted), posting a `/review` comment on the pull request runs the on-demand review so the gate reports a real status.

#### Scenario: Direct push is rejected on every long-lived branch

- **WHEN** a contributor pushes a commit directly to `dev`, `beta`, or `main`
- **THEN** the push is rejected, and the change must go through a pull request instead

#### Scenario: A long-lived branch cannot be deleted or rewritten

- **WHEN** anyone attempts to delete or force-push `dev`, `beta`, or `main`
- **THEN** the operation is rejected by the ruleset

#### Scenario: Required checks gate merges on every long-lived branch

- **WHEN** a pull request targets any of `dev`, `beta`, or `main`
- **THEN** the `agent-config drift check` and `PR review gate` status checks must report success before the pull request can merge

#### Scenario: A promotion without an available approver is merged by the human administrator

- **WHEN** a promotion or sync-back pull request cannot obtain an approving review because its author is the repository's only active administrator
- **THEN** the human administrator merges it from the GitHub UI with the merge-commit method once the required status checks report success, and agents do not merge it themselves
