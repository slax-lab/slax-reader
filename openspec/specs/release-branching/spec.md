# release-branching Specification

## Purpose

Defines the repository's long-lived environment branches (`dev`, `beta`, `main`), how changes flow between them, and the protection and branching conventions that keep the three release lines consistent.

## Requirements

### Requirement: Three long-lived environment branches

The repository SHALL maintain exactly three long-lived branches: `dev` (integration, serving the test environment), `beta` (serving the beta environment), and `main` (serving production). `main` MUST remain the repository's default branch.

#### Scenario: Branch to environment mapping is stable

- **WHEN** a change lands on `dev`, `beta`, or `main`
- **THEN** it belongs to the test, beta, or production release line respectively, and `main` is still the default branch from which default-branch-loaded automation runs

### Requirement: Uniform protection on all long-lived branches

All three long-lived branches MUST be protected identically: changes arrive only through pull requests (direct pushes are rejected), deletion and non-fast-forward updates are rejected, and merging requires one approving review including a code-owner review plus the required status checks `agent-config drift check` and `PR review gate`. Squash, rebase, and merge-commit merging MUST all be permitted, so that promotion and sync-back pull requests can use the merge method the branching model requires. Protection MUST be defined in a branch ruleset whose name identifies the release branches, applied to all three refs.

When a promotion or sync-back pull request cannot obtain the required approving review — because its author is the repository's only active administrator, self-approval does not count, and rulesets cannot exempt by a pull request's head branch — a human repository administrator merges it, bypassing the review requirement, with the merge-commit method, after the required status checks report success. If the `PR review gate` status has not reported (the review workflow does not fire for a pull request opened with conflicts, and its triggers do not include `synchronize`), posting a `/review` comment on the pull request runs the on-demand review so the gate reports a real status.

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

### Requirement: Promotion flow between release lines

Feature work SHALL flow `feature branch → dev → beta → main`: task branches fork from `dev` and merge back into `dev`; promotion to the next environment happens only through pull requests from `dev` to `beta` and from `beta` to `main`. Each task SHALL use its own branch and pull request, and parallel tasks MUST NOT carry delta specs for the same capability.

#### Scenario: A task branch starts from dev

- **WHEN** a contributor or agent starts a new task
- **THEN** its branch is cut from `origin/dev`, and the resulting pull request targets `dev`

#### Scenario: Promotion uses pull requests between long-lived branches

- **WHEN** changes on `dev` are ready for beta, or changes on `beta` are ready for production
- **THEN** a pull request from `dev` to `beta` (or `beta` to `main`) carries them, subject to the same protection rules as any other pull request

### Requirement: Task branches live in isolated worktrees

Every task — human- or agent-driven — SHALL get its own git worktree inside the repository's `.worktrees/` directory on its own branch cut from `origin/dev`, with one task mapping to one worktree, one branch, and one pull request. Work MUST NOT be edited directly in the main checkout, and a task MUST NOT edit files in another task's worktree.

#### Scenario: Agent refuses to edit the main checkout

- **WHEN** an agent is about to make its first file edit of a session and finds itself in the main checkout on a long-lived branch
- **THEN** it stops and asks for a task worktree (or creates one with approval) before editing

#### Scenario: Merged task worktrees are cleaned up

- **WHEN** a task's pull request has merged
- **THEN** its worktree is removed and its merged branch is deleted

### Requirement: Promotion pull requests merge with a merge commit

Promotion pull requests (`dev` → `beta` and `beta` → `main`) MUST be merged with the merge-commit method and MUST NOT be rebase- or squash-merged. Rebase and squash both forge new commits for patches the source branch already carries, leaving source and target with different SHAs for identical content; GitHub's mergeable gate evaluates a trial merge, and once histories have diverged that gate blocks every merge method until a sync-back merge re-converges them. A merge commit makes the target branch contain the source branch's actual commits, so histories converge and subsequent promotions stay mergeable.

#### Scenario: Target branch lands the reviewed commits

- **WHEN** a promotion pull request is merged with a merge commit
- **THEN** the target branch's history contains the exact commits that were reviewed on the source branch, and the source branch tip becomes an ancestor of the target branch

#### Scenario: Diverged histories need a sync-back first

- **WHEN** a promotion pull request reports conflicts because an earlier rebase or squash forged duplicate SHAs for the same patches
- **THEN** the target branch is merged back into the source branch first (resolving in favor of the source branch's content), and only then is the promotion merged

### Requirement: Sync-back pull requests merge with a merge commit

Sync-back pull requests (which merge the target branch back into the source branch to re-converge diverged histories) MUST be merged with the merge-commit method and MUST NOT be rebase- or squash-merged. A sync-back's entire purpose is topological — making the target branch's tip an ancestor of the source branch — and squash or rebase forges a new SHA for that tip instead, leaving the divergence exactly as it was and the promotion it was meant to unblock still blocked.

#### Scenario: A sync-back re-converges the histories

- **WHEN** a sync-back pull request is merged with a merge commit
- **THEN** the target branch's tip becomes an ancestor of the source branch, and the promotion pull request it unblocked reports mergeable

#### Scenario: A sync-back merged with squash or rebase defeats itself

- **WHEN** a sync-back pull request is squash- or rebase-merged
- **THEN** the target branch's tip is still not an ancestor of the source branch, the promotion remains blocked, and another sync-back is required
