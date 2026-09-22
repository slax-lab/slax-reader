BEGIN;

-- One-time reconciliation: collection_id follows the current star state.
UPDATE "sr_user_bookmark_stats" AS stats
SET "collection_id" = NULL
WHERE stats."collection_id" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM "sr_user_bookmark" AS bookmark
      WHERE bookmark."uuid" = stats."bookmark_uuid"
        AND bookmark."user_id" = stats."owner_id"
        AND bookmark."is_starred" = true
        AND bookmark."deleted_at" IS NULL
  );

INSERT INTO "sr_user_bookmark_stats" AS stats
    ("bookmark_uuid", "comment_count", "first_comment", "collection_id", "owner_id", "created_at")
SELECT bookmark."uuid", 0, NULL, collection."id", bookmark."user_id", CURRENT_TIMESTAMP
FROM "sr_user_bookmark" AS bookmark
INNER JOIN "sr_user_collection" AS collection ON collection."owner_id" = bookmark."user_id"
WHERE bookmark."is_starred" = true
  AND bookmark."deleted_at" IS NULL
ON CONFLICT ("bookmark_uuid") DO UPDATE
SET "collection_id" = EXCLUDED."collection_id",
    "owner_id" = EXCLUDED."owner_id"
WHERE stats."collection_id" IS DISTINCT FROM EXCLUDED."collection_id"
   OR stats."owner_id" IS DISTINCT FROM EXCLUDED."owner_id";

-- Maintain only the affected bookmark. Existing triggers continue to handle
-- Collection counts and the initial backfill for an open Collection.
CREATE FUNCTION "sr_user_bookmark_stats_maintain_collection_id"()
RETURNS TRIGGER AS $$
DECLARE
    target_collection_id INTEGER;
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD."is_starred" IS NOT DISTINCT FROM NEW."is_starred"
       AND OLD."deleted_at" IS NOT DISTINCT FROM NEW."deleted_at"
       AND OLD."user_id" IS NOT DISTINCT FROM NEW."user_id" THEN
        RETURN NEW;
    END IF;

    IF NEW."is_starred" = false OR NEW."deleted_at" IS NOT NULL THEN
        UPDATE "sr_user_bookmark_stats"
        SET "collection_id" = NULL,
            "owner_id" = NEW."user_id"
        WHERE "bookmark_uuid" = NEW."uuid"
          AND ("collection_id" IS NOT NULL OR "owner_id" IS DISTINCT FROM NEW."user_id");
        RETURN NEW;
    END IF;

    SELECT "id" INTO target_collection_id
    FROM "sr_user_collection"
    WHERE "owner_id" = NEW."user_id"
      AND (TG_OP = 'UPDATE' OR "status" <> 1);

    IF target_collection_id IS NULL THEN
        UPDATE "sr_user_bookmark_stats"
        SET "collection_id" = NULL,
            "owner_id" = NEW."user_id"
        WHERE "bookmark_uuid" = NEW."uuid"
          AND ("collection_id" IS NOT NULL OR "owner_id" IS DISTINCT FROM NEW."user_id");
        RETURN NEW;
    END IF;

    INSERT INTO "sr_user_bookmark_stats" AS stats
        ("bookmark_uuid", "comment_count", "first_comment", "collection_id", "owner_id", "created_at")
    VALUES (NEW."uuid", 0, NULL, target_collection_id, NEW."user_id", CURRENT_TIMESTAMP)
    ON CONFLICT ("bookmark_uuid") DO UPDATE
    SET "collection_id" = EXCLUDED."collection_id",
        "owner_id" = EXCLUDED."owner_id"
    WHERE stats."collection_id" IS DISTINCT FROM EXCLUDED."collection_id"
       OR stats."owner_id" IS DISTINCT FROM EXCLUDED."owner_id";

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sr_user_bookmark_stats_maintain_collection_id"
AFTER INSERT OR UPDATE OF "is_starred", "deleted_at", "user_id" ON "sr_user_bookmark"
FOR EACH ROW
EXECUTE FUNCTION "sr_user_bookmark_stats_maintain_collection_id"();

COMMIT;
