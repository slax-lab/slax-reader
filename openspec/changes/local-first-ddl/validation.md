# Validation

All results below were produced on the task branch merged with current `dev`, with 56 PostgreSQL migrations including `20261022043051_local_first_ddl` and `20261027040000_collection_owner_hard_delete`. Database work ran in a disposable PostgreSQL 17 container, separate from the developer's local stack, which kept running throughout.

## Commands

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `SLAX_API_CONFIG=<local api.toml> pnpm api -- gen:all` | Passed; no tracked generated-file drift |
| `pnpm api -- typecheck` | Passed |
| `pnpm api -- lint` | Passed; 0 errors, no warnings in changed files |
| `pnpm api -- test` | Passed; 192 files, 2,503 tests passed, 112 skipped by their environment gate |
| `RUN_PG_INTEGRATION_TESTS=1 RUN_COLLECTION_READ_SQL=1 HYPERDRIVE_DATABASE_URL=… LOGS_DATABASE_URL=… FORK_TEST_DATABASE_URL=… pnpm api -- test test/infra` | Passed; 39 files, 292 tests, including all ten PostgreSQL integration files (new owner-state test, Collection triggers and telemetry, lab, mark, tag, podcast, YouTube article, Collection read pagination, and 39 bookmark-fork tests). Only the payment and account-revocation files skipped here; they run under `test:integration:local` below |
| `pnpm api -- test:setup:local` | Passed while the local `dev-powersync` held port 18080: migrated databases, both PowerSync services healthy, isolated ports and volumes |
| `pnpm api -- test:integration:local` | Passed; pgsql and logs migrations plus all eight suites, including `paymentPostgres` (19) and `accountRevocationPostgres` (12) |
| `FORK_SMOKE=1 pnpm api -- test:http` | Passed; migrations, readiness, CORS, 401 cases, every fork format and lifecycle check, and bookmark add/list/delete through PostgreSQL, logs, and D1 |
| `pnpm exec openspec validate --all --strict` | Passed; 78 items |
| `pnpm agent:check` | Passed |

`test:setup:local` previously failed with "port is already allocated" whenever a developer's PowerSync was running: the smoke rewrote only `127.0.0.1:18080:`, while `deploy/local/dockerfile-local-pgsql.yaml` publishes `"18080:8080"` on all interfaces for mobile LAN development. The smoke now rewrites that binding to an ephemeral loopback port and asserts that no fixed host port remains; the assertion fails on the old rewrite and passes on the new one.

## Running-environment exercise

PowerSync 1.26.1 ran against the disposable PostgreSQL. The fixture had 1,101 active users, 1,100 open collections, 1,100 subscription rows unrelated to the test user plus the test user's own subscriptions, one starred bookmark with a comment, 1,101 RSS-enabled users, and four RSS feeds with 100 entries. Both the open-collection count and the active-user count exceed the 1,000 parameter limit.

| Scenario | Default stream buckets | Default stream `param_results` | Collection comment buckets | Collection comment `param_results` |
| --- | --- | --- | --- | --- |
| Original rules (`dev` at `7089a16e`) | `PSYNC_S2305` | `PSYNC_S2305` | `PSYNC_S2305` | `PSYNC_S2305` |
| Owner active, collection open, RSS enabled | 9 (owner bucket present) | 17 | 1 | 3 |
| Owner soft-deleted | 3 (owner bucket removed) | 6 | 0 | 1 |
| Owner restored | 4 (owner bucket restored) | 7 | 1 | 3 |
| Collection closed | 3 (owner bucket removed) | 6 | 0 | 1 |
| RSS Lab disabled (RSS-only request) | 0 | 4 | n/a | n/a |
| Owner row hard-deleted | 3 (owner bucket removed) | 6 | 0 | 1 |

The owner bucket was identified as `subscribed_collections|2[<owner_id>]` in the checkpoint log. Toggling the owner's deletion state left the `sr_user_collection_stats` row unchanged, confirming the stats trigger ignores `owner_deleted`-only updates.

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

The final rules were loaded against a database without the `owner_deleted` column and triggers. PowerSync logged `Loaded sync config` with no error, the default streams returned 3 buckets with no owner bucket, and the collection comment stream returned no buckets: collection content is hidden silently, not rejected. The migrations must be applied first, and the post-deploy check must look for the owner bucket rather than only the config-load log.

### Migrations

- Beta-like state: every `dev` migration except the two new ones (54), with a live owner's collection, a soft-deleted owner's collection, and a collection whose owner row is missing. `prisma migrate deploy` with the full set applied both older-timestamped migrations and backfilled `live = false`, `soft = true`, `orphan = true`; the propagation trigger covers `UPDATE` and `DELETE`; re-running deploy was a no-op.
- Development database that had applied only the first migration: an orphaned collection stayed `false`, and deploying the second migration changed it to `true`.
- Concurrency: while one session held an owner's `deleted_at` update, an insert into `sr_user_collection` for that owner blocked for three seconds and then returned `owner_deleted = true`.

## Not verified

- The migrations and rules were not applied to beta or production; the operator applies both migrations first and then publishes the rules.
- The beta counts (4,225 active users, 45 open collections, 7 RSS-enabled users) were reported by the operator and not observed here; the fixture exceeds them on users and open collections.
- Only PowerSync 1.26.1 was exercised.
- No UI-visible change; no human hands-on acceptance is required.
