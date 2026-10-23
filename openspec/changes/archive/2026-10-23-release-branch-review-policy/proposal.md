# Proposal

## Why

Two follow-up decisions from the merged `branch-protection-model` change:

1. The hotfix review requirement currently lives inside the `promotion integrity` gate script, because rulesets cannot condition on a pull request's head branch. That placement forces an awkward operational dance: after a hotfix pull request is approved, a human must manually re-run the gate workflow, and the failure message must teach that dance in advance. The repository in fact has more than one active administrator who can approve, so the original reason to avoid a ruleset-level review requirement on `beta`/`main` (the only active administrator could never obtain an approval on their own promotion) no longer holds. Moving the review requirement into the rulesets makes it structural and deletes the dance.
2. The agentic PR review applies the task-pull-request compliance standard to promotion and sync-back pull requests, where it cannot apply: a batch has no single `OpenSpec:` change-id and its content was already reviewed in the constituent task pull requests. This produced false-positive compliance findings on the first real promotion pull request.

## What Changes

- `beta` and `main` rulesets require one approving review (`required_approving_review_count: 1`) for every pull request, promotions and hotfixes alike. The author cannot self-approve, so a hotfix still gets a non-author review and a promotion now gets one explicit human confirmation as the release-decision act.
- The `promotion integrity` gate drops its hotfix review assertion (approver lookup, `ReviewApprovalRequired` failure kind, and the "administrator must re-run the workflow after approving" failure text), because the ruleset now covers it. The gate keeps source allowlisting, application CI evidence, and beta-deployment evidence.
- `REVIEW.md` exempts promotion pull requests (`dev`→`beta`, `beta`→`main`) and sync-back pull requests from the compliance pass's `OpenSpec:` line and Test plan evidence-trail requirements: their content was reviewed in the constituent task pull requests, and body references to in-flight evidence on such pull requests are not contradictions.
- Documentation (`.rulesync/rules/overview.md` via `pnpm agent:sync`, `docs/CI.md`) updated to describe ruleset-enforced review on `beta`/`main` and the simplified hotfix path.

Sequencing: this change's spec delta is written against the `release-branching` main spec as archived by `branch-protection-model`; its pull request must merge after the archive pull request.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `release-branching`: `beta` and `main` protection contracts require one approving review on every pull request; the hotfix review requirement moves from the `promotion integrity` gate to the rulesets.

(`agentic-pr-review` needs no delta: its requirements already delegate which pull requests count as behavior-changing, and the compliance pass's contents, to `REVIEW.md` as the single source of truth. This change edits the policy file only.)

## Impact

- `.github/rulesets.expected.json` (`release-beta`, `release-main` pull_request rule) — followed by an explicitly authorized `node tooling/rulesets.mjs apply` and a confirming `check`.
- `tooling/promotion-gate.mjs` and its test file — review assertion removed.
- `REVIEW.md` — compliance pass exemption for promotion and sync-back pull requests.
- `.rulesync/rules/overview.md` + regenerated agent files, `docs/CI.md`.
- OpenSpec: `release-branching` delta (MODIFIED requirements).
