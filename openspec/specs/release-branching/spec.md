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

All three long-lived branches MUST be protected identically: changes arrive only through pull requests (direct pushes are rejected), deletion and non-fast-forward updates are rejected, history is linear, and merging requires one approving review including a code-owner review plus the required status checks `agent-config drift check` and `PR review gate`. Protection MUST be defined in a branch ruleset whose name identifies the release branches, applied to all three refs.

#### Scenario: Direct push is rejected on every long-lived branch

- **WHEN** a contributor pushes a commit directly to `dev`, `beta`, or `main`
- **THEN** the push is rejected, and the change must go through a pull request instead

#### Scenario: A long-lived branch cannot be deleted or rewritten

- **WHEN** anyone attempts to delete or force-push `dev`, `beta`, or `main`
- **THEN** the operation is rejected by the ruleset

#### Scenario: Required checks gate merges on every long-lived branch

- **WHEN** a pull request targets any of `dev`, `beta`, or `main`
- **THEN** the `agent-config drift check` and `PR review gate` status checks must report success before the pull request can merge

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
