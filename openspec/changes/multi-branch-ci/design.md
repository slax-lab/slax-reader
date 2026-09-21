# Design: multi-branch-ci

## Context

The repo's CI consists of exactly two kinds of workflows: the `agent-config` drift guard and the gh-aw agentic review pair (automatic + on-demand) with its companion `workflow_run` gate. None of the `pull_request` triggers filter on branches, so they already fire for PRs targeting any branch — the gaps are the hardcoded `origin/main` diff base in `shared/pr-review-core.md`, a branch ruleset scoped to `~DEFAULT_BRANCH` only, and a worktree convention that cuts task branches from `origin/main`. The `dev` and `beta` branches have already been created from `main` ahead of this change. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**

- PRs to any of `dev`/`beta`/`main` get identical CI treatment: same drift guard, same agentic review, same gate.
- The review always evaluates the diff against the PR's actual base branch.
- One ruleset protects all three long-lived branches at identical strength.
- Documented contributor/agent conventions match the new branch model.

**Non-Goals:**

- Deployment CI to the three environments (deferred; separate change).
- Build/test CI (deferred until app code lands in `apps/*`).
- A promotion guard restricting PRs to `main` to come only from `beta` (convention only for now; GitHub rulesets have no such rule, and pre-PMF volume does not justify a custom job).
- Relaxed protection on `dev` — all three branches stay at full strength.

## Decisions

- **`main` stays the default branch; there is no `prod` branch.** The `/review` command workflow and the `workflow_run`-based gate load their workflow definitions from the default branch only. Making any other branch the default would invert the mental model (review behavior would be governed by what is merged into `dev` first). Alternative considered: independent `prod` branch with `main` retired — rejected for this reason.
- **Uniform protection via a single ruleset, renamed `protect` → `release-branches`.** The existing ruleset already encodes the full desired policy (no deletion, no force-push, linear history, 1 approval + code owner, required checks, PR-only changes). Extending its `ref_name.include` to `refs/heads/dev` and `refs/heads/beta` is strictly less machinery than a layered base/strict pair. The rename keeps the settings UI meaningful once more rulesets appear; the only in-repo reference is a comment in `agent-config.yml`. Alternative considered: two tiers with a lighter `dev` — rejected, review cost is negligible at current team size and a lighter `dev` hollows out the `beta` gate.
- **Fix the diff base at the instruction level, not the trigger level.** The triggers are already branch-agnostic; only the git-fallback example in `shared/pr-review-core.md` assumes `origin/main`. The replacement guidance derives the merge base from the PR's base ref (`github.event.pull_request.base.ref` / PR tools metadata). No changes to `pr-review.md`, `pr-review-command.md`, or `pr-review-gate.yml` are needed.
- **Task branches cut from `origin/dev`.** `dev` is the integration branch, so feature work starts there; `main` receives changes only through `beta` promotion PRs. The `.rulesync/` sources are edited and `pnpm agent:sync` regenerates `AGENTS.md` and siblings in the same commit, per the generated-files rule.

## Risks / Trade-offs

- [Ruleset rename and scope change are GitHub settings, not reviewable in the PR diff] → Apply via API or UI before/with merge, and record the final ruleset JSON in the PR description for review.
- [Promotion PRs (`dev` → `beta`, `beta` → `main`) will re-run the full agentic review on diffs that were already reviewed piecemeal] → Accepted: promotion reviews act as integration review and catch cross-change conflicts; DeepSeek BYOK cost is low.
- [Changes queued in `openspec/changes/` on `dev` stay unarchived longer, widening the window for same-capability conflicts] → The existing rule (parallel tasks must not carry delta specs for the same capability) still applies; archive promptly after merge.
- [ gh CLI's OAuth token cannot write rulesets (API returns 404)] → The ruleset edit is performed by a maintainer in the GitHub UI or with a fine-grained PAT that has Administration:write.
