# Tasks: promotion-rebase-rule

## 1. Codify the rule

- [x] 1.1 In `.rulesync/rules/overview.md`, extend the long-lived branches paragraph so it states promotion pull requests merge with rebase, never squash; verify the text appears in the source file
- [x] 1.2 Run `pnpm agent:sync` and commit the regenerated `AGENTS.md` / `CLAUDE.md` in the same commit; verify `pnpm agent:check` passes

## 2. Validation

- [x] 2.1 Run `openspec validate --all --strict` and verify it passes
- [x] 2.2 Open the PR to `dev` with `OpenSpec: promotion-rebase-rule` in the body and verify both required checks report
