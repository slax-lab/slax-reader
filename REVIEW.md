# Review instructions

This file is the single source of truth for review policy in this repo. It is read by AI review services (e.g. Claude Code Review), by agents asked to review code, and by human reviewers.

## Passes

Run three passes and tag each finding with its pass:

- **Bugs**: logic errors, broken edge cases, subtle regressions
- **Security**: injection risks, authentication gaps, secrets or PII in logs and error messages
- **Compliance**: the change matches its linked OpenSpec change artifacts (see below)

## What Important means here

Reserve Important for findings that:

- break behavior or introduce a regression
- lose or corrupt user data (bookmarks, highlights, comments)
- leak secrets or PII
- break the cross-app API contracts in `packages/contracts`
- diverge from the intent of the linked OpenSpec change

Style, naming, and refactoring suggestions are Nits at most.

## Cap the nits

Report at most five Nits per review; summarize the rest as a count. If everything you found is a Nit, lead the summary with "No blocking issues."

## Compliance pass

Behavior-changing PRs carry an `OpenSpec: <change-id>` line in the PR body (`n/a` when there is no behavior change).

1. Find the `OpenSpec:` line in the PR body. If the PR touches `apps/**` or `packages/**` and the line is missing, report that as an Important Compliance finding.
2. Read `openspec/changes/<change-id>/`: `proposal.md`, `tasks.md`, `design.md` (if present), and the delta specs under `specs/`.
3. Verify the implementation matches the change's stated intent and that tasks marked complete are actually implemented. Report divergences as Compliance findings.

## Do not report

- Generated agent files: `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/` — rulesync drift is enforced in CI
- OpenSpec structural validity — `openspec validate --all --strict` runs in CI
- `pnpm-lock.yaml`, `node_modules/`, build outputs (e.g. `dist/`)
- Anything else CI already enforces

## Recurring findings

Patterns flagged more than once are tracked here. Before posting a finding, compare it against this list; on a match, tag the finding `[REPEAT]`.

When a human confirms a `[REPEAT]`, the pattern is promoted into the agent rules under `.rulesync/rules/` (followed by `pnpm agent:sync`), so authoring agents avoid it from the next session onward, and the entry is marked `promoted`. Agents must never promote patterns into the rules on their own.

| Pattern | First seen | Date | Status |
| --- | --- | --- | --- |
| _example: request bodies logged at info level_ | _#123_ | _YYYY-MM-DD_ | _watching / promoted_ |
