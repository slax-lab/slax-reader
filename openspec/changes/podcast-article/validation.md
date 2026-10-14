# Validation

Date: 2026-10-14. Branch: `feat/podcast-article`, stacked on `feat/youtube-ai-article`.

## Source

The code is the legacy implementation from `unnoo/slax_reader_backend` (`feat/podcast-article`, commits `59c28fba..89514077`) and `unnoo/slax_reader_frontend` (`feat/podcast-article`, commits `840566f9..e4b880c9`), merged file by file with `git merge-file`. Legacy `config/` and `docs/` were not ported.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm api -- typecheck` | Passed. |
| `pnpm api -- test` with `RUN_PG_INTEGRATION_TESTS=1` on an isolated Postgres 17 | 2,219 passed, 41 skipped; only `collectionTelemetryLogs.integration.test.ts` failed, because it needs the separate logs database. |
| Podcast and YouTube repository integration tests | Passed, including orphan sweeps and the takedown script against the mapped table names. |
| `prisma migrate deploy` on an empty Postgres 17, then `prisma migrate diff --exit-code` | All migrations applied; no difference. |
| `pnpm api -- lint` | 0 errors. |
| `pnpm api -- build edge` with the public template | Offline dry run passed; edge binds `PODCAST_WORKFLOW`. |
| Web `vue-tsc` | Identical to `origin/dev`. |
| `pnpm web -- test` | All passed except the 2 `userLocaleFallback.spec.ts` failures that also exist on `origin/dev`. |
| ESLint on new Web files | 0 errors. |
| `openspec validate --all --strict` | Passed. |

The integration tests found one port defect, now fixed: raw SQL used the new model names, and `SELECT a.*` returned `video_id` instead of `source_id`.

## Review

Local `REVIEW.md` review: the legacy table rename was an Important migration finding. It is fixed with Prisma name mapping and an additive migration (see `design.md`). One Nit stays: `podcastFetch.fetchPublicText` repeats the screening of `utils/publicFetch`. `git diff --check` flags trailing whitespace only in `test/fixtures/podcast/apple-lookup.json`, a recorded Apple response kept byte for byte.

## Not validated

No real AssemblyAI or Vertex calls and no browser check. The AssemblyAI price is not confirmed against the contract.
