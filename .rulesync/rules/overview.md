---
root: true
targets: ["*"]
description: "Slax Reader monorepo: repository map, development workflow, and repository hygiene rules"
globs: ["**/*"]
---

# Slax Reader Monorepo

Slax Reader is an AI-powered read-it-later app: save web pages, highlight, comment, and discuss. This monorepo consolidates all non-mobile codebases (migrated from the legacy polyrepos; some directories may still be empty while migration is in progress).

## Repository Map

- `apps/web` — web frontend (the reader at r.slax.com)
- `apps/extension` — browser extension (Chrome/Edge)
- `apps/api` — API server (Cloudflare Workers: Core, Edge, AI, Browser)
- `apps/api/script/deploy` — backend deployment, setup, and resource provisioning commands
- `deploy/cloudflare` — public Cloudflare Worker template
- `deploy/local` — local api.toml/.env/.dev.vars, PostgreSQL / PowerSync Compose and shared Wrangler state
- `apps/cli` — command-line client (reader-cli)
- `packages/contracts` — shared API contracts and types used across apps
- `docs/` — documentation
- `tests/e2e` — end-to-end tests
- `tooling/` — internal tooling

## Local Development

- Package manager: **pnpm** (pinned via `packageManager` in `package.json`; Node.js >= 22.13.0 required)
- Install dependencies once at the repository root: `pnpm install --frozen-lockfile`.
- Per-app scripts live with their app. The backend exposes its concrete commands from `apps/api/package.json`; the repository root provides the abstract entry `pnpm api -- <command>` so users do not need to change directories.
- Reusable repository tooling stays at the root. API-specific configuration, Prisma schemas and migrations, generated runtime types, source and tests stay in `apps/api/`; deployment templates and local infrastructure remain in `deploy/`.
- The only public API template is `deploy/cloudflare/api.toml.example`; initialize ignored `deploy/local/api.toml` with `pnpm api -- config:init`. Dev, deploy, build and runtime types use that native Wrangler configuration (name/services/env, no custom workers tables). Local commands select env.dev if present; --env or SLAX_API_ENV explicitly selects a named environment. API-specific Prisma configs live in `apps/api/prisma/`.
- Prisma and Cloudflare operational tools automatically load ignored `deploy/local/.env` (database URLs and CLI credentials). Existing process values take precedence; setup pins local database URLs. `SLAX_API_ENV_FILE` selects an explicit file relative to the repository root or by absolute path. Build/types and dry-run plans do not load this file. Worker runtime secrets belong in ignored `deploy/local/.dev.vars` or Worker secrets, never TOML or generated Env types.
- `pnpm api -- setup:api` validates operator-provided native Wrangler configuration and keys, runs pnpm exec wrangler login once in apps/api, then runs local infrastructure setup/migrations/generation, waits for PowerSync health and exits. Start Workers separately with pnpm api -- dev; setup never launches them. setup:backend aliases setup:api; the combined dev:full command is removed. setup never writes, migrates or backs up configuration or generates keys; missing files must be supplied by the operator. The local PowerSync public key is derived from POWERSYNC_JWK_PRIVATE_KEY in .dev.vars and passed to Compose in memory; obsolete separate key files are not required or rewritten. Invalid signing keys and service failures stop startup. `--check` is read-only and does not invoke login. Cloud services still require dedicated development resources. All deployment tools honor `SLAX_API_CONFIG` (root-relative or absolute), including types, D1 and resource tools; config:init only creates the default local file. CI may check out an independent configuration repository and use the manual/reusable API deploy workflow.
- Backend validation and deployment commands must be documented through the root abstraction and preserve the distinction between local setup, offline checks and explicitly authorized remote operations.
- The runtime Worker type generator may use an isolated temporary directory to prevent secret/configuration discovery; this is an internal safety boundary, not a developer-facing working-directory requirement.

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

## Branching and Promotion

The repository has three long-lived environment branches: `dev` (the default branch), `beta`, and `main`. Changes flow `dev` → `beta` → `main` through promotion pull requests, and all three reject direct pushes. Promotion pull requests merge with a **merge commit**, never rebase or squash: rebase and squash forge new SHAs for patches the source branch already carries, and once the histories diverge GitHub's trial-merge gate blocks every merge method until a sync-back merge re-converges them. If a promotion PR reports conflicts from such divergence, merge the target branch back into the source branch first (resolving in favor of the source branch's content), then merge the promotion. Sync-back pull requests merge with a **merge commit** too: a sync-back's entire purpose is making the target branch's tip an ancestor of the source branch, and squash or rebase would forge a new SHA for that tip instead, leaving the divergence — and the blocked promotion — exactly as it was.

Two structural wrinkles when running promotions. First, the required `PR review gate` status can hang at "Expected": the review workflow does not fire for a pull request opened with conflicts, and its triggers do not include `synchronize`, so a sync-back merge does not re-trigger it. Posting a `/review` comment on the pull request runs the on-demand review, after which the gate reports a real status. Second, the required approving review is unobtainable when the author is the repository's only active administrator — self-approval does not count, and rulesets cannot exempt by a pull request's head branch. The human administrator therefore merges promotion and sync-back pull requests from the GitHub UI with the merge-commit method once the required checks are green; agents never merge promotion or sync-back pull requests themselves.

- One task = one branch = one PR: branch `<type>/<task-name>` cut from `origin/dev`, where `<type>` is the commit type of the work, e.g. `feat`, `fix`, `docs`, `chore`, `ci`. The task's pull request targets `dev`. `<task-name>` is one string, used verbatim for the branch suffix and — when a change is required — the OpenSpec change-id.
- Never commit on a long-lived branch (`dev`, `beta`, or `main`): a pre-commit hook rejects the commit locally, and the repository ruleset rejects the push remotely. Trivial fixes (typo scale, single file) also go through a branch + PR.
- Before the first file edit of a session, check where you are: if `git branch --show-current` is a long-lived branch, cut the task branch first — `git switch -c <type>/<task-name> --no-track origin/dev` — asking the human first when the checkout carries uncommitted changes.
- Parallel tasks MUST NOT carry delta specs for the same capability (`openspec/specs/<capability>/`); sequence such tasks instead. Archive a merged change promptly, via its own small PR.

## Code Review

`REVIEW.md` at the repo root is the single source of truth for review policy: review passes, Important-vs-Nit calibration, and the compliance pass against the PR's linked OpenSpec change. Any agent asked to review code or a PR MUST read and follow it. Behavior-changing PRs must name their change via an `OpenSpec: <change-id>` line in the PR body. `REVIEW.md` carries review instructions only — when editing it, never add operational documentation (triggers, gates, pausing, budget, troubleshooting); that belongs next to the workflows or in `docs/`.

Agents MUST run the local pre-push review defined in `REVIEW.md` before pushing any behavior-changing diff — on every path, not only when explicitly asked to review. Follow its compliance pass to determine the change-id without a PR body, and resolve Important findings before pushing. This is a prompt-level duty: no hook or gate verifies it, so skipping it silently is a process violation.

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

## Personal Local Instructions

If `AGENTS.local.md` or `CLAUDE.local.md` exists at the repository root, read and follow it. These files hold personal, machine-local instructions and are gitignored, so they usually do not exist — that is normal. Where a local file conflicts with this file, the local file wins.
