# Spec Delta

## REMOVED Requirements

### Requirement: Task branches live in isolated worktrees

**Reason**: The mandate priced a parallel-work cost into every contributor's serial workflow. Only operators running parallel tasks need worktree isolation, so the convention moves out of the shared rules into personal machine-local agent instructions.

**Migration**: Worktree usage becomes a per-machine convention carried by gitignored `AGENTS.local.md` / `CLAUDE.local.md` files. The shared branching invariants (one task = one branch = one PR from `origin/dev`, no commits on long-lived branches) are preserved by `Requirement: Task branches and commit protection`. Existing `.worktrees/` directories remain gitignored as a legacy location until each machine cleans them up.

## ADDED Requirements

### Requirement: Task branches and commit protection

Every task SHALL use its own branch cut from `origin/dev` and its own pull request targeting `dev`, with `<task-name>` used verbatim for the branch suffix and — when a change is required — the OpenSpec change-id. Commits directly on `dev`, `beta`, or `main` MUST be rejected locally by a pre-commit hook as well as remotely by the branch ruleset; the local hook MUST exempt merge commits so sync-back conflict resolution stays possible. Whether a task works in the main checkout or in a git worktree is a per-machine convention, not a repository requirement. Personal machine-local agent instruction files (gitignored `AGENTS.local.md` / `CLAUDE.local.md`) MAY impose stricter conventions such as mandatory worktrees, and agents MUST follow such a file when it exists at the repository root, with the local file winning on conflict with the shared rules.

#### Scenario: Agent cuts a task branch before editing

- **WHEN** an agent is about to make its first file edit of a session and finds the current branch is `dev`, `beta`, or `main`
- **THEN** it cuts the task branch first (`git switch -c <type>/<task-name> --no-track origin/dev`), asking the human first when the checkout carries uncommitted changes

#### Scenario: Direct commit on a long-lived branch is rejected locally

- **WHEN** a contributor or agent attempts a non-merge commit while checked out on `dev`, `beta`, or `main`
- **THEN** the pre-commit hook rejects the commit and advises cutting a task branch

#### Scenario: Sync-back merge commits remain possible

- **WHEN** a sync-back conflict resolution requires a merge commit while checked out on a long-lived branch
- **THEN** the pre-commit hook permits the merge commit, and the remote ruleset still requires the result to land through a pull request

#### Scenario: Personal local instructions override shared rules

- **WHEN** `AGENTS.local.md` or `CLAUDE.local.md` exists at the repository root
- **THEN** the agent reads and follows it, with the local file winning on conflict with the shared agent rules; when no such file exists, the shared rules apply unchanged
