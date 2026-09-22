BEGIN;

-- AlterTable
ALTER TABLE "sr_user_collection" ADD COLUMN     "avatar" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "sr_user_collection_subscriber" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "last_read_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sr_user_bookmark_stats" (
    "id" SERIAL NOT NULL,
    "bookmark_uuid" TEXT NOT NULL,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "first_comment" JSONB,
    "owner_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_user_bookmark_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_bookmark_stats_bookmark_uuid_key" ON "sr_user_bookmark_stats"("bookmark_uuid");

-- CreateIndex
CREATE INDEX "sr_user_bookmark_stats_owner_id_idx" ON "sr_user_bookmark_stats"("owner_id");

-- Every non-reply owner or visitor mark increments the count.
-- Only an owner comment (type 2/5) can initialize first_comment.
CREATE OR REPLACE FUNCTION "sr_user_bookmark_stats_insert_comment"()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO "sr_user_bookmark_stats" AS stats
        ("bookmark_uuid", "comment_count", "first_comment", "owner_id", "created_at")
    SELECT ub.uuid,
           1,
           CASE
               WHEN ub.user_id = NEW.user_id
                AND NEW.type IN (2, 5) THEN jsonb_build_object(
                   'uuid', NEW.uuid,
                   'type', NEW.type,
                   'source', NEW.source,
                   'content', NEW.content,
                   'comment', NEW.comment
               )
               ELSE NULL
           END,
           ub.user_id,
           CURRENT_TIMESTAMP
    FROM "sr_user_bookmark" AS ub
    WHERE ub.id = NEW.bookmark_id
    ON CONFLICT ("bookmark_uuid") DO UPDATE
    SET "comment_count" = stats."comment_count" + 1,
        "first_comment" = COALESCE(stats."first_comment", EXCLUDED."first_comment");

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sr_user_bookmark_stats_insert_comment" ON "sr_bookmark_comment";
CREATE TRIGGER "sr_user_bookmark_stats_insert_comment"
AFTER INSERT ON "sr_bookmark_comment"
FOR EACH ROW
WHEN (NEW.is_deleted = false AND NEW.type IN (1, 2, 4, 5))
EXECUTE FUNCTION "sr_user_bookmark_stats_insert_comment"();

-- Every non-reply owner or visitor mark decrements the count when deleted.
-- Only deleting first_comment queries the next visible owner comment.
CREATE OR REPLACE FUNCTION "sr_user_bookmark_stats_delete_comment"()
RETURNS TRIGGER AS $$
DECLARE
    bookmark_owner_id INTEGER;
BEGIN
    UPDATE "sr_user_bookmark_stats"
    SET "comment_count" = GREATEST("comment_count" - 1, 0)
    WHERE "bookmark_uuid" = OLD.user_bookmark_uuid
    RETURNING "owner_id" INTO bookmark_owner_id;

    -- Visitor marks and owner highlights (type 1/4) only affect the count.
    IF bookmark_owner_id IS DISTINCT FROM OLD.user_id
       OR OLD.type NOT IN (2, 5) THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    UPDATE "sr_user_bookmark_stats" AS stats
    SET "first_comment" = (
        SELECT jsonb_build_object(
            'uuid', c.uuid,
            'type', c.type,
            'source', c.source,
            'content', c.content,
            'comment', c.comment
        )
        FROM "sr_bookmark_comment" AS c
        WHERE c.bookmark_id = OLD.bookmark_id
          AND c.user_id = stats."owner_id"
          AND c.is_deleted = false
          AND c.type IN (2, 5)
          AND c.id <> OLD.id
        ORDER BY c.created_at ASC, c.id ASC
        LIMIT 1
    )
    WHERE stats."bookmark_uuid" = OLD.user_bookmark_uuid
      AND stats."first_comment" ->> 'uuid' = OLD.uuid;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sr_user_bookmark_stats_soft_delete_comment" ON "sr_bookmark_comment";
CREATE TRIGGER "sr_user_bookmark_stats_soft_delete_comment"
AFTER UPDATE OF "is_deleted" ON "sr_bookmark_comment"
FOR EACH ROW
WHEN (
    OLD.is_deleted = false
    AND NEW.is_deleted = true
    AND OLD.type IN (1, 2, 4, 5)
)
EXECUTE FUNCTION "sr_user_bookmark_stats_delete_comment"();

DROP TRIGGER IF EXISTS "sr_user_bookmark_stats_hard_delete_comment" ON "sr_bookmark_comment";
CREATE TRIGGER "sr_user_bookmark_stats_hard_delete_comment"
AFTER DELETE ON "sr_bookmark_comment"
FOR EACH ROW
WHEN (OLD.is_deleted = false AND OLD.type IN (1, 2, 4, 5))
EXECUTE FUNCTION "sr_user_bookmark_stats_delete_comment"();

-- Remove stats only when the bookmark row is permanently deleted.
CREATE OR REPLACE FUNCTION "sr_user_bookmark_stats_delete_with_bookmark"()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM "sr_user_bookmark_stats"
    WHERE "bookmark_uuid" = OLD.uuid;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sr_user_bookmark_stats_delete_with_bookmark" ON "sr_user_bookmark";
CREATE TRIGGER "sr_user_bookmark_stats_delete_with_bookmark"
AFTER DELETE ON "sr_user_bookmark"
FOR EACH ROW
EXECUTE FUNCTION "sr_user_bookmark_stats_delete_with_bookmark"();

-- Backfill all non-reply counts and the first visible owner comment independently.
WITH mark_counts AS (
    SELECT ub.uuid AS bookmark_uuid,
           ub.user_id AS owner_id,
           COUNT(*)::integer AS comment_count
    FROM "sr_user_bookmark" AS ub
    INNER JOIN "sr_bookmark_comment" AS c
        ON c.bookmark_id = ub.id
       AND c.is_deleted = false
       AND c.type IN (1, 2, 4, 5)
    GROUP BY ub.uuid, ub.user_id
),
owner_first_marks AS (
    SELECT DISTINCT ON (ub.uuid)
           ub.uuid AS bookmark_uuid,
           jsonb_build_object(
               'uuid', c.uuid,
               'type', c.type,
               'source', c.source,
               'content', c.content,
               'comment', c.comment
           ) AS first_comment
    FROM "sr_user_bookmark" AS ub
    INNER JOIN "sr_bookmark_comment" AS c
       ON c.bookmark_id = ub.id
       AND c.user_id = ub.user_id
       AND c.is_deleted = false
       AND c.type IN (2, 5)
    ORDER BY ub.uuid, c.created_at ASC, c.id ASC
)
INSERT INTO "sr_user_bookmark_stats" AS stats
    ("bookmark_uuid", "comment_count", "first_comment", "owner_id", "created_at")
SELECT counts.bookmark_uuid,
       counts.comment_count,
       first_marks.first_comment,
       counts.owner_id,
       CURRENT_TIMESTAMP
FROM mark_counts AS counts
LEFT JOIN owner_first_marks AS first_marks
    ON first_marks.bookmark_uuid = counts.bookmark_uuid
ON CONFLICT ("bookmark_uuid") DO UPDATE
SET "comment_count" = EXCLUDED."comment_count",
    "first_comment" = EXCLUDED."first_comment",
    "owner_id" = EXCLUDED."owner_id";

-- CreateIndex
CREATE INDEX "sr_user_collection_subscriber_is_active_subscription_end_ti_idx" ON "sr_user_collection_subscriber"("is_active", "subscription_end_time");

COMMIT;
