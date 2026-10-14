# Proposal

## Why

PR #109 — a colleague's test pull request from a fork — was merged straight into `main` with every required check green. Fork pull requests default their base to the upstream's default branch, and the `release-branches` ruleset applies identical protection to all three long-lived branches, so nothing in the tooling distinguishes "should land on dev" from "should land on main": the `dev → beta → main` ordering is enforced only by humans noticing the base-branch dropdown. The default branch must be the branch where day-to-day work lands — `dev` — so that unconsidered pull requests land on the integration line and `main` is only ever chosen deliberately.

## What Changes

- Switch the repository's default branch from `main` to `dev` (GitHub repository setting).
- The `release-branches` ruleset's `ref_name.include` gains an explicit `refs/heads/main` entry alongside `~DEFAULT_BRANCH`, so `main` remains fully protected once `~DEFAULT_BRANCH` resolves to `dev` (already applied 2026-09-23; recorded here for review).
- Update the documented branch convention in `.rulesync/rules/overview.md` ("`main` (the default branch)" → `dev`) and regenerate agent files with `pnpm agent:sync`.
- **Behavior note**: default-branch-loaded automation — the `/review` command workflow, the `workflow_run`-based review gate, the paused notice — loads its definitions from `dev` after the switch, so edits to those workflows take effect when they merge into `dev`, not after full promotion to `main`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `release-branching`: the "Three long-lived environment branches" requirement changes — `dev` becomes the repository's default branch instead of `main`, and the scenarios describing default-branch-loaded automation are updated accordingly.

## Impact

- GitHub settings: default branch `main` → `dev`; ruleset `release-branches` conditions (ruleset part already applied).
- Docs/agents: `.rulesync/rules/overview.md` plus regenerated `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/` in one commit.
- Automation: comment-triggered and `workflow_run` workflows load their definitions from `dev` after the switch.
- No application code changes; no deployment impact (deployment CI does not exist yet).
