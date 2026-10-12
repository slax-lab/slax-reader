BEGIN;

-- Prisma owns the table shape. Trigger-only behavior is kept in this migration.
CREATE TABLE "sr_user_collection_stats" (
    "id" SERIAL NOT NULL,
    "collection_id" INTEGER NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "starred_count" INTEGER NOT NULL DEFAULT 0,
    "subscriber_count" INTEGER NOT NULL DEFAULT 0,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_user_collection_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sr_user_collection_stats_collection_id_key"
ON "sr_user_collection_stats"("collection_id");

CREATE UNIQUE INDEX "sr_user_collection_stats_owner_id_key"
ON "sr_user_collection_stats"("owner_id");

-- New bookmarks can be inserted in batches during imports. Aggregate the new
-- visible Collection articles per owner and write each stats row once.
CREATE OR REPLACE FUNCTION "sr_user_collection_stats_after_bookmark_insert"()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE "sr_user_collection_stats" AS stats
    SET "starred_count" = stats."starred_count" + inserted."delta",
        "last_modified_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
    FROM (
        SELECT "user_id" AS "owner_id", COUNT(*)::integer AS "delta"
        FROM inserted_bookmarks
        WHERE "is_starred" = true
          AND "deleted_at" IS NULL
        GROUP BY "user_id"
    ) AS inserted
    WHERE stats."owner_id" = inserted."owner_id";

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sr_user_collection_stats_starred_insert" ON "sr_user_bookmark";
CREATE TRIGGER "sr_user_collection_stats_starred_insert"
AFTER INSERT ON "sr_user_bookmark"
REFERENCING NEW TABLE AS inserted_bookmarks
FOR EACH STATEMENT
EXECUTE FUNCTION "sr_user_collection_stats_after_bookmark_insert"();

-- Reuse the existing timestamp trigger for star/unstar and soft-delete changes.
-- It is restricted to relevant columns so metadata-only PowerSync mirrors do
-- not invoke it.
CREATE OR REPLACE FUNCTION "trigger_user_bookmark_before_update"()
RETURNS TRIGGER AS $$
DECLARE
    counted_before BOOLEAN := OLD."is_starred" = true AND OLD."deleted_at" IS NULL;
    counted_after BOOLEAN := NEW."is_starred" = true AND NEW."deleted_at" IS NULL;
BEGIN
    IF OLD."is_starred" IS DISTINCT FROM NEW."is_starred" THEN
        IF NEW."is_starred" = true THEN
            NEW."starred_at" = CURRENT_TIMESTAMP;
        ELSE
            NEW."starred_at" = NULL;
        END IF;
    END IF;

    IF OLD."archive_status" IS DISTINCT FROM NEW."archive_status" THEN
        IF NEW."archive_status" = 1 THEN
            NEW."archived_at" = CURRENT_TIMESTAMP;
        ELSE
            NEW."archived_at" = NULL;
        END IF;
    END IF;

    IF OLD."user_id" IS DISTINCT FROM NEW."user_id" THEN
        IF counted_before THEN
            UPDATE "sr_user_collection_stats"
            SET "starred_count" = GREATEST("starred_count" - 1, 0),
                "last_modified_at" = CURRENT_TIMESTAMP,
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "owner_id" = OLD."user_id";
        END IF;

        IF counted_after THEN
            UPDATE "sr_user_collection_stats"
            SET "starred_count" = "starred_count" + 1,
                "last_modified_at" = CURRENT_TIMESTAMP,
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "owner_id" = NEW."user_id";
        END IF;
    ELSIF counted_before IS DISTINCT FROM counted_after THEN
        UPDATE "sr_user_collection_stats"
        SET "starred_count" = GREATEST(
                "starred_count" + CASE WHEN counted_after THEN 1 ELSE -1 END,
                0
            ),
            "last_modified_at" = CURRENT_TIMESTAMP,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "owner_id" = NEW."user_id";
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sr_user_collection_stats_starred_update" ON "sr_user_bookmark";
DROP TRIGGER IF EXISTS "trigger_user_bookmark_before_update" ON "sr_user_bookmark";
CREATE TRIGGER "trigger_user_bookmark_before_update"
BEFORE UPDATE OF "is_starred", "archive_status", "deleted_at", "user_id" ON "sr_user_bookmark"
FOR EACH ROW
EXECUTE FUNCTION "trigger_user_bookmark_before_update"();

-- Reuse the existing hard-delete trigger. Transition rows let one bulk DELETE
-- remove bookmark stats and update each Collection owner only once.
CREATE OR REPLACE FUNCTION "sr_user_bookmark_stats_delete_with_bookmark"()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM "sr_user_bookmark_stats" AS stats
    USING deleted_bookmarks AS bookmark
    WHERE stats."bookmark_uuid" = bookmark."uuid";

    UPDATE "sr_user_collection_stats" AS stats
    SET "starred_count" = GREATEST(stats."starred_count" - deleted."delta", 0),
        "last_modified_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
    FROM (
        SELECT "user_id" AS "owner_id", COUNT(*)::integer AS "delta"
        FROM deleted_bookmarks
        WHERE "is_starred" = true
          AND "deleted_at" IS NULL
        GROUP BY "user_id"
    ) AS deleted
    WHERE stats."owner_id" = deleted."owner_id";

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sr_user_collection_stats_starred_delete" ON "sr_user_bookmark";
DROP TRIGGER IF EXISTS "sr_user_bookmark_stats_delete_with_bookmark" ON "sr_user_bookmark";
CREATE TRIGGER "sr_user_bookmark_stats_delete_with_bookmark"
AFTER DELETE ON "sr_user_bookmark"
REFERENCING OLD TABLE AS deleted_bookmarks
FOR EACH STATEMENT
EXECUTE FUNCTION "sr_user_bookmark_stats_delete_with_bookmark"();

-- Subscriber rows are immutable with respect to collection_id. Separate
-- statement triggers are the minimum needed to use transition tables and avoid
-- N updates to one Collection during bulk cleanup.
CREATE OR REPLACE FUNCTION "sr_user_collection_stats_after_subscriber_insert"()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE "sr_user_collection_stats" AS stats
    SET "subscriber_count" = stats."subscriber_count" + inserted."delta",
        "updated_at" = CURRENT_TIMESTAMP
    FROM (
        SELECT "collection_id", COUNT(*)::integer AS "delta"
        FROM inserted_subscribers
        GROUP BY "collection_id"
    ) AS inserted
    WHERE stats."collection_id" = inserted."collection_id";

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "sr_user_collection_stats_after_subscriber_delete"()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE "sr_user_collection_stats" AS stats
    SET "subscriber_count" = GREATEST(stats."subscriber_count" - deleted."delta", 0),
        "updated_at" = CURRENT_TIMESTAMP
    FROM (
        SELECT "collection_id", COUNT(*)::integer AS "delta"
        FROM deleted_subscribers
        GROUP BY "collection_id"
    ) AS deleted
    WHERE stats."collection_id" = deleted."collection_id";

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sr_user_collection_stats_subscriber_insert" ON "sr_user_collection_subscriber";
CREATE TRIGGER "sr_user_collection_stats_subscriber_insert"
AFTER INSERT ON "sr_user_collection_subscriber"
REFERENCING NEW TABLE AS inserted_subscribers
FOR EACH STATEMENT
EXECUTE FUNCTION "sr_user_collection_stats_after_subscriber_insert"();

DROP TRIGGER IF EXISTS "sr_user_collection_stats_subscriber_update" ON "sr_user_collection_subscriber";
DROP TRIGGER IF EXISTS "sr_user_collection_stats_subscriber_delete" ON "sr_user_collection_subscriber";
CREATE TRIGGER "sr_user_collection_stats_subscriber_delete"
AFTER DELETE ON "sr_user_collection_subscriber"
REFERENCING OLD TABLE AS deleted_subscribers
FOR EACH STATEMENT
EXECUTE FUNCTION "sr_user_collection_stats_after_subscriber_delete"();

-- One Collection trigger initializes/removes stats and touches last_modified_at
-- only for the two public metadata fields requested by the business.
CREATE OR REPLACE FUNCTION "sr_user_collection_stats_maintain_collection"()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO "sr_user_collection_stats" (
            "collection_id",
            "owner_id",
            "starred_count",
            "subscriber_count",
            "last_modified_at",
            "created_at",
            "updated_at"
        )
        VALUES (
            NEW."id",
            NEW."owner_id",
            (SELECT COUNT(*)::integer
             FROM "sr_user_bookmark" AS bookmark
             WHERE bookmark."user_id" = NEW."owner_id"
               AND bookmark."is_starred" = true
               AND bookmark."deleted_at" IS NULL),
            (SELECT COUNT(*)::integer
             FROM "sr_user_collection_subscriber" AS subscriber
             WHERE subscriber."collection_id" = NEW."id"),
            GREATEST(
                NEW."updated_at",
                COALESCE((
                    SELECT MAX(COALESCE(bookmark."starred_at", bookmark."updated_at", bookmark."created_at"))
                    FROM "sr_user_bookmark" AS bookmark
                    WHERE bookmark."user_id" = NEW."owner_id"
                      AND bookmark."is_starred" = true
                      AND bookmark."deleted_at" IS NULL
                ), NEW."updated_at")
            ),
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        );

        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        DELETE FROM "sr_user_collection_stats"
        WHERE "collection_id" = OLD."id";

        RETURN OLD;
    END IF;

    IF OLD."display_name" IS DISTINCT FROM NEW."display_name"
       OR OLD."description" IS DISTINCT FROM NEW."description" THEN
        UPDATE "sr_user_collection_stats"
        SET "last_modified_at" = CURRENT_TIMESTAMP,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "collection_id" = NEW."id";
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sr_user_collection_stats_init" ON "sr_user_collection";
DROP TRIGGER IF EXISTS "sr_user_collection_stats_drop" ON "sr_user_collection";
DROP TRIGGER IF EXISTS "sr_user_collection_stats_touch_metadata" ON "sr_user_collection";
CREATE TRIGGER "sr_user_collection_stats_maintain_collection"
AFTER INSERT OR UPDATE OR DELETE ON "sr_user_collection"
FOR EACH ROW
EXECUTE FUNCTION "sr_user_collection_stats_maintain_collection"();

-- Backfill all existing Collections once from authoritative rows.
INSERT INTO "sr_user_collection_stats" (
    "collection_id",
    "owner_id",
    "starred_count",
    "subscriber_count",
    "last_modified_at",
    "created_at",
    "updated_at"
)
SELECT collection."id",
       collection."owner_id",
       COALESCE(starred."count", 0),
       COALESCE(subscribers."count", 0),
       GREATEST(
           collection."updated_at",
           COALESCE(starred."last_modified_at", collection."updated_at")
       ),
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "sr_user_collection" AS collection
LEFT JOIN (
    SELECT bookmark."user_id",
           COUNT(*)::integer AS "count",
           MAX(COALESCE(bookmark."starred_at", bookmark."updated_at", bookmark."created_at")) AS "last_modified_at"
    FROM "sr_user_bookmark" AS bookmark
    WHERE bookmark."is_starred" = true
      AND bookmark."deleted_at" IS NULL
    GROUP BY bookmark."user_id"
) AS starred ON starred."user_id" = collection."owner_id"
LEFT JOIN (
    SELECT subscriber."collection_id", COUNT(*)::integer AS "count"
    FROM "sr_user_collection_subscriber" AS subscriber
    GROUP BY subscriber."collection_id"
) AS subscribers ON subscribers."collection_id" = collection."id";

COMMIT;
