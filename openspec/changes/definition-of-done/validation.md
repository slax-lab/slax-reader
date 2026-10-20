# Validation — definition-of-done

Date: 2026-10-20

Change type: process/tooling (agent rules, review policy, PR template, CI guard). No application runtime behavior changes; the running environment exercised here is the repository toolchain itself. UI-visible acceptance: n/a — the change touches no UI.

## Commands run

- `pnpm agent:sync` → regenerated `AGENTS.md`, `CLAUDE.md`, `apps/mobile/AGENTS.md` from the edited `.rulesync/` sources; `grep -n "Definition of Done" AGENTS.md CLAUDE.md` found the new section in both; the mobile evidence binding is present in `apps/mobile/AGENTS.md`.
- `pnpm exec rulesync doctor --strict` → 0 errors, 0 warnings; `pnpm exec rulesync generate --check` → "All files are up to date".
- `pnpm exec openspec instructions apply --change definition-of-done --json` → `operationGuidance` contains the new "record verification in validation.md" line.
- `pnpm exec openspec validate --all --strict` → 68 passed, 0 failed (re-run after every artifact edit; also enforced by the lefthook pre-commit hook on each commit of this branch).
- `node tooling/ci-scope.test.mjs` → 11 pass, 0 fail, after extending the `openspec` scope to the skill paths.
- `bash tooling/check-gh-aw-drift.sh` → "Compiled workflows match their sources." (gh-aw v0.88.7, matching the pin).

## Drift-check drill (task 4.1, verbatim record)

- Non-interactive invocation: `CI=1 pnpm exec openspec update`. The CLI has no `--yes` flag; source inspection of `dist/utils/interactive.js` shows all prompts are skipped when the `CI` env var is set (GitHub Actions injects `CI=true` by default).
- Clean tree: `CI=1 pnpm exec openspec update` → "All 2 tool(s) up to date (v1.13.1)"; `git status --porcelain` empty.
- Generated path list (enumerated via `git ls-files`): `.agents/skills/`, `.claude/skills/`, `.claude/commands/opsx/`. `.codex/` carries no openspec-generated files.
- Tamper detection: appended a line to `.agents/skills/openspec-apply-change/SKILL.md` and staged it (the index holding the drift is equivalent to a committed drift); `CI=1 pnpm exec openspec update` regenerated the file ("skill files differ from the generated content") and `git status --porcelain -- .agents/skills .claude/skills .claude/commands/opsx` reported `MM` — detected. Deletion-type drift is recovered via the CLI's config-sync path and surfaces as porcelain output as well.
- Caveat discovered: a naive *unstaged* tamper is restored to HEAD-identical content by the regeneration, leaving porcelain empty — a false negative that exists only in local drills, never in CI where drift is committed. The CI step therefore does not need `--force`.
- Tree restored with `git reset --hard`; the drill produced no commits.

## What was exercised

- The rulesync regeneration path end to end (source edit → `agent:sync` → doctor/generate check) — the exact path agents will follow.
- The OpenSpec apply-loop guidance surfacing in the real `openspec instructions apply` output for this change.
- The new CI step's exact body (regenerate + porcelain over the enumerated paths) run locally against a clean tree (pass) and against tampered state (detected).
- ci-scope: the OpenSpec skill paths previously triggered only the `rulesync` flag; they now also trigger `openspec` — without this fix, skill-only PRs would never run the new check.

## Not validated (declared gaps)

- ~~The new "OpenSpec skill drift check" step has not run in live CI~~ — closed on PR #297: the `agent-config drift check` job ran the new step in live CI and passed (log: "OpenSpec skill files match the pinned generator."). Locally drilled before that.
- The review agent's Compliance step-5 behavior (flagging missing/empty/contradictory evidence) is observable only after merge, on a real behavior-changing PR. The policy text was checked against the spec requirement, but its enforcement quality is unverified.
- gh v2.99.0+ `--attach` uploads were not exercised — this change produced no media evidence. The machine prerequisite landed separately in PR #287.
