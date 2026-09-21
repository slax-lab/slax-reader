## REMOVED Requirements

### Requirement: Promotion pull requests merge with rebase

**Reason**: Superseded by promotion-merge-rule. The requirement's premise — that rebase replays only the patches the target branch lacks — does not hold under GitHub's mergeable gate, which evaluates a trial merge and blocks every merge method once histories conflict; rebase-merging also forges the duplicate SHAs that cause the divergence.

## ADDED Requirements

### Requirement: Promotion pull requests merge with a merge commit

Promotion pull requests (`dev` → `beta` and `beta` → `main`) MUST be merged with the merge-commit method and MUST NOT be rebase- or squash-merged. Rebase and squash both forge new commits for patches the source branch already carries, leaving source and target with different SHAs for identical content; GitHub's mergeable gate evaluates a trial merge, and once histories have diverged that gate blocks every merge method until a sync-back merge re-converges them. A merge commit makes the target branch contain the source branch's actual commits, so histories converge and subsequent promotions stay mergeable.

#### Scenario: Target branch lands the reviewed commits

- **WHEN** a promotion pull request is merged with a merge commit
- **THEN** the target branch's history contains the exact commits that were reviewed on the source branch, and the source branch tip becomes an ancestor of the target branch

#### Scenario: Diverged histories need a sync-back first

- **WHEN** a promotion pull request reports conflicts because an earlier rebase or squash forged duplicate SHAs for the same patches
- **THEN** the target branch is merged back into the source branch first (resolving in favor of the source branch's content), and only then is the promotion merged

## MODIFIED Requirements

### Requirement: Uniform protection on all long-lived branches

All three long-lived branches MUST be protected identically: changes arrive only through pull requests (direct pushes are rejected), deletion and non-fast-forward updates are rejected, and merging requires one approving review including a code-owner review plus the required status checks `agent-config drift check` and `PR review gate`. Squash, rebase, and merge-commit merging MUST all be permitted, so that promotion and sync-back pull requests can use the merge method the branching model requires. Protection MUST be defined in a branch ruleset whose name identifies the release branches, applied to all three refs.

#### Scenario: Direct push is rejected on every long-lived branch

- **WHEN** a contributor pushes a commit directly to `dev`, `beta`, or `main`
- **THEN** the push is rejected, and the change must go through a pull request instead

#### Scenario: A long-lived branch cannot be deleted or rewritten

- **WHEN** anyone attempts to delete or force-push `dev`, `beta`, or `main`
- **THEN** the operation is rejected by the ruleset

#### Scenario: Required checks gate merges on every long-lived branch

- **WHEN** a pull request targets any of `dev`, `beta`, or `main`
- **THEN** the `agent-config drift check` and `PR review gate` status checks must report success before the pull request can merge
