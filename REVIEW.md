# Review instructions

This file is the single source of truth for review policy in this repo. It is read by automated review services, by agents asked to review code, and by human reviewers.

Scope: this file carries review instructions only. Operational documentation for the review automation (triggers, gates, pausing, budget, troubleshooting) does not belong here; keep it next to the workflows or in `docs/`. Report pull requests that add such content to this file as a Compliance finding.

In CI this file is read **from the pull request's head branch**, so a pull request can adjust the policy it is reviewed under — call out any change to this file that weakens the policy as a finding.

## Passes

Run three passes and tag each finding with its pass. Classify each finding as Important or Nit (defined below).

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

Report at most five Nits per review; summarize the rest as a count. If everything you found is a Nit, lead the summary with "No Important findings."

## Compliance pass

Run this pass both for local pre-push review and for pull request review.

1. Decide whether the diff changes observable behavior (features, API changes, behavior fixes):
   - Implementation-only changes — refactors, typos, comment/doc tweaks — may skip the OpenSpec proposal, so this pass ends here for them.
   - For a pull request claiming to be implementation-only, verify that its `OpenSpec: n/a` line is present and that the claim is accurate; report an inaccurate `n/a` as an Important Compliance finding.
   - When in doubt, treat a diff that touches `apps/**` or `packages/**` as behavior-changing.
2. Determine the change-id, and state which one you settled on:
   - For a pull request, find the `OpenSpec:` line in the PR body.
   - For a local review there is no PR body. List the active changes in `openspec/changes/` (excluding `archive/`). If exactly one is active, use it. If several are active, match the diff against each change's `proposal.md` and delta specs, and use the one whose intent the diff implements. Only if no change matches, or the match is ambiguous, ask the requester.
   - If no change-id can be determined for a behavior-changing diff, report that as an Important Compliance finding.
3. Read `openspec/changes/<change-id>/`: `proposal.md`, `tasks.md`, `design.md` (if present), and the delta specs under `specs/`.
4. Verify the implementation matches the change's stated intent and that tasks marked complete are actually implemented. Report divergences as Compliance findings.

## Do not report

- Generated agent files: `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/` — rulesync drift is enforced in CI
- OpenSpec structural validity — `openspec validate --all --strict` runs in CI
- `pnpm-lock.yaml`, `node_modules/`, build outputs (e.g. `dist/`)
- Anything else CI already enforces

## Recurring findings

Patterns flagged more than once are tracked here. Before posting a finding, compare it against this list; on a match, tag the finding `[REPEAT]`.

A confirmed `[REPEAT]` may be promoted into the agent rules by a human; agents must never promote patterns into the rules on their own.

| Pattern | First seen | Date | Status |
| --- | --- | --- | --- |
| _example: request bodies logged at info level_ | _#123_ | _YYYY-MM-DD_ | _watching / promoted_ |
