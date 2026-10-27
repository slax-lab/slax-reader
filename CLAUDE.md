# UI Design Governance

Before changing UI design, styles, tokens, icons, or Vue presentation in `apps/web` or `apps/extension`, read the root `DESIGN.md`.

- `DESIGN.md` owns semantic intent, application profiles, exceptions, the material-UX demo checkpoint (§10.1), the hands-on acceptance procedure (§10.2), the verification matrix (§6), and the design change workflow.
- Runtime token and style files own executable values for their application.
- `docs/design/reference/` is non-normative provenance material and must not be treated as a runtime asset package.
- Keep the Web and Extension profiles separate; do not apply Web theme values to the Extension by default.
- Any visible or accessibility-affecting change follows the repository OpenSpec workflow.

# Slax Reader Agent Rules

Slax Reader is an AI-powered read-it-later app: save web pages, highlight, comment, and discuss. This file carries non-delegable obligations and pointers only; each obligation names its owner, and `README.md` owns the repository map and setup entry points.

## OpenSpec workflow

Observable behavior goes through propose → human review of the proposal → implement → archive after merge. Implementation-only changes (refactors, typos, comment or documentation tweaks) may skip the proposal. Review proposals in conversation or local files, never in a pull request. Run `openspec validate --all --strict` before merge; it must pass.

The author archives through a docs pull request after the task pull request merges, and every `tasks.md` ends with that item. Before archiving, classify every unchecked task instead of archiving around it. Parallel tasks must not carry delta specs for the same capability; changes touching one capability are archived together or sequenced.

## Design checkpoints

A material UX change offers an optional requirements-discovery demo before dependent implementation: ask the human, recommend it with a specific reason when requirements are uncertain or structural rework is likely, and never treat it as required. When the human accepts, dependent implementation waits, feedback updates the requirements first, and the approval is recorded in the change's `proposal.md` (`DESIGN.md` §10.1); an absent demo or record is not a finding. A UI-visible change needs human hands-on acceptance before the pull request opens (`DESIGN.md` §10.2), and that step has no declared-gap path. Demo approval authorizes implementation only.

## Branches and pull requests

One task is one branch and one pull request: cut `<type>/<task-name>` from `origin/dev` and target `dev`. Never commit on `dev`, `beta`, or `main`. Agents never merge promotion, sync-back, or hotfix pull requests. Same-capability delta sequencing: see the OpenSpec obligation above. Mechanics: `docs/BRANCHING.md`.

## Verification evidence

A behavior change is done only when it has been exercised in a running environment and the evidence is recorded per `docs/DEFINITION-OF-DONE.md`. Automated checks must run but never substitute. A refactor records smoke-level verification derived from its diff's touched surface, any related living specs, and the affected app's documented smoke flows. A declared gap is acceptable evidence for agent-executable verification; UI hands-on acceptance is not. Documentation-, comment-, and typo-scale changes are exempt when the change states the exemption.

## Review

Read and follow `REVIEW.md`. Run its local pre-push review before pushing any behavior-changing diff. Behavior-changing pull requests carry `OpenSpec: <change-id>`. Close the review loop without waiting for a reminder.

## Package versions

Before committing, pushing, or handing off a change that affects CLI, Extension, or Mobile logic, shipped UI/assets, runtime dependencies, native integration, or build/package output — including indirect effects through shared packages, API contracts, tooling, and configuration outside the application directory — ask the human whether to increment each affected application's version. Documentation-only and test-only changes that do not affect shipped behavior or package output are exempt. See `docs/release/VERSIONING.md`.

## Generated artifacts

Change generated outputs only through their generator; hand edits are rejected by the pre-commit hook and the drift checks. The machine configuration is authoritative for the exact output paths.

- rulesync generates `AGENTS.md`, `CLAUDE.md`, `apps/*/AGENTS.md`, `.claude/settings.json`, and `.codex/*` from `.rulesync/**` and `rulesync.jsonc`; edit the source and run `pnpm agent:sync`, then commit both. `pnpm agent:check` and the `agent-config drift check` verify them.
- `openspec update` generates `.agents/skills/.openspec-target`, `.agents/skills/openspec-*`, `.claude/skills/openspec-*`, and `.claude/commands/opsx/*` from the pinned `@fission-ai/openspec`; they change only in deliberate tool-upgrade pull requests, and the `agent-config drift check` verifies them.
- `gh aw compile` generates `.github/workflows/*.lock.yml` and `.github/aw/**` from the workflow Markdown, `shared/**`, and `aw.json`; `tooling/check-gh-aw-drift.sh` verifies them.

## Sensitive files

Never read, print, copy, or exfiltrate secret files: `.env`, `.env.*`, `.dev.vars`, credentials, private keys. This is enforced by tooling where the tool supports it (Claude Code and Codex via generated permission rules; Kimi Code blocks `.env*` natively), and by this rule everywhere else. If you need configuration values, ask the human; they can paste the relevant non-secret shape of the config.

## Documentation language

Author all durable project documentation in English: OpenSpec artifacts, files under `docs/`, code comments, commit messages, and pull request bodies. Conversation with the user is unaffected. Legacy non-English documents under `docs/` (the `*_CN` / `*_JP` files migrated from the polyrepos) stay as-is; when substantially revising one that has no English counterpart, add the English version rather than only extending the translated file.

## Personal local instructions

At the start of every session, before any other work: if `AGENTS.local.md` exists at the repository root, read it and follow it. It is gitignored and usually absent, which is normal. Where it conflicts with this file, it wins.
