# Tasks: promotion-merge-rule

## 1. Codify the rule

- [x] 1.1 In `.rulesync/rules/overview.md`, rewrite the promotion sentence: promotions merge with a merge commit, never rebase or squash, plus the sync-back remedy for pre-existing divergence
- [x] 1.2 Run `pnpm agent:sync` and commit the regenerated `AGENTS.md` / `CLAUDE.md` in the same commit; verify `pnpm agent:check` passes

## 2. Validation

- [x] 2.1 Run `openspec validate --all --strict` and verify it passes
- [ ] 2.2 Open the PR to `dev` with `OpenSpec: promotion-merge-rule` in the body and verify both required checks report
