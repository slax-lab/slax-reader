# Design

## Context

PowerSync Sync Streams evaluates a `with` CTE by splitting its joined tables into parameter lookups. Each lookup is constrained by the filters local to that table; a join condition does not necessarily narrow the lookup. Parameter query results are counted per connection before deduplication and share a default limit of 1,000 with bucket counts. The beta database has 4,225 active `sr_user` rows, so an unanchored `sr_user AS owner` join returns the entire table for every connection, regardless of the user's two subscriptions.

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

The outer `subscriber.user_id IN current_user_id` is the anchor; the collection join is evaluated for the user's subscription rows, not the global collection table. The same subquery is repeated in the share-settings, bookmark, and stats queries because the stream does not allow a query to reuse another query's result.

### Restore owner tombstones with a trigger-maintained flag

A correlated subquery such as `collection.owner_id IN (SELECT owner.id FROM sr_user AS owner WHERE owner.id = collection.owner_id AND owner.deleted_at IS NULL)` still makes `sr_user` a lookup with only `deleted_at IS NULL` as its local filter; in a 1,101-user reproduction it produced 1,107 parameter results and failed at the 1,000 limit. A rules-only fix therefore cannot restore exact tombstone semantics for the default stream.

Instead, `sr_user_collection.owner_deleted` is maintained by two triggers:

- `sr_user_collection_fill_owner_deleted` fills the flag on insert or when `owner_id` changes.
- `sr_user_sync_owner_deleted` propagates `sr_user.deleted_at` changes to every collection owned by that user.

The migration backfills existing rows. This is an additive expand migration: old rules and old application code ignore the column, and the trigger keeps it correct without an API write. `cleanupUserData` can still hard-delete collections later.

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

The active `rss-local-first` change still describes the earlier `rss_user_ids`/`rss_feed_ids` CTE shape. This change supersedes that implementation detail while preserving the same lab gate, field allowlist, and subscription cap.

## Compatibility and rollout

- Apply the migration before deploying the rules: the rules reference `owner_deleted`.
- The migration only adds a column with a default and creates functions/triggers; it does not rewrite or drop existing data.
- Old sync rules ignore `owner_deleted`; rollback is limited to restoring the previous rules file.
- The nested-subquery form depends on the PowerSync service supporting data-query subqueries that reference a global CTE. It was validated on `journeyapps/powersync-service` 1.26.1; beta should load the config and check the service log before clients are released.

## Risks

- A future PowerSync upgrade could change parameter-lookup planning; pin the service image and re-run the bounded-lookup checks on upgrade.
- A user with hundreds of active collection subscriptions still contributes roughly two parameter rows per subscription and one bucket per owner/collection; the per-user limits remain, but they no longer depend on global table size.
- `collection_bookmark_comment` still reads one owner's collection row by primary key through a subscription parameter; this is bounded by that single row, not the global collection count.

## Verification

The rules were exercised in an isolated PowerSync 1.26.1 + PostgreSQL instance with 1,101 active users: defaults plus RSS produced 17 parameter results; a closed collection removed the owner bucket; a soft-deleted owner removed collection content and comments; restoring the owner brought the content back; disabling the RSS lab left the RSS stream with no buckets.
