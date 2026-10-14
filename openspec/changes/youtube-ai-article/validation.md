# Validation

Date: 2026-10-14. Branch: `feat/youtube-ai-article`, based on `origin/dev`.

## Source

The code is the legacy implementation from `unnoo/slax_reader_backend` (`feat/youtube-article-p1`, commit `59c28fba`, base `dcc004f3`) and `unnoo/slax_reader_frontend` (`feat/youtube-article-p2`, commit `840566f9`, base `f7a1b3b6`). Each changed file was merged with `git merge-file` (legacy base, monorepo file, legacy change). Legacy `config/` and `docs/` were not ported.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm api -- typecheck` | Passed. |
| `pnpm api -- test` with `RUN_PG_INTEGRATION_TESTS=1` on an isolated Postgres 17 | All tests passed except `collectionTelemetryLogs.integration.test.ts`, which needs the separate logs database. |
| `prisma migrate deploy` on an empty Postgres 17, then `prisma migrate diff --from-config-datasource --to-schema prisma/pgsql.prisma --exit-code` | All migrations applied; no difference. |
| `pnpm api -- lint` | 0 errors. |
| `pnpm api -- build edge` and `build core` with `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example` | Offline dry runs passed; edge binds `YOUTUBE_ARTICLE_WORKFLOW`. |
| Web `vue-tsc` | 10 errors, identical to `origin/dev`. |
| `pnpm web -- test` | All passed except 2 tests in `userLocaleFallback.spec.ts`, which fail the same way on `origin/dev`. |
| ESLint on new Web files | 0 errors. |
| `openspec validate --all --strict` | Passed. |

The integration test `labRepo.integration.test.ts` already failed on `origin/dev` (it expected only `youtube`); it now expects the full Labs list.

## Review

Local `REVIEW.md` review (Bugs, Security, Compliance): one Important finding, the one-step unique-key migration. The owner accepted it; `design.md` records the risk. New UI uses existing `--slax-*` tokens and no `v-html`.

## Not validated

No run with the real model, no run inside the Workers runtime, and no browser check of the bookmark page. Vertex keys and Worker secrets are not available locally.
