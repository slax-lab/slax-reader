# Proposal

## Why

Deploying the RSS sync rules to beta exposed a PowerSync parameter-query limit failure: `PSYNC_S2305 Too many parameter query results (limit of 1000)`. The beta database has 4,225 active `sr_user` rows, while the affected account has only 2 collection subscriptions. PowerSync counts the rows returned by every parameter lookup per connection; the `subscribed_collections` stream's `open_collection_owner_ids` CTE joined `sr_user AS owner` with only `deleted_at IS NULL` as its local filter, so every connection enumerated the whole active user table and failed. The same pattern exists in `collection_bookmark_comment`, and the RSS stream has a latent version of it through its `sr_user_lab_feature` join. The incident also forced the collection streams to drop the owner tombstone check, because a correlated owner lookup reintroduces the global scan.

## What Changes

- Replace the unanchored `with` CTEs in `subscribed_collections`, `collection_bookmark_comment`, and `rss_v1` with lookups anchored on `auth.user_id()` or the client subscription parameter.
- Add a trigger-maintained `sr_user_collection.owner_deleted` flag so collection bookmarks, stats, share settings, and collection comments stop syncing immediately when an owner is soft-deleted, without joining `sr_user`.
- Keep the existing collection status gate (`status = 1`) and the RSS Labs gate unchanged.
- Add regression tests for the rules and for the `owner_deleted` trigger.
- No client schema, API contract, or UI change.

## Capabilities

### New Capabilities

- `collection-sync`: bounded, per-user collection sync lookups and owner/collection authorization gates.

### Modified Capabilities

None. The RSS Labs behavior is unchanged; its rules only move to the same bounded-lookup shape.

## Impact

- `deploy/local/powersync-local/sync_rules.yaml`
- `apps/api/prisma/pgsql.prisma` and a new PostgreSQL migration with the `owner_deleted` column, backfill, and triggers
- `apps/api/test/infra/powersyncRules.test.ts` plus a new PostgreSQL trigger integration test
- OpenSpec artifacts under `openspec/changes/local-first-ddl/`

The migration is additive and backward compatible: existing code ignores `owner_deleted`, and the column defaults to `false` with a backfill. Sync rules must be deployed after the migration.
