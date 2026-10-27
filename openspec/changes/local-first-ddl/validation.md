# Validation

All results below were produced on the task branch merged with current `dev` (`c817d0bb`, 55 PostgreSQL migrations) unless a row says otherwise.

## Commands

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `SLAX_API_CONFIG=<local api.toml> pnpm api -- gen:all` | Passed; no tracked generated-file drift |
| `pnpm api -- typecheck` | Passed |
| `pnpm api -- test` | Passed; 192 files, 2,503 tests passed, 112 skipped by their environment gate |
| `pnpm api -- test test/infra/powersyncRules.test.ts` | Passed; 13 tests |
| `RUN_PG_INTEGRATION_TESTS=1 HYPERDRIVE_DATABASE_URL=<disposable migrated database> pnpm api -- test test/infra/collectionSyncOwnerState.integration.test.ts test/infra/collectionTriggers.integration.test.ts` | Passed; 2 tests: the new owner-state test (insert fill, `owner_id` reassignment, deletion, restoration, collection created for a deleted owner) and the existing Collection trigger test |
| `pnpm exec openspec validate --all --strict` | Passed; 78 items |
| `pnpm api -- test:setup:local` | Not completed; see Not verified |

## Running-environment exercise

An isolated `journeyapps/powersync-service` 1.26.1 instance with a disposable PostgreSQL source and storage database exercised the final rules. The fixture had 1,101 active users, 1,100 open collections, 1,100 subscription rows unrelated to the test user plus the test user's own subscriptions, one starred bookmark with a comment, 1,101 RSS-enabled users, and four RSS feeds with 100 entries. Both the open-collection count and the active-user count exceed the 1,000 parameter limit.

| Scenario | Default stream buckets | Default stream `param_results` | Collection comment buckets | Collection comment `param_results` |
| --- | --- | --- | --- | --- |
| Original rules (`dev` at `7089a16e`) | `PSYNC_S2305` | `PSYNC_S2305` | `PSYNC_S2305` | `PSYNC_S2305` |
| Owner active, collection open, RSS enabled | 9 (owner bucket present) | 17 | 1 | 3 |
| Owner soft-deleted | 3 (owner bucket removed) | 6 | 0 | 1 |
| Owner restored | 4 (owner bucket restored) | 7 | 1 | 3 |
| Collection closed | 3 (owner bucket removed) | 6 | 0 | 1 |
| RSS Lab disabled (RSS-only request) | 0 | 4 | n/a | n/a |

The owner bucket was identified as `subscribed_collections|2[<owner_id>]` in the checkpoint log. The backfill marked no rows on the fixture because no owner was deleted; soft deletion and restoration flipped `owner_deleted` through the trigger.

### Per-subscription cost

The test user subscribed to N open collections with distinct owners (default streams only):

| N | Buckets | `param_results` |
| --- | --- | --- |
| 1 | 4 | 7 |
| 5 | 12 | 19 |
| 20 | 42 | 64 |
| 100 | 202 | 304 |

This fits `param_results = 3N + 4` and `buckets = 2N + 2`: one user reaches the 1,000 parameter limit at about 332 subscriptions, independent of the global table sizes.

### Deployment order

The final rules were loaded against a database with every migration except the `owner_deleted` column and triggers. PowerSync logged `Loaded sync config` with no error. The default streams returned 3 buckets with no owner bucket, and the collection comment stream returned no buckets: collection content is hidden silently, not rejected. The migration must be applied first, and the post-deploy check must look for the owner bucket rather than only the config-load log.

A separate check applied all `dev` migrations without this one, then ran `prisma migrate deploy` with the full set; the older-timestamped `20261022043051_local_first_ddl` was applied and created the column and both triggers.

### Triggers

- Toggling an owner's `deleted_at` left the existing `sr_user_collection_stats` row unchanged, confirming the stats trigger ignores `owner_deleted`-only updates.
- On commit `bf4c7a0f`, two PostgreSQL sessions exercised the `FOR SHARE` guard: while one transaction held an owner's `deleted_at` update, an insert into `sr_user_collection` for that owner blocked for three seconds and then returned `owner_deleted = true`.

## Not verified

- `pnpm api -- test:setup:local` applied every migration, including this one, but could not start PowerSync: the developer's running `dev-powersync` holds port 18080, and the smoke only rewrites `127.0.0.1:18080:` while `deploy/local/dockerfile-local-pgsql.yaml` publishes `"18080:8080"`. This is a pre-existing tooling limitation. The local development stack was not stopped; the isolated PowerSync exercise above covers the same rules file on a fully migrated database.
- The migration and rules were not applied to beta or production; the operator applies the migration first and then publishes the rules.
- The beta counts (4,225 active users, 45 open collections, 7 RSS-enabled users) were reported by the operator and not observed here; the fixture exceeds them on users and open collections.
- Only PowerSync 1.26.1 was exercised.
- No UI-visible change; no human hands-on acceptance is required.
