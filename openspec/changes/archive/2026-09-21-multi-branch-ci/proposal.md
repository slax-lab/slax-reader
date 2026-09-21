# Proposal: multi-branch-ci

## Why

The repository is moving from a single `main` branch to three long-lived environment branches: `dev` for the test environment, `beta` for the beta environment, and `main` for production, which remains the default branch. The current CI was built around `main` only: the AI review's git fallback hardcodes `origin/main` as the diff base, the branch-protection ruleset covers only the default branch, and the documented worktree convention cuts every task branch from `origin/main`. Without this change, PRs targeting `dev` or `beta` would be reviewed against the wrong diff and the new branches would sit unprotected.

## What Changes

- The agentic PR review resolves the reviewed diff against each pull request's own base branch instead of assuming `origin/main`; the hardcoded `git merge-base origin/main HEAD` example in `shared/pr-review-core.md` is replaced with base-ref-aware guidance.
- The single branch-protection ruleset is renamed from `protect` to `release-branches` and extended from `~DEFAULT_BRANCH` to also cover `refs/heads/dev` and `refs/heads/beta`, with all three branches at identical protection strength (PR-only changes, linear history, one approval with code-owner review, required checks `agent-config drift check` + `PR review gate`, no direct pushes). This is a GitHub settings change made via API/UI, not a file change; the `agent-config.yml` comment referencing the old ruleset name is updated.
- The worktree convention in `.rulesync/` changes: task branches are cut from `origin/dev` (the integration branch), not `origin/main`; regenerated agent files (`AGENTS.md`, `CLAUDE.md`, etc.) are committed in the same change.
- Deployment to the three environments is explicitly out of scope; build/test CI is out of scope until app code lands.

## Capabilities

### New Capabilities

- `release-branching`: the long-lived branch model (`dev`/`beta`/`main`), the promotion flow between them, uniform branch protection, and the branching conventions contributors and agents follow.

### Modified Capabilities

- `agentic-pr-review`: the review must identify the correct diff for pull requests targeting any protected branch, not just the default branch.

## Impact

- `.github/workflows/shared/pr-review-core.md` (review instructions; recompile `*.lock.yml` via `gh aw compile`)
- `.github/workflows/agent-config.yml` (comment only)
- `.rulesync/` sources + regenerated `AGENTS.md` / `CLAUDE.md` / `.claude/` / `.codex/` / `.agents/`
- GitHub repository settings: ruleset `protect` → `release-branches` (id 4100518), branches `dev` and `beta` (already created from `main` ahead of this change)
- Contributor workflow: feature branches now fork from and merge back into `dev`; promotion PRs flow `dev` → `beta` → `main`
