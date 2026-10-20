# Validation

Date: 2026-10-20. Branch: `feat/unhide-youtube-labs`, based on `origin/dev` (`a3fb949`). Worktree: `.worktrees/unhide-youtube-labs`.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | Passed. |
| `pnpm web -- test tests/unit/composables/useLabFeatures.spec.ts tests/unit/components/UserLabSection.spec.ts tests/unit/pages/user.spec.ts` | 55 tests passed. |
| `pnpm web -- test` | 2362 passed, 3 skipped, 2 failed. Both failures are in `tests/unit/stores/userLocaleFallback.spec.ts` (`optionsBaseUrl is not a function`, `finish is not a function`); `openspec/changes/youtube-ai-article/validation.md` records the same two failures on `origin/dev`, and no changed file appears in their stack traces. |
| `pnpm web -- typecheck` | 10 errors, all in `useAuth.ts`, `useNotification.ts`, `auth.global.ts`, `stores/user.ts`, and `utils/request.ts`; the same set is recorded as pre-existing on `origin/dev`. The new worktree has no `deploy/local/.env.web`, so those runtime-config values type as `unknown`. No error is in a changed file. |
| `pnpm exec eslint` on the six changed Web files | 3 `simple-import-sort/imports` errors, each also present when linting the `HEAD` version of the same file; no new lint findings. |
| `openspec validate --all --strict` | 65 passed, 0 failed. |
| `git diff --check` | Clean. |

## Review

The local pre-push review from `REVIEW.md` found no Important findings across the Bugs, Security, and Compliance passes. The diff implements `unhide-youtube-labs`, and no dependency, contract, migration, or data-access code changes.
