# Design: dev-default-branch

## Context

See proposal.md - Why for the motivating incident (PR #109). The facts that shape the approach, verified via the GitHub API on 2026-09-23:

- The `release-branches` ruleset covers `["~DEFAULT_BRANCH", "refs/heads/dev", "refs/heads/beta"]`. `~DEFAULT_BRANCH` is dynamic: flipping the default branch to `dev` without an explicit `refs/heads/main` entry would silently strip every protection from `main` (no PR requirement, no required checks, deletion and force-push allowed).
- GitHub rulesets cannot condition on a pull request's head branch, so "PRs to `main` must come from `beta`" is not expressible as a ruleset rule (already recorded in AGENTS.md).
- The `/review` command workflow, the paused notice, and the `workflow_run`-based review gate load their definitions from the default branch (documented in comments in `pr-review-command.md`, `pr-review-paused-notice.yml`, `pr-review-gate.yml`).
- The prior change `2026-09-21-multi-branch-ci` deliberately kept `main` as the default branch (its design.md, Decisions): making another branch the default "would invert the mental model (review behavior would be governed by what is merged into `dev` first)". This design answers that rationale head-on.

## Goals / Non-Goals

**Goals:**

- Pull requests opened without a deliberate base choice — fork PRs, quick UI edits — land on `dev`.
- `main` remains protected at identical strength through and after the flip.
- Living spec and generated agent docs match reality.

**Non-Goals:**

- A base/head pairing guard (PRs to `main` only from `beta`): deferred, consistent with the `multi-branch-ci` non-goal; revisit when the release train starts and PR volume grows.
- Promotion PR automation: deferred until the daily train exists.
- Branch-model collapse or changes to the review workflows themselves.
- Rewriting stale comments in gh-aw workflow sources that say "on `main`" (editing them requires a lock-file recompile; cosmetic follow-up).

## Decisions

- **`dev` becomes the default branch, answering the prior design's objection.** The `multi-branch-ci` design feared that review behavior would be governed by what merges into `dev` first. That inversion is now simply the working reality: every change lands on `dev` first, and `main` receives only promotions. Governing automation from `dev` matches where pull requests actually live. Governance does not weaken: every workflow-file edit is itself reviewed on its own pull request before it can act (the automatic review fires for PRs to any branch, and REVIEW.md is read from the PR head), and promotion keeps the three branches' workflow copies identical outside short windows. Loading from `dev` also shortens the iteration loop for review tooling — the pressure that historically pushed tooling fixes straight to `main` disappears. And #109 demonstrates the cost of the status quo: with `main` as default, one unnoticed dropdown defeated the entire flow, with all checks legitimately green.
- **Ruleset first, flip second — with explicit refs.** Before flipping, `refs/heads/main` was added to the ruleset's `ref_name.include` (applied 2026-09-23 via the rulesets API; a no-op today since `~DEFAULT_BRANCH` still resolves to `main`, full protection after the flip). This ordering leaves no window in which `main` is unprotected. Note: the earlier record that the gh OAuth token cannot write rulesets (404) no longer holds — the PUT succeeded with the current token.
- **Docs change rides an implementation PR, not the settings flip.** `.rulesync/rules/overview.md` is edited and `pnpm agent:sync` regenerates `AGENTS.md` and siblings in the same commit (generated-files rule). The flip and the docs PR land within the same apply session, so the window where either side is stale is minutes.
- **Verification by drill.** A throwaway probe PR to `dev` confirms the required checks report and `/review` fires from the `dev` copy; it is closed unmerged, following the drill precedent (#74, #29).

## Risks / Trade-offs

- [Default-branch flip and ruleset state are GitHub settings, invisible in the PR diff] → Record the final `defaultBranchRef` and ruleset conditions JSON in the implementation PR description (precedent: `multi-branch-ci` recorded the ruleset JSON).
- [Comment-triggered automation activates workflow edits at `dev`-merge time instead of after full promotion] → Accepted: every such edit is reviewed on its own PR before taking effect; tooling iteration speeds up; `main` still gates production deploys once deployment CI exists.
- [Residual hole: a contributor *deliberately* choosing `main` as base is still not blocked mechanically] → Accepted for now (two-person team, admin merges are deliberate); the pairing guard in Non-Goals is the tracked fix.
