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

- Package manager: **pnpm** (pinned via `packageManager` in `package.json`; Node.js >= 20.19 required)
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

## Code Review

`REVIEW.md` at the repo root is the single source of truth for review policy: review passes, Important-vs-Nit calibration, and the compliance pass against the PR's linked OpenSpec change. Any agent asked to review code or a PR MUST read and follow it. Behavior-changing PRs must name their change via an `OpenSpec: <change-id>` line in the PR body.

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
