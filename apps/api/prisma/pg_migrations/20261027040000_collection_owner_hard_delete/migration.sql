-- Treat a collection whose owner row no longer exists like one whose owner is
-- deleted, matching the INNER JOIN on sr_user that the sync rules used before
-- owner_deleted existed.

-- Backfill collections whose owner row is missing.
UPDATE "sr_user_collection" AS c
SET "owner_deleted" = true
WHERE c."owner_deleted" = false
  AND NOT EXISTS (SELECT 1 FROM "sr_user" AS u WHERE u."id" = c."owner_id");

-- A missing owner row is treated as deleted when a collection is written.
CREATE OR REPLACE FUNCTION "sr_user_collection_fill_owner_deleted"()
RETURNS TRIGGER AS $$
DECLARE
  owner_is_deleted BOOLEAN;
BEGIN
  -- Serialize with a concurrent sr_user.deleted_at change so the insert cannot
  -- read a stale owner state.
  SELECT (u."deleted_at" IS NOT NULL)
  INTO owner_is_deleted
  FROM "sr_user" AS u
  WHERE u."id" = NEW."owner_id"
  FOR SHARE;

  NEW."owner_deleted" := COALESCE(owner_is_deleted, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Propagate hard deletion as well as soft deletion and restoration.
CREATE OR REPLACE FUNCTION "sr_user_sync_owner_deleted"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "sr_user_collection"
    SET "owner_deleted" = true
    WHERE "owner_id" = OLD."id"
      AND "owner_deleted" = false;
    RETURN OLD;
  END IF;

  IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
    UPDATE "sr_user_collection"
    SET "owner_deleted" = (NEW."deleted_at" IS NOT NULL)
    WHERE "owner_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sr_user_sync_owner_deleted" ON "sr_user";
CREATE TRIGGER "sr_user_sync_owner_deleted"
AFTER UPDATE OF "deleted_at" OR DELETE ON "sr_user"
FOR EACH ROW EXECUTE FUNCTION "sr_user_sync_owner_deleted"();
