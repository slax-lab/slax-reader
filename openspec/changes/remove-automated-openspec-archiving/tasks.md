# Tasks

## 1. Remove archive automation

- [x] 1.1 Delete the dedicated archive workflow and contract test, update `package.json`, regenerate gh-aw outputs with orphan purging, and verify `pnpm test:ci` passes without the deleted test.
- [x] 1.2 Remove automatic archive guidance from `docs/CI.md` and `openspec/config.yaml`, then verify the remaining text describes only author-driven archive pull requests.

## 2. Verify the removal

- [x] 2.1 Run `pnpm agent:check`, `pnpm exec openspec validate --all --strict`, and `git diff --check`; search non-historical files and confirm no dedicated archive workflow, trigger, variable reference, or living archive requirement remains.
- [x] 2.2 Record the exercised checks and the post-merge variable-deletion step in `validation.md`, then complete the local Bugs, Security, and Compliance review with no Important findings.

## Workflow follow-up

- After the implementation PR merges, confirm no archive evaluation is running and delete `OPENSPEC_ARCHIVE_ENABLED`.
- Archive this change through a separate documentation PR and verify the living `openspec-change-archiving` spec is removed.
