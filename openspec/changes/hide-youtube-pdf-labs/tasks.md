# Tasks

## 1. Settings-only visibility

- [x] 1.1 After human proposal review, add a Settings-only predicate excluding exactly `youtube` and `pdf` near `apps/web/app/composables/useLabFeatures.ts`; verify focused unit cases cover hidden keys and other keys without mutating feature records or changing `isEnabled()`.
- [x] 1.2 Apply the predicate alongside the translation check in `apps/web/app/components/UserLabSection.vue`; update `tests/unit/components/UserLabSection.spec.ts` to verify mixed, hidden-only, untranslated, enabled/disabled/graduated inputs, unchanged hidden preferences, and RSS toggle success/rollback with no hidden-feature settings POST.
- [x] 1.3 Apply the identical visibility rule to `hasLabs` in `apps/web/app/pages/user.vue` while preserving the mounted child fetch lifecycle; update `tests/unit/pages/user.spec.ts` to verify no empty Features destination, delayed RSS loading, safe hidden-only `/user#labs`, existing RSS deep-link scrolling, and unrelated keyboard/query-preserving navigation.

## 2. Regression and rendered verification

- [x] 2.1 Prepare dependencies with `pnpm install --frozen-lockfile` and the documented Web setup/configuration flow without copying secret files; verify `pnpm --filter @apps/slax-reader-dweb type`, `pnpm --filter @slax-reader/selection typecheck`, and `pnpm web -- typecheck` pass in this worktree.
- [x] 2.2 Run the focused component/page/composable/add-bookmark suites listed in `design.md`, then `pnpm web -- test` and `pnpm web -- build`; verify all pass and that existing YouTube save and PDF upload gate assertions remain intact.
- [x] 2.3 Exercise the actual Settings page for mixed and hidden-only Labs responses with existing enabled and disabled preferences; verify English/Chinese, light/dark/e-ink, desktop/768px/narrow layouts, keyboard navigation, `/user#labs`, RSS toggling, and absence of hidden-feature settings writes, recording any missing integration evidence rather than claiming completion.
- [x] 2.4 Run `pnpm exec openspec validate --all --strict` and inspect changed comments/docstrings for obsolete row-visibility descriptions; verify validation passes and no backend policy, translations, generated rules, or unrelated task files changed.

## 3. Review and requested pull request

- [x] 3.1 Run the local Bugs, Security, and Compliance review defined in `REVIEW.md` against `hide-youtube-pdf-labs`; verify every completed task has evidence and resolve all Important findings before pushing.
- [ ] 3.2 Commit and push only this task branch after validation, then create the requested PR targeting `dev` with `OpenSpec: hide-youtube-pdf-labs`; verify the PR diff contains only this change, includes verification results and the retained Labs-gate limitation, and return its URL without merging it.

## Verification evidence

- 2026-10-14: Frozen dependency installation, Web prepare, shared selection typecheck, Web typecheck, and Web build passed with the documented synthetic development configuration.
- Focused regression suites: 4 files and 73 tests passed. Full Web suite: 189 files and 2,030 tests passed; 1 file/test skipped, no failures.
- The built `apps/web/dist/user.html` was served with the installed Wrangler Pages preview and exercised in Chrome 155.0.8059.40: 72 combinations of English/Chinese, light/dark/e-ink, 1440/768/320px widths, mixed/hidden-only features, and enabled/disabled hidden preferences passed. Assertions covered the accessibility tree, no hidden preference writes, keyboard RSS toggle success/rollback, deep-link scrolling, hidden navigation, and query-preserving focus navigation. Six representative screenshots were inspected.
- Browser API responses and session identity were synthetic fixtures; PowerSync was intentionally unavailable. This verifies the shipped Settings UI and its request contract, not real login, backend persistence, or bookmark synchronization. Local fixture script/log/screenshots remain under ignored `.local/validation/`.
- Strict OpenSpec validation: 39 passed, 0 failed. Local Bugs, Security, and Compliance review selected `hide-youtube-pdf-labs` and reported no Important findings or Nits.
