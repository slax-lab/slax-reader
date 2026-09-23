# Design

## Context

The shared agent rules (`AGENTS.md`, generated from `.rulesync/rules/overview.md`) and the living spec `openspec/specs/release-branching/spec.md` both normatively required every task to run in an isolated git worktree. The remote ruleset already rejects pushes to `dev`/`beta`/`main`; there was no local guard. See proposal.md — Why for the motivation.

## Goals / Non-Goals

**Goals:**

- Shared rules carry only team invariants; personal workflow preferences move to machine-local files that never enter the repo.
- The local override mechanism works across agent tools (Kimi Code, Codex, Claude Code) without depending on each tool natively supporting a local-file name.
- Local commit guard does not break the documented sync-back conflict-resolution flow.

**Non-Goals:**

- No worktree helper scripts or team-wide worktree documentation — reintroduce only when a teammate actually needs parallel work.
- No changes to the promotion/sync-back flow itself, the remote ruleset, or any product code.

## Decisions

- **Layering by audience, not by role.** The dividing question for each rule: does it constrain anyone operating in this repository (shared layer), or one operator's working style (personal layer)? Branch invariants and the commit guard are shared; "always use a worktree" is personal. Alternative considered — keep a full worktree "escape hatch" section in the shared rules — rejected: the team reported the mere presence of the mandate as friction, and serial workers already have a safe non-worktree resolution for interruptions (commit WIP to their own task branch, switch, switch back).
- **Guidance line over native support.** Cross-tool loading of personal files is done by a `Personal Local Instructions` section in the shared rules telling agents to read `AGENTS.local.md` / `CLAUDE.local.md` when present (local file wins). Codex does not natively support `AGENTS.local.md` (open feature request openai/codex#26957); Kimi Code support is unverified; only Claude Code has a native mechanism. A prompt-level guidance line covers all three at zero tool-dependency cost. rulesync's `localRoot` generation was considered and rejected as unneeded machinery for a single hand-written file.
- **Merge-commit exemption in the local guard.** The guard rejects commits on `dev`/`beta`/`main` except merge commits (`git rev-parse -q --verify MERGE_HEAD`), because the documented sync-back flow resolves divergence with a merge commit while checked out on a long-lived branch. This weakens the guard only locally — the remote ruleset still forces everything through pull requests.
- **Worktree location `.local/worktrees/`.** Personal worktrees live under the already-ignored `.local/`; the old `.worktrees/` ignore entry stays (annotated legacy) because live directories still exist on disk on the operator's machine.

## Risks / Trade-offs

- The guidance line is a prompt-level mechanism: an agent could miss it, silently working without the operator's local overrides. Acceptable — the failure mode is a serial task in the main checkout, which the shared rules permit, and the local commit guard still applies.
- Teammates hitting a genuine parallel-work need have no documented shared convention until one is reintroduced; the deferred design from the PR discussion is on record and can be restored as-is.
