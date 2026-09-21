# Slax Reader Monorepo

Slax Reader is an AI-powered read-it-later app: save web pages, highlight, comment, and discuss. This monorepo consolidates all non-mobile codebases (migrated from the legacy polyrepos; some directories may still be empty while migration is in progress).

## Repository Map

- `apps/web` — web frontend (the reader at r.slax.com)
- `apps/extension` — browser extension (Chrome/Edge)
- `apps/backend` — API server (Cloudflare Workers)
- `apps/cli` — command-line client (reader-cli)
- `packages/contracts` — shared API contracts and types used across apps
- `docs/` — documentation
- `tests/e2e` — end-to-end tests
- `tooling/` — internal tooling

## Local Development

- Package manager: **pnpm** (pinned via `packageManager` in `package.json`; Node.js >= 22.13 required, because pnpm 11.25 itself requires it)
- Install dependencies: `pnpm install`
- Per-app dev/test/build commands live in each app's own `package.json` — read it before inventing commands.

## Development Workflow — OpenSpec Required

This repo uses OpenSpec for spec-driven development. Living specs live in `openspec/specs/` (organized by product capability, not by package); in-flight work lives in `openspec/changes/`.

- Any change that alters observable behavior (features, API changes, behavior fixes) MUST go through the OpenSpec flow: propose → human reviews the proposal → implement the tasks → archive after merge.
- Starting a proposal, per tool:
  - Claude Code: `/opsx:propose`
  - Kimi Code: `/skill:openspec-propose`
  - Codex: `$openspec-propose`
  - Any tool: drive the OpenSpec CLI directly (`openspec list`, `openspec validate`, `openspec archive`).
- Implementation-only changes (refactors, typos, comment/doc tweaks) MAY skip the proposal.
- After editing specs or changes, run `openspec validate --all --strict`; it must pass before merge.

## Parallel Work — Worktree Convention

Every task — human- or agent-driven — gets its own git worktree on its own branch. Nothing is edited directly in the main checkout on a long-lived branch.

The repository has three long-lived environment branches: `dev`, `beta`, and `main` (the default branch). Changes flow `dev` → `beta` → `main` through promotion pull requests, and all three reject direct pushes. Promotion pull requests merge with a **merge commit**, never rebase or squash: rebase and squash forge new SHAs for patches the source branch already carries, and once the histories diverge GitHub's trial-merge gate blocks every merge method until a sync-back merge re-converges them. If a promotion PR reports conflicts from such divergence, merge the target branch back into the source branch first (resolving in favor of the source branch's content), then merge the promotion.

- Location: `.worktrees/<task-name>` inside this repository (gitignored); branch: `<type>/<task-name>` cut from `origin/dev`, where `<type>` is the commit type of the work, e.g. `feat`, `fix`, `docs`, `chore`, `ci`. The task's pull request targets `dev`.
- Before the first file edit of a session, check where you are: if `git rev-parse --show-toplevel` is the main checkout and `git branch --show-current` is a long-lived branch (`dev`, `beta`, or `main`), STOP. Ask the human to create a task worktree — or, with the human's approval, create it yourself: `git worktree add .worktrees/<task-name> -b <type>/<task-name> --no-track origin/dev`, then `cd` into it and run `pnpm install` before building or testing.
- One task = one worktree = one branch = one PR: `<task-name>` is one string, used verbatim for the worktree directory, the branch suffix, and — when a change is required — the OpenSpec change-id.
- Parallel tasks MUST NOT carry delta specs for the same capability (`openspec/specs/<capability>/`); sequence such tasks instead. Archive a merged change promptly, via its own small PR.
- Work only inside your own task's worktree: other directories under `.worktrees/` are other tasks' live checkouts — reading across is fine, editing across is not.
- Finishing: after the PR merges, remove the worktree (`git worktree remove .worktrees/<task-name>`) and delete the merged branch.
- Trivial fixes (typo scale, single file) MAY skip the worktree, but still go through a branch + PR — direct pushes to the long-lived branches are rejected by the repository's ruleset.

## Code Review

`REVIEW.md` at the repo root is the single source of truth for review policy: review passes, Important-vs-Nit calibration, and the compliance pass against the PR's linked OpenSpec change. Any agent asked to review code or a PR MUST read and follow it. Behavior-changing PRs must name their change via an `OpenSpec: <change-id>` line in the PR body. `REVIEW.md` carries review instructions only — when editing it, never add operational documentation (triggers, gates, pausing, budget, troubleshooting); that belongs next to the workflows or in `docs/`.

Review findings that recur are tracked in `REVIEW.md`'s "Recurring findings" section. When a human confirms a repeat, the pattern is promoted into these rules (edit `.rulesync/`, then `pnpm agent:sync`) so authoring agents avoid it from the next session. Agents must never promote patterns into the rules on their own.

## Generated Files — Do Not Hand-Edit

`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, and `.agents/` are GENERATED artifacts. Hand edits are blocked by a pre-commit hook (lefthook, auto-installed via the root `prepare` script on `pnpm install`), rejected by CI, and overwritten on the next sync.

- To change agent rules or permissions: edit `.rulesync/`, then run `pnpm agent:sync`, and commit the source and the regenerated files in the same commit.
- To change the spec workflow: edit `openspec/config.yaml`.
- OpenSpec skill/command files (e.g. `.claude/skills/openspec-*`) are owned by `openspec update`; they are refreshed only in tool-upgrade PRs, never edited by hand.

## Sensitive Files

Never read, print, copy, or exfiltrate secret files: `.env`, `.env.*`, `.dev.vars`, credentials, private keys.

- This is enforced by tooling where the tool supports it (Claude Code and Codex via generated permission rules; Kimi Code blocks `.env*` natively), and by this rule everywhere else.
- If you need configuration values, ask the human; they can paste the relevant non-secret shape of the config.
