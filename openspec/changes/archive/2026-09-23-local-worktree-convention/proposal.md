# Proposal

## Why

The mandatory worktree convention priced a parallel-work cost into every contributor's serial workflow. The team's feedback: they do not run parallel tasks on one machine, and they experience changes landing in `.worktrees/` — outside the main checkout their editor, agent sessions, and dev servers point at — as pure cost. Only one operator runs parallel agent sessions and actually needs worktree isolation.

## What Changes

- **BREAKING** (process): Retire the requirement that every task lives in an isolated git worktree. Shared rules keep only the team invariants: one task = one branch = one PR cut from `origin/dev`, never commit on `dev`/`beta`/`main`, and no parallel delta specs for the same capability.
- Worktree usage becomes a personal, machine-local convention carried by gitignored `AGENTS.local.md` / `CLAUDE.local.md` files, which agent rules instruct agents to read when present (local file wins on conflict). These files are never committed.
- Add a lefthook pre-commit guard rejecting direct commits on `dev`/`beta`/`main`, locally mirroring what the remote ruleset already enforces on push. Merge commits are exempt so the documented sync-back conflict-resolution flow stays possible.
- `.gitignore`: mark `.worktrees/` as the legacy location (old directories still exist on disk); task worktrees now live under the already-ignored `.local/` at `.local/worktrees/`.

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `release-branching`: retire `Requirement: Task branches live in isolated worktrees`; replace it with a branch-convention requirement covering the task-branch invariants, the local commit guard, and the personal local-instruction override mechanism.

## Impact

- `.rulesync/rules/overview.md` and its generated artifacts (`AGENTS.md`, `CLAUDE.md`): worktree section replaced by `Branching and Promotion` plus a `Personal Local Instructions` section.
- `lefthook.yml`: new `long-lived-branch` pre-commit guard.
- `.gitignore`: `.worktrees/` re-annotated as legacy; `.local/worktrees/` documented.
- The operator's own `AGENTS.local.md` (gitignored, machine-local, not part of the repo).
- No product code, no `apps/**` or `packages/**`, no deployment or remote operations.
