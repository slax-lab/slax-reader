# Design

## Context

PowerSync Sync Streams evaluates a `with` CTE by splitting its joined tables into parameter lookups. Each lookup is constrained by the filters local to that table; a join condition does not necessarily narrow the lookup. Parameter query results are counted per connection before deduplication and have their own default limit of 1,000, separate from the 1,000-bucket limit. The beta database has 4,225 active `sr_user` rows, so an unanchored `sr_user AS owner` join returns the entire table for every connection, regardless of the user's two subscriptions.

## Decisions

### Anchor collection lookups in data queries

`subscribed_collections` keeps `subscribed_collection_ids` because its `authenticated_user.uuid = auth.user_id()` filter anchors the lookup to one row. The `open_collection_owner_ids` CTE is removed. The three queries that need owner scoping use one nested subquery instead:

```sql
SELECT collection.owner_id
FROM sr_user_collection_subscriber AS subscriber
INNER JOIN sr_user_collection AS collection
  ON collection.id = subscriber.collection_id
WHERE subscriber.user_id IN current_user_id
  AND subscriber.is_deleted = false
  AND subscriber.is_active = true
  AND collection.status = 1
  AND collection.owner_deleted = false
```

The outer `subscriber.user_id IN current_user_id` is the anchor; the collection join is evaluated for the user's subscription rows, not the global collection table. The anchor must live in a data query because a CTE cannot reference another CTE such as `current_user_id`. Keeping a CTE that reaches `sr_user_collection` through an `authenticated_user` join does not work either: with 1,100 open collections it evaluated `sr_user_collection` over every open collection and returned 1,114 parameter results. The same subquery is therefore repeated in the share-settings, bookmark, and stats queries.

### Restore owner tombstones with a trigger-maintained flag

A correlated subquery such as `collection.owner_id IN (SELECT owner.id FROM sr_user AS owner WHERE owner.id = collection.owner_id AND owner.deleted_at IS NULL)` still makes `sr_user` a lookup with only `deleted_at IS NULL` as its local filter; in a 1,101-user reproduction it produced 1,107 parameter results and failed at the 1,000 limit. A rules-only fix therefore cannot restore exact tombstone semantics for the default stream.

Instead, `sr_user_collection.owner_deleted` is maintained by two triggers:

- `sr_user_collection_fill_owner_deleted` fills the flag on insert or when `owner_id` changes. A missing owner row counts as deleted.
- `sr_user_sync_owner_deleted` propagates `sr_user.deleted_at` changes and hard deletion of an `sr_user` row to every collection owned by that user.

A missing owner row is treated like a deleted owner so the flag matches the `INNER JOIN sr_user AS owner ... owner.deleted_at IS NULL` the rules used before: a collection is visible only when its owner row exists and is not soft-deleted. Two migrations implement this: `20261022043051_local_first_ddl` adds the column, backfill, and triggers, and `20261027040000_collection_owner_hard_delete` adds the missing-owner and hard-delete handling and backfills collections whose owner row is already gone. The second is a separate migration because the first has already been applied to development databases.

The migrations backfill existing rows. This is an additive expand migration: old rules and old application code ignore the column, and the trigger keeps it correct without an API write. `cleanupUserData` can still hard-delete collections later.

Propagation updates also fire the existing `sr_user_collection_stats_maintain_collection` trigger. Its UPDATE branch acts only on `status`, `display_name`, and `description` changes, so an `owner_deleted`-only update leaves collection statistics unchanged.

The `collection_bookmark_comment` stream can combine the status and tombstone checks into one anchored subquery because both are columns on `sr_user_collection`:

```sql
AND bookmark.user_id IN (
  SELECT collection.owner_id
  FROM sr_user_collection AS collection
  WHERE collection.owner_id = CAST(subscription.parameter('owner_id') AS INTEGER)
    AND collection.status = 1
    AND collection.owner_deleted = false
)
```

### Keep RSS on the same bounded pattern

The RSS stream removes both `with` CTEs and inlines subqueries anchored by `current_user_id`:

```sql
WHERE user_id IN current_user_id
  AND user_id IN (
    SELECT lab.user_id
    FROM sr_user_lab_feature AS lab
    WHERE lab.user_id IN current_user_id
      AND lab.feature = 'rss'
      AND lab.enabled = true
  )
```

Feed and entry queries use the same subscription/lab subquery for `feed_id`. This preserves the RSS Labs gate and the 20-subscription server cap. With 1,101 RSS-enabled users the stream produced 8 parameter results instead of 2,208.

The archived `rss-local-first` change (now the living `rss-labs` spec) used `rss_user_ids`/`rss_feed_ids` CTEs. This change replaces that rule shape and still satisfies the `rss-labs` "Local-first RSS list data" requirement: the same lab gate, subscription rows delivered only to their owner, shared feed and entry rows delivered only to subscribers, and the same field allowlist.

## Compatibility and rollout

- Apply both migrations before deploying the rules. The order is not enforced: PowerSync loads rules that reference a missing column without an error and evaluates the column as NULL, so `collection.owner_deleted = false` never matches. Deployed out of order, the config logs `Loaded sync config` while every subscriber silently loses collection bookmarks, statistics, share settings, and collection comments.
- After publishing the rules, `Loaded sync config` is not sufficient evidence. Confirm that a connection with an open collection subscription lists its owner bucket (`subscribed_collections|2[<owner_id>]`) in the checkpoint log and that `param_results` stays small.
- The first migration's timestamp precedes migrations already merged on `dev`; `prisma migrate deploy` applies it on a database that already has those later migrations.
- Creating the triggers briefly locks `sr_user` and `sr_user_collection`; run the migration outside peak traffic.
- The migration only adds a column with a default and creates functions/triggers; it does not rewrite or drop existing data.
- Old sync rules ignore `owner_deleted`; rollback is limited to restoring the previous rules file.
- The nested-subquery form depends on the PowerSync service supporting data-query subqueries that reference a global CTE. It was validated on `journeyapps/powersync-service` 1.26.1; beta should load the config and check the service log before clients are released.

## Risks

- A future PowerSync upgrade could change parameter-lookup planning; pin the service image and re-run the bounded-lookup checks on upgrade.
- Per-user cost is measured, not global: with N active subscriptions to distinct open collections, the default streams use `3N + 4` parameter results and `2N + 2` buckets. One user therefore reaches the 1,000 parameter limit at about 332 subscriptions, before the bucket limit at about 499. This bound no longer depends on global table size.
- `collection_bookmark_comment` still reads one owner's collection row by primary key through a subscription parameter; this is bounded by that single row, not the global collection count.
- The fill trigger takes a share lock on the owner row while holding the collection row, while the propagation trigger holds the owner row and updates collections. A no-op `owner_id` update concurrent with owner deletion could deadlock. Nothing in the repository updates `owner_id`; keep it immutable or revisit the lock order before adding such a path.

## Verification

The final rules were exercised on the branch merged with current `dev` (55 migrations) in an isolated PowerSync 1.26.1 + PostgreSQL instance; see `validation.md` for the scenario matrix, the per-subscription scaling, the original-rules baseline, and the wrong-deployment-order check.
