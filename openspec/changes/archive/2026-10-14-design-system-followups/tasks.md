# Tasks

## 1. Close review nits

- [x] 1.1 Add an explicit translated `aria-label` to Snapshot side-panel icon controls while retaining the existing title and verify the control name in focused component tests.
- [x] 1.2 Remove the obsolete TagsHeader add-filter font declaration and verify the migrated control keeps its existing layout, focus, and responsive behavior.
- [x] 1.3 Align affected registry `defaultSize` values with the consumers' default rendered sizes, regenerate the checked-in registry, and verify `pnpm icons:check` plus focused registry/component tests.

## 2. Record bounded follow-up work

- [x] 2.1 Add `docs/design/backlog.md` covering remaining reusable Web icon families, local/renderer-owned exclusions, theme-token debt, suggested sequencing, ownership, and definition of done; verify the document links back to `DESIGN.md` and does not claim every inline SVG must migrate.
- [x] 2.2 Link the backlog from `docs/design/README.md` and `DESIGN.md`, then verify the design documentation entry points consistently identify the normative contract, runtime owners, reference snapshot, and backlog.

## 3. Validation and delivery

- [x] 3.1 Run `pnpm icons:check`, focused Web tests, `pnpm design:check`, `pnpm exec openspec validate --all --strict`, `pnpm agent:check`, and `git diff --check`; resolve Important findings before presenting the branch for review.
- [x] 3.2 Summarize the exact changed files and wait for owner review before pushing or creating the PR, following the repository delivery rule.
