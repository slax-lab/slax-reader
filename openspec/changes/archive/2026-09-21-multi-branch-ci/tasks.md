# Tasks: multi-branch-ci

## 1. Review diff base fix

- [x] 1.1 Edit `.github/workflows/shared/pr-review-core.md` so the git fallback derives the merge base from the pull request's base ref (e.g. `git merge-base "origin/${{ github.event.pull_request.base.ref }}" HEAD` style guidance) instead of the hardcoded `origin/main` example; verify no remaining `origin/main` assumption in the review instructions (`grep -n "origin/main" .github/workflows/*.md .github/workflows/shared/*.md` returns no diff-base usage)
- [x] 1.2 Recompile the agentic workflows with `gh aw compile --strict --purge --no-check-update` and commit the regenerated `*.lock.yml`; verify `bash tooling/check-gh-aw-drift.sh` passes

## 2. Ruleset rename reference

- [x] 2.1 Update the comment in `.github/workflows/agent-config.yml` (line ~20) to name the `release-branches` ruleset instead of `protect`; verify `grep -rn "protect" .github/` shows no remaining ruleset-name reference

## 3. Worktree convention update

- [x] 3.1 In the `.rulesync/` source files, change the worktree/branch convention so task branches are cut from `origin/dev` and PRs target `dev`; verify the source text no longer instructs cutting task branches from `origin/main`
- [x] 3.2 Run `pnpm agent:sync` and commit the regenerated `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/` in the same commit; verify `pnpm agent:check` passes

## 4. Repository settings (maintainer action, outside the PR)

- [x] 4.1 Rename ruleset `protect` (id 4100518) to `release-branches` and extend `conditions.ref_name.include` to `["~DEFAULT_BRANCH", "refs/heads/beta", "refs/heads/dev"]` via GitHub UI or a fine-grained PAT with Administration:write (gh CLI's OAuth token gets 404 on ruleset writes); verify `gh api repos/slax-lab/slax-reader/rulesets/4100518 --jq '{name, include: .conditions.ref_name.include}'` shows the new name and all three refs with rules unchanged
- [x] 4.2 Confirm the long-lived branches exist and match `main`: `gh api repos/slax-lab/slax-reader/git/refs/heads/dev --jq .object.sha` and the same for `beta` both return the expected SHA

## 5. Validation

- [x] 5.1 Run `openspec validate --all --strict` in the worktree and verify it passes
- [x] 5.2 Open the PR to `dev` with an `OpenSpec: multi-branch-ci` line in the body and verify both required checks (`agent-config drift check`, `PR review gate`) run and report on the PR
