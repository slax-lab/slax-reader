# Tasks

## 1. GitHub protection and default branch

- [x] 1.1 Add an explicit `refs/heads/main` entry to the `release-branches` ruleset's `ref_name.include` (alongside `~DEFAULT_BRANCH`, `refs/heads/dev`, `refs/heads/beta`) so `main` stays protected after the flip — applied 2026-09-23; verify with `gh api repos/slax-lab/slax-reader/rulesets/4100518 --jq '.conditions.ref_name.include'` listing all four entries
- [x] 1.2 Flip the default branch to `dev` (`gh api repos/slax-lab/slax-reader -X PATCH -f default_branch=dev` or the settings UI); verify `gh repo view slax-lab/slax-reader --json defaultBranchRef` reports `dev`
- [x] 1.3 Verify protection survived the flip: the ruleset still covers `main`, `beta`, `dev` explicitly, and `gh api repos/slax-lab/slax-reader/branches/main --jq '.protected'` reports `true`; paste the resulting ruleset conditions JSON and `defaultBranchRef` into the implementation PR description

## 2. Documentation sync

- [x] 2.1 On a `docs/dev-default-branch` task branch cut from `origin/dev`, update `.rulesync/rules/overview.md` so the long-lived-branches sentence names `dev` as the default branch, run `pnpm agent:sync`, and commit the source and regenerated files together; verify `pnpm exec rulesync generate --check` reports no drift
- [x] 2.2 Open the implementation PR to `dev` with an `OpenSpec: dev-default-branch` line; verify the `agent-config drift check` and `PR review gate` required checks report success, and merge after approval

## 3. Live verification drill

- [x] 3.1 Open a throwaway probe PR targeting `dev` and confirm both required checks (`agent-config drift check`, `PR review gate`) report on it; close it unmerged (drill precedent: #74, #29)
- [x] 3.2 Post a `/review` comment on the probe PR and confirm the on-demand review workflow runs with its definitions loaded from the `dev` branch copy (the run's workflow file ref is `dev`)

## 4. Archive

- [x] 4.1 After the implementation PR merges and the drill passes, archive this change (`openspec archive dev-default-branch`) on its own small PR and verify `openspec validate --all --strict` passes with the living spec naming `dev` as the default branch
