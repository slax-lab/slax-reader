# Validation

## Commands

| Command | Result |
| --- | --- |
| `pnpm api -- gen:all` | Passed; Prisma clients, Worker types, and generated DI/router files regenerated |
| `pnpm exec prisma migrate deploy --config prisma/pgsql.config.ts` (from `apps/api`) | Passed; `20261022043051_local_first_ddl` applied to the local PostgreSQL database |
| `pnpm api -- test test/infra/powersyncRules.test.ts` | Passed; 13 tests |
| `pnpm api -- typecheck` | Passed |
| `pnpm api -- test` | Passed; 178 files, 2,307 tests passed, 72 integration tests skipped by their environment gate |
| `RUN_PG_INTEGRATION_TESTS=1 HYPERDRIVE_DATABASE_URL=postgresql://admin:admin@127.0.0.1:15432/slax-reader-backend-internal pnpm api -- test test/infra/collectionSyncOwnerState.integration.test.ts` | Passed; 1 test covering insert fill, owner deletion, restoration, and a collection created for an already-deleted owner |
| `pnpm exec openspec validate --all --strict` | Passed; 73 items |

## Running-environment exercise

An isolated `journeyapps/powersync-service` 1.26.1 instance with a PostgreSQL source and a dedicated storage database was used to exercise the final rules and the `owner_deleted` migration. A fresh database applied all 53 migrations, including `20261022043051_local_first_ddl`, before the fixture was loaded. The fixture had 1,101 active users, 1,100 collections, 1,101 collection subscription rows (1,100 unrelated to the test user), one starred bookmark/comment, 1,101 RSS-enabled users, and four RSS feeds.

| Scenario | Default stream buckets | Default stream `param_results` | Collection comment buckets | Collection comment `param_results` |
| --- | --- | --- | --- | --- |
| Owner active, collection open, RSS enabled | 9 (owner bucket present) | 17 | 1 | 3 |
| Owner soft-deleted | 3 (owner bucket removed) | 6 | 0 | 1 |
| Owner restored | 4 (owner bucket restored) | 7 | 1 | 3 |
| Collection closed | 3 (owner bucket removed) | 6 | 0 | 1 |
| RSS Lab disabled (RSS-only request) | 0 | 4 | n/a | n/a |

The original rules failed on a 1,101-user fixture with `PSYNC_S2305 Too many parameter query results (limit of 1000)` because `open_collection_owner_ids` evaluated `sr_user AS owner` over every active user. The final rules kept every tested request below the 1,000 limit, including the 1,100 unrelated subscription rows, which confirms the `subscribed_collection_ids` join is anchored by `authenticated_user.uuid = auth.user_id()`.

A concurrency check with two PostgreSQL sessions exercised the `FOR SHARE` guard: while one transaction held `sr_user.deleted_at` for a new owner, an insert into `sr_user_collection` for that owner blocked for three seconds and then returned `owner_deleted = true`. Restoring the owner set the flag back to `false`.

The migration integration test additionally confirmed that `owner_deleted` is filled on collection insert, becomes `true` immediately when the owner is marked deleted, stays `true` for a collection created while the owner is deleted, and returns to `false` when the owner is restored.

## Not verified

- The migration and rules were not applied to beta or production as part of this change; the operator deploys the migration first and then publishes the rules.
- The isolated exercise used 1,101 active users and four RSS feeds. The beta database reported 4,225 active users, 45 open collections, and 7 RSS-enabled users; the rules remove the global table scans, so the expected result is a small per-user count, but the exact beta count was not observed in this environment.
- Only PowerSync 1.26.1 was exercised. Older or newer service versions must load the config and log `Loaded sync config` before clients are released.
- No UI-visible change; no human hands-on acceptance was required.
