# Proposal: promotion-rebase-rule

## Why

The merge method for promotion pull requests (`dev` → `beta`, `beta` → `main`) is currently a verbal convention, and the first two promotions were already merged with squash: each squash forged a new commit on the target branch, so the three long-lived branches now hold different SHAs for identical content. Squash on every promotion diverges the histories further each time; rebase replays only the patches the target branch lacks and keeps landed commits clean. The rule needs to live where contributors and agents actually read it.

## What Changes

- The `.rulesync/` rules state that promotion pull requests MUST be merged with rebase, never squash; regenerated agent files (`AGENTS.md`, `CLAUDE.md`) are committed in the same change.
- The `release-branching` spec gains a matching requirement so the rule is part of the living spec, not just contributor documentation.

## Capabilities

### New Capabilities

(None)

### Modified Capabilities

- `release-branching`: adds the requirement that promotion pull requests merge with rebase.

## Impact

- `.rulesync/rules/overview.md` (promotion flow paragraph)
- Regenerated `AGENTS.md` / `CLAUDE.md`
- No workflow, ruleset, or settings changes
