# Validation

Date: 2026-10-14. Branch: `feat/youtube-article-body`, stacked on `feat/podcast-article`.

## Source

The code is the legacy implementation from `unnoo/slax_reader_backend` (`feat/youtube-article-body`, commit `6986d806`) and `unnoo/slax_reader_frontend` (`feat/youtube-article-body`, commit `581e85c0`), merged file by file with `git merge-file`.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm api -- typecheck` | Passed. |
| `pnpm api -- test` with `RUN_PG_INTEGRATION_TESTS=1` on an isolated Postgres 17 | 2,230 passed, 41 skipped; only `collectionTelemetryLogs.integration.test.ts` failed, because it needs the separate logs database. |
| Migrations on an empty Postgres 17 and `prisma migrate diff --exit-code` at this branch | No difference. |
| `pnpm api -- build edge` and `build core` with the public template | Offline dry runs passed. |
| Web `vue-tsc` | Identical to `origin/dev`. |
| `pnpm web -- test` | All passed except the 2 `userLocaleFallback.spec.ts` failures that also exist on `origin/dev`. |
| `pnpm web -- build` | Passed. |
| ESLint on new Web files | 0 errors. |
| `openspec validate --all --strict` | Passed. The validator notes that this change's MODIFIED delta needs `youtube-ai-article` archived first. |

## Review

Local `REVIEW.md` review: no Important findings. The change has no migration and no new configuration.

## Not validated

No real model run and no browser check of the body swap, the side transcript, marks on the article body, or the mobile layout.
