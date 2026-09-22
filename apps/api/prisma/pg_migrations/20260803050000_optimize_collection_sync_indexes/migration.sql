-- Optimize Collection/PowerSync bookmark reads.
-- This is intentionally partial: only visible Collection articles need the
-- created_at ordering, while normal bookmark/archive/starred lists keep using
-- their existing indexes.
CREATE INDEX IF NOT EXISTS "sr_user_bookmark_collection_visible_created_at_idx"
ON "sr_user_bookmark" ("user_id", "created_at" DESC)
INCLUDE ("id", "bookmark_id", "uuid", "alias_title", "type")
WHERE "deleted_at" IS NULL AND "is_starred" = true;

-- trigger_bookmark_sync mirrors a raw bookmark change to every owning user
-- bookmark by bookmark_id. The existing (user_id, bookmark_id) unique index
-- cannot serve that lookup because bookmark_id is its second column.
CREATE INDEX IF NOT EXISTS "sr_user_bookmark_bookmark_id_idx"
ON "sr_user_bookmark" ("bookmark_id");

-- This index was introduced for the previous dynamic subscription_end_time
-- sync predicate. Current sync rules use the materialized is_active flag, and
-- remaining subscription_end_time lookups are keyed by collection_id via
-- sr_user_collection_subscriber_collection_id_subscription_en_idx.
DROP INDEX IF EXISTS "sr_user_collection_subscriber_is_active_subscription_end_ti_idx";
