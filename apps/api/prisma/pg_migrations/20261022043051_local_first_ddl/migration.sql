-- AlterTable
ALTER TABLE "sr_user_collection" ADD COLUMN     "owner_deleted" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing collections from the current owner state.
UPDATE "sr_user_collection" AS c
SET "owner_deleted" = (u."deleted_at" IS NOT NULL)
FROM "sr_user" AS u
WHERE u."id" = c."owner_id"
  AND c."owner_deleted" IS DISTINCT FROM (u."deleted_at" IS NOT NULL);

-- Fill the denormalized flag on insert or when the owner changes.
CREATE OR REPLACE FUNCTION "sr_user_collection_fill_owner_deleted"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."owner_deleted" := COALESCE(
    (SELECT "deleted_at" IS NOT NULL FROM "sr_user" WHERE "id" = NEW."owner_id"),
    false
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sr_user_collection_fill_owner_deleted" ON "sr_user_collection";
CREATE TRIGGER "sr_user_collection_fill_owner_deleted"
BEFORE INSERT OR UPDATE OF "owner_id" ON "sr_user_collection"
FOR EACH ROW EXECUTE FUNCTION "sr_user_collection_fill_owner_deleted"();

-- Propagate owner deletion and restoration to existing collections.
CREATE OR REPLACE FUNCTION "sr_user_sync_owner_deleted"()
RETURNS TRIGGER AS $$
BEGIN
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
AFTER UPDATE OF "deleted_at" ON "sr_user"
FOR EACH ROW EXECUTE FUNCTION "sr_user_sync_owner_deleted"();
