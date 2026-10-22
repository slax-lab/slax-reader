# UI Design Governance

Before changing UI design, styles, tokens, icons, or Vue presentation in `apps/web` or `apps/extension`, read the root `DESIGN.md`.

- `DESIGN.md` owns semantic intent, application profiles, exceptions, and the design change workflow.
- Runtime token and style files own executable values for their application.
- `docs/design/reference/` is non-normative provenance material and must not be treated as a runtime asset package.
- Keep the Web and Extension profiles separate; do not apply Web theme values to the Extension by default.
- Any visible or accessibility-affecting change follows the repository OpenSpec workflow.

# Slax Reader Monorepo

Slax Reader is an AI-powered read-it-later app: save web pages, highlight, comment, and discuss. This monorepo brings together the Web, browser extension, API, CLI, mobile apps, and shared packages; migration work remains tracked in OpenSpec.

## Repository Map

- `apps/web` — web frontend (the reader at r.slax.com)
- `apps/extension` — browser extension (Chrome/Edge)
- `apps/mobile` — Expo / React Native Android and iOS app; scoped engineering rules live in its generated `AGENTS.md`
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

- Package manager: **pnpm** (pinned via `packageManager` in `package.json`; Node.js `^22.22.2 || ^24.15.0 || >=26` required — use an LTS line, Node 25 is not supported)
- New team members set up their machine with the agent-executable runbook at `docs/LOCAL-SETUP.md`.
- Install dependencies once at the repository root: `pnpm install --frozen-lockfile`.
- Per-app scripts live with their app. The backend exposes its concrete commands from `apps/api/package.json`; the repository root provides the abstract entry `pnpm api -- <command>` so users do not need to change directories.
- CLI commands use `pnpm cli -- <command>` (`build`, `dev`, `start`, `typecheck`, `test`, `test:package`). The CLI remains the public `@slax-lab/reader-cli` package, needs no deploy environment files for build/tests, and retains its existing user config namespace. See `docs/cli/DEVELOPMENT.md` and `docs/cli/RELEASE.md`; merges into `dev`, `beta`, and `main` that change `apps/cli` and increase its stable package version automatically create channel tags and distribute validated archives. Dev/beta tags use `-dev`/`-beta` and GitHub Pre-Releases; main uses `cli-v<version>` with npm OIDC publication and matching stable GitHub Release assets.
- Reusable repository tooling stays at the root. API-specific configuration, Prisma schemas and migrations, generated runtime types, source and tests stay in `apps/api/`; deployment templates and local infrastructure remain in `deploy/`.
- The only public API template is `deploy/cloudflare/api.toml.example`; initialize ignored `deploy/local/api.toml` with `pnpm api -- config:init`. Dev, deploy, build and runtime types use that native Wrangler configuration (name/services/env, no custom workers tables). Local commands select env.dev if present; --env or SLAX_API_ENV explicitly selects a named environment. API-specific Prisma configs live in `apps/api/prisma/`.
- Prisma and Cloudflare operational tools automatically load ignored `deploy/local/.env` (database URLs and CLI credentials), using this fixed repository-relative path. Existing process values take precedence; setup pins local database URLs. Build/types and dry-run plans do not load this file. Worker runtime secrets belong in ignored `deploy/local/.dev.vars` or Worker secrets, never TOML or generated Env types.
- `pnpm api -- setup` validates operator-provided native Wrangler configuration and keys, runs pnpm exec wrangler login once in apps/api, then runs local infrastructure setup/migrations/generation through `apps/api/script/deploy/setup-backend.sh`, waits for PowerSync health and exits. Start Workers separately with pnpm api -- dev; setup never launches them. The combined dev:full command is removed. The root `pnpm setup:all` command runs API setup, Web setup, and Extension setup in order. setup never writes, migrates or backs up configuration or generates keys; missing files must be supplied by the operator. The local PowerSync public key is derived from POWERSYNC_JWK_PRIVATE_KEY in .dev.vars and passed to Compose in memory; obsolete separate key files are not required or rewritten. Invalid signing keys and service failures stop startup. `--check` is read-only and does not invoke login. Cloud services still require dedicated development resources. All deployment tools honor `SLAX_API_CONFIG` (root-relative or absolute), including types, D1 and resource tools; config:init only creates the default local file. CI may check out an independent configuration repository and use the manual/reusable API deploy workflow.
- Backend validation and deployment commands must be documented through the root abstraction and preserve the distinction between local setup, offline checks and explicitly authorized remote operations.
- The runtime Worker type generator may use an isolated temporary directory to prevent secret/configuration discovery; this is an internal safety boundary, not a developer-facing working-directory requirement.

## Package Version Decisions

- For changes to CLI, Extension, or Mobile logic, shipped UI/assets, runtime dependencies, native integration, or build/package output, assess which applications are affected. Include indirect effects from shared packages, API contracts, tooling, and configuration outside the application directory. Documentation-only or test-only changes that do not affect shipped behavior or package output are exempt.
- After preparing and validating the changes, before committing, pushing, or handing them off as ready, ask the human whether to increment the affected application's `package.json` version: CLI uses `apps/cli/package.json`, Extension uses `apps/extension/package.json`, and Mobile uses `apps/mobile/package.json`. Combine affected applications into one question, giving each current version, recommended new version/bump type, and reason. Follow an explicit version decision already given for this task without asking again.
- Continue implementation and independent checks while the decision is pending, but wait for an explicit answer before changing version metadata or finalizing the task. Do not assume either approval or refusal. If no answer is available, report the version decision as pending.
- If approved, update the affected manifests in the same task branch and PR, following each application's release constraints. CLI and Extension keep their stable source versions; CI derives channel suffixes. For Mobile, include `buildNumber` and `previousBuildNumber` in the decision as appropriate, follow `docs/mobile/RELEASE.md`, and regenerate native metadata through the existing tooling. If declined, preserve the versions and record that decision in the task/PR summary.
- Verify the relevant CI release conditions when explaining the effect of a bump. Version approval authorizes the agreed metadata change; signing, uploading, and store publication still follow their existing authorization requirements. Mobile CI currently performs checks and JavaScript bundle validation only.

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

## Definition of Done

A change that alters observable behavior is done only when the changed behavior has been exercised in a running environment; automated checks (typecheck, lint, unit and integration tests) must also run, but never substitute for the exercise. What to exercise derives from the change's delta-spec WHEN/THEN scenarios and proposal intent — they are the acceptance criteria — plus the affected app's smoke flows in its development doc; a change without an OpenSpec proposal derives smoke-level verification from its diff's touched surface and the affected app's documented smoke flows, and documentation- or typo-scale changes are exempt when they say so.

- Drive the exercise with an agent wherever an agent can operate the environment (browser-use, computer-use, API calls); human verification is reserved for what an agent cannot judge. Declaring a gap — "not verified, because …" — is acceptable evidence; silence is not.
- Record verification in `openspec/changes/<change-id>/validation.md`: commands run and results, what was exercised in the running environment, and what was not verified with the reason. Summarize it in the pull request's Test plan with a link to that file; pull request bodies follow `.github/PULL_REQUEST_TEMPLATE.md`, never free text. A change without an OpenSpec proposal has no change directory — its Test plan entry is the record.
- Screenshots and recordings upload with `gh --attach` (requires gh v2.99.0+) and are never committed to git. The text record must stand alone without the media — the automated review evaluates text only, and attachment links rot.
- UI-visible changes additionally satisfy `DESIGN.md`'s verification matrix (themes, responsive widths, recorded states), and a human exercises the change hands-on in the agent-prepared running environment before the pull request opens: requested adjustments are implemented and re-verified first, the acceptance (who, when, what was adjusted) is recorded in `validation.md`, and this step has no declared-gap path.

Per-app check commands and smoke flows: `docs/web/development.md`, `docs/extension/development.md`, `docs/api/DEVELOPMENT-DOCUMENT-EN.md`, `docs/cli/DEVELOPMENT.md`.

## Branching and Protection

The repository has three long-lived environment branches — `dev` (the default branch), `beta`, and `main` — and each gates a different decision, so each has its own protection contract. All three reject direct pushes, force-pushes, and deletion; changes reach them only through pull requests. Administrator bypass actors are configured in `pull_request` mode on every ruleset: an administrator can merge a pull request in an exceptional case, but a direct push stays rejected even for them.

- **`dev` gates individual-change quality.** A pull request targeting `dev` requires the `agent-config drift check` and `PR review gate` contexts, the six application CI gates (`Web CI gate`, `Extension CI gate`, `API CI gate`, `Mobile CI gate`, `CLI CI gate`, `Tooling CI gate`), and one approving review including a code-owner review. A suite gate reports success when its scope is not selected by the diff, so an untouched application never blocks; a failing selected suite does. All three merge methods remain available.
- **`beta` gates batch release-readiness** and has real internal consumers. Changes arrive only through pull requests headed by `dev` or `hotfix/*`. Merging requires the `promotion integrity` context and the six application CI gates, so the assembled batch is validated as a whole at entry. No approving review is required for promotions: the content was reviewed when it entered `dev`, and the merge itself is the designed release-decision act.
- **`main` gates provenance.** Changes arrive only through pull requests headed by `beta` or `hotfix/*`, and merging requires the `promotion integrity` context alone. That gate requires the six application CI gates green on the head commit and, for a `beta` head, a successful deployment of that commit to the beta environment; the suites are not separate required contexts on `main`, because the content was already gated at `beta` entry and exercised there. A `hotfix/*` head is the only sanctioned divergence from "the `main` tree is what `beta` validated", and the hotfix flow below bounds it.

Only merge-commit merging is permitted on `beta` and `main`, enforced by the rulesets' allowed merge methods, so the promotion and sync-back SHA discipline is structural rather than documented. Rebase and squash forge new SHAs for patches the source branch already carries, and once the histories diverge GitHub's trial-merge gate blocks every merge method until a sync-back merge re-converges them. If a promotion pull request reports conflicts from such divergence, merge the target branch back into the source branch first (resolving in favor of the source branch's content), then merge the promotion. Sync-back pull requests merge with a merge commit too: a sync-back's entire purpose is making the target branch's tip an ancestor of the source branch, and squash or rebase would forge a new SHA for that tip instead, leaving the divergence — and the blocked promotion — exactly as it was. `dev` keeps all merge methods available, so sync-back pull requests targeting `dev` can still use merge commits. One direction has no sync-back pull request at all: a conflicted `beta` → `main` promotion cannot be re-converged by merging `main` into `beta` through a pull request, because `beta`'s source allowlist admits only `dev` and `hotfix/*` heads. That conflict arises only when `main` moved through a hotfix, and the hotfix flow already requires propagating that same `hotfix/*` branch to `beta` before any further promotion — the mandatory propagation is the re-convergence.

The human administrator merges promotion, sync-back, and hotfix pull requests from the GitHub UI once the required checks are green; agents never merge them.

### Hotfix flow

When `beta` or `main` needs an urgent fix while the branch that would normally feed it carries changes that are not ready to promote, cut `hotfix/<name>` from the branch that needs the fix and merge it back through a pull request subject to that branch's entry conditions. A hotfix pull request requires one approving review from an approver other than its author — the content never passed through `dev`, where reviews happen — and the `promotion integrity` check asserts that review rather than the ruleset, because rulesets cannot condition on the head branch. Self-approval does not count, and API errors fail closed. The gate does not re-run itself when the approval lands (`pull_request_review` is deliberately not a trigger: that event would run the head branch's workflow file), so after the approving review lands, an administrator re-runs the gate once from the Actions page (re-run all jobs) to re-evaluate — the check's own failure message states this. The administrator's `pull_request` bypass remains for a change that genuinely cannot wait; requiring the review is what keeps the bypass an exceptional act.

Then propagate the same `hotfix/*` branch downstream with merge-commit pull requests — to `dev`, and additionally to `beta` when the hotfix landed on `main` — and start no further normal promotion until that propagation is merged. Merging the same `hotfix/*` branch keeps histories convergent; a propagation pull request headed by the fixed `main` branch would also fail `beta`'s source allowlist, which admits only `dev` or `hotfix/*` heads.

### Promotion mechanics

`PR review gate` can hang at "Expected" when a pull request targeting `dev` is opened with conflicts: the review workflow does not fire for a conflicted pull request, so no run reports on the head. The review triggers include `synchronize`, so the sync-back merge that resolves the conflicts re-triggers the review automatically; if the gate still shows no real status (for example the pull request is still conflicted, so no run fires), posting a `/review` comment runs the on-demand review, after which the gate reports a real status.

A hotfix authored by the repository's only active administrator cannot obtain its required non-author approval: self-approval does not count. The fix either waits for another approver or uses the administrator's `pull_request` bypass, which remains an exceptional act.

- One task = one branch = one PR: branch `<type>/<task-name>` cut from `origin/dev`, where `<type>` is the commit type of the work, e.g. `feat`, `fix`, `docs`, `chore`, `ci`. The task's pull request targets `dev`. `<task-name>` is one string, used verbatim for the branch suffix and — when a change is required — the OpenSpec change-id.
- Never commit on a long-lived branch (`dev`, `beta`, or `main`): a pre-commit hook rejects the commit locally, and the repository ruleset rejects the push remotely. Trivial fixes (typo scale, single file) also go through a branch + PR.
- Before the first file edit of a session, check where you are: if `git branch --show-current` is a long-lived branch, cut the task branch first — `git switch -c <type>/<task-name> --no-track origin/dev` — asking the human first when the checkout carries uncommitted changes.
- Parallel tasks MUST NOT carry delta specs for the same capability (`openspec/specs/<capability>/`); sequence such tasks instead. Archive a merged change promptly, via its own small PR.

## Code Review

`REVIEW.md` at the repo root is the single source of truth for review policy: review passes, Important-vs-Nit calibration, and the compliance pass against the PR's linked OpenSpec change. Any agent asked to review code or a PR MUST read and follow it. Behavior-changing PRs must name their change via an `OpenSpec: <change-id>` line in the PR body. `REVIEW.md` carries review instructions only — when editing it, never add operational documentation (triggers, gates, pausing, budget, troubleshooting); that belongs next to the workflows or in `docs/`.

Agents MUST run the local pre-push review defined in `REVIEW.md` before pushing any behavior-changing diff — on every path, not only when explicitly asked to review. Follow its compliance pass to determine the change-id without a PR body, and resolve Important findings before pushing. This is a prompt-level duty: no hook or gate verifies it, so skipping it silently is a process violation.

The author agent closes the review-feedback loop without waiting for a human IM reminder: poll the pull request's review comments (`gh pr view --comments`), resolve or explicitly answer every Important finding, and push the fixes. Pushing re-triggers the automated review; when no run fires for the pushed head, comment `/review` on the pull request. Human IM reminders are a fallback, not the mechanism.

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

## Documentation Language

Author all durable project documentation in English: OpenSpec artifacts (proposals, designs, tasks, specs), files under `docs/`, code comments, commit messages, and pull request bodies. Conversation with the user is unaffected. Legacy non-English documents under `docs/` (the `*_CN` / `*_JP` files migrated from the polyrepos) stay as-is; when substantially revising one that has no English counterpart, add the English version rather than only extending the translated file.

## Personal Local Instructions

At the start of every session, before any other work: if `AGENTS.local.md` exists at the repository root, read it and follow it. Its presence is visible in the working-directory listing injected into your context, so checking costs no tool call. This file holds personal, machine-local instructions and is gitignored, so it usually does not exist — that is normal. Where it conflicts with this file, it wins.
