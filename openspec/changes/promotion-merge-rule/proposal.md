# Proposal: promotion-merge-rule

## Why

The promotion-rebase-rule rests on a premise that does not hold on GitHub: "rebase replays only the patches the target branch lacks." GitHub's mergeable gate evaluates a trial merge, and when that trial merge conflicts, every merge method — rebase included — is blocked. Rebase-merging a promotion also forges new SHAs for patches the source branch already carries, so the next promotion's trial merge conflicts again on the same files. Both failure modes occurred on 2026-09-21: the dev → beta promotion (#89) and the beta → main promotion were each unmergeable until a sync-back merge commit (#91, #92) re-converged the histories.

Merging promotions with a merge commit makes the target branch contain the source branch's actual commits: histories converge instead of diverging, promotions stop conflicting, and no sync-back is needed.

## What Changes

- `.rulesync/` rules state that promotion pull requests merge with a **merge commit**, never rebase or squash, with a sync-back remedy for pre-existing divergence; regenerated agent files are committed in the same change.
- The `release-branching` spec replaces the rebase requirement with the merge-commit requirement, and the uniform-protection requirement no longer claims linear history (the ruleset no longer enforces it, so that promotion and sync-back merge commits can land).

## Capabilities

### New Capabilities

(None)

### Modified Capabilities

- `release-branching`: promotion merge method changes from rebase to merge commit; uniform protection no longer requires linear history.

## Impact

- `.rulesync/rules/overview.md` (promotion paragraph)
- Regenerated `AGENTS.md` / `CLAUDE.md`
- GitHub ruleset `release-branches` (id 4100518) was already updated out-of-band on 2026-09-21: `required_linear_history` removed, `merge` added to allowed merge methods
