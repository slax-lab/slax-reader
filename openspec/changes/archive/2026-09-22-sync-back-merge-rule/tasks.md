# Tasks

## 1. Agent rules

- [x] 1.1 Update `.rulesync/rules/overview.md` (Worktree Convention section) to state that sync-back pull requests, like promotions, MUST merge with a merge commit — verify by reading the updated paragraph
- [x] 1.2 In the same section, document the two structural facts of the promotion flow for all developers' agents: a hanging `PR review gate` ("Expected") is fixed by posting a `/review` comment to run the on-demand review; the approving review is structurally unobtainable when the author is the only active administrator, so the human administrator merges promotion and sync-back pull requests from the GitHub UI with the merge-commit method, and agents never merge them — verify the text names no agent-side bypass mechanism
- [x] 1.3 Run `pnpm agent:sync` and confirm `AGENTS.md` / `CLAUDE.md` regenerate with the new content; stage source and generated files together (verify: `pnpm exec rulesync generate --check` exits clean)

## 2. Validation and PR

- [x] 2.1 Run `pnpm exec openspec validate --all --strict` and confirm the change passes
- [x] 2.2 Open the pull request targeting `dev` with an `OpenSpec: sync-back-merge-rule` line in the body — verify the PR passes the drift check and review gate
