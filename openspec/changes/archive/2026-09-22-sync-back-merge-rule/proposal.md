# Proposal

## Why

The release-branching spec mandates merge-commit for promotion pull requests but says nothing about the merge method for sync-back pull requests — the merges that re-converge diverged histories. A sync-back merged with squash or rebase forges new SHAs for the target branch's tip instead of making it an ancestor of the source branch, so the divergence persists and the promotion it was meant to unblock stays blocked. This was hit in practice during the 2026-09-21 promotion round (sync-back PR #98), where the automated review flagged that the PR's entire value is its merge topology while no rule pinned the method.

## What Changes

- Extend the merge-commit requirement in `release-branching` to cover sync-back pull requests: they MUST merge with the merge-commit method, for the same SHA-forging reason as promotions.
- Update the generated agent rules (via `.rulesync/`) so agents performing a sync-back know the method requirement before they merge.
- Document two structural facts of the promotion flow in the agent rules, so every developer's agent handles them without asking: (1) the required `PR review gate` status can hang at "Expected" (the review workflow does not fire for a pull request opened with conflicts and has no `synchronize` trigger) — posting a `/review` comment runs the on-demand review so the gate reports a real status; (2) the required approving review is unobtainable when the author is the repository's only active administrator, so a human administrator merges promotion and sync-back pull requests from the GitHub UI with the merge-commit method. Agents never merge promotion or sync-back pull requests themselves.
- Record the admin-merge reality as a scenario in the branch-protection requirement, so the spec stops asserting something the promotion flow cannot satisfy.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `release-branching`: the merge-commit requirement currently covers only promotion pull requests; it is extended to sync-back pull requests.

## Impact

- `openspec/specs/release-branching/spec.md` (via this change's delta)
- `.rulesync/rules/overview.md` and the regenerated `AGENTS.md` / `CLAUDE.md`
- No code, API, or dependency impact. GitHub branch-ruleset settings already permit all three merge methods; no settings change is needed.
