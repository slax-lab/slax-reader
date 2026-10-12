BEGIN;

ALTER TABLE "sr_user_bookmark_stats"
ADD COLUMN "collection_id" INTEGER;

CREATE INDEX "sr_user_bookmark_stats_collection_id_idx"
ON "sr_user_bookmark_stats"("collection_id");

-- The authoritative policy is already stored on each article share row.
-- Rebuild that raw snapshot for existing rows, then remove the derived
-- collection_policy object.
UPDATE "sr_user_bookmark" AS bookmark
SET "metadata" = jsonb_set(
    COALESCE(bookmark."metadata", '{}'::jsonb) - 'collection_policy',
    '{share}',
    jsonb_build_object(
        'uuid', share."uuid",
        'share_code', share."share_code",
        'show_line', share."show_line",
        'show_comment', share."show_comment",
        'show_userinfo', share."show_userinfo",
        'allow_comment', share."allow_comment",
        'allow_line', share."allow_line",
        'is_enable', share."is_enable",
        'created_at', share."created_at"
    ),
    true
)
FROM "sr_bookmark_share" AS share
WHERE share."bookmark_id" = bookmark."bookmark_id"
  AND share."user_id" = bookmark."user_id";

UPDATE "sr_user_bookmark"
SET "metadata" = COALESCE("metadata", '{}'::jsonb) - 'collection_policy'
WHERE "metadata" ? 'collection_policy';

-- Backfill every effective star owned by an enabled Collection. The stats row
-- is created here when the article has no comments yet, so comments never own
-- the Collection association.
INSERT INTO "sr_user_bookmark_stats" AS stats
    ("bookmark_uuid", "comment_count", "first_comment", "collection_id", "owner_id", "created_at")
SELECT bookmark."uuid",
       0,
       NULL,
       collection."id",
       bookmark."user_id",
       CURRENT_TIMESTAMP
FROM "sr_user_bookmark" AS bookmark
INNER JOIN "sr_user_collection" AS collection
  ON collection."owner_id" = bookmark."user_id"
 AND collection."status" = 1
WHERE bookmark."is_starred" = true
  AND bookmark."deleted_at" IS NULL
ON CONFLICT ("bookmark_uuid") DO UPDATE
SET "collection_id" = EXCLUDED."collection_id"
WHERE stats."collection_id" IS NULL;

-- Reuse the existing statement-level insert trigger. Besides aggregating the
-- Collection count once per owner, it records Collection ownership for each
-- newly inserted star without involving comment writes.
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

    INSERT INTO "sr_user_bookmark_stats" AS stats
        ("bookmark_uuid", "comment_count", "first_comment", "collection_id", "owner_id", "created_at")
    SELECT bookmark."uuid",
           0,
           NULL,
           collection."id",
           bookmark."user_id",
           CURRENT_TIMESTAMP
    FROM inserted_bookmarks AS bookmark
    INNER JOIN "sr_user_collection" AS collection
      ON collection."owner_id" = bookmark."user_id"
     AND collection."status" = 1
    WHERE bookmark."is_starred" = true
      AND bookmark."deleted_at" IS NULL
    ON CONFLICT ("bookmark_uuid") DO UPDATE
    SET "collection_id" = EXCLUDED."collection_id"
    WHERE stats."collection_id" IS NULL;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- A star transition creates or fills the stats association. It never clears
-- the association on unstar or Collection close.
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

    IF NOT counted_before AND counted_after THEN
        INSERT INTO "sr_user_bookmark_stats" AS stats
            ("bookmark_uuid", "comment_count", "first_comment", "collection_id", "owner_id", "created_at")
        SELECT NEW."uuid",
               0,
               NULL,
               collection."id",
               NEW."user_id",
               CURRENT_TIMESTAMP
        FROM "sr_user_collection" AS collection
        WHERE collection."owner_id" = NEW."user_id"
          AND collection."status" = 1
        ON CONFLICT ("bookmark_uuid") DO UPDATE
        SET "collection_id" = EXCLUDED."collection_id"
        WHERE stats."collection_id" IS NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Creating or reopening a Collection associates existing owner stats. Closing
-- it intentionally leaves collection_id untouched for later inspection.
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

        IF NEW."status" = 1 THEN
            INSERT INTO "sr_user_bookmark_stats" AS stats
                ("bookmark_uuid", "comment_count", "first_comment", "collection_id", "owner_id", "created_at")
            SELECT bookmark."uuid",
                   0,
                   NULL,
                   NEW."id",
                   bookmark."user_id",
                   CURRENT_TIMESTAMP
            FROM "sr_user_bookmark" AS bookmark
            WHERE bookmark."user_id" = NEW."owner_id"
              AND bookmark."is_starred" = true
              AND bookmark."deleted_at" IS NULL
            ON CONFLICT ("bookmark_uuid") DO UPDATE
            SET "collection_id" = EXCLUDED."collection_id"
            WHERE stats."collection_id" IS NULL;
        END IF;

        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        DELETE FROM "sr_user_collection_stats"
        WHERE "collection_id" = OLD."id";

        RETURN OLD;
    END IF;

    IF OLD."status" IS DISTINCT FROM NEW."status"
       AND NEW."status" = 1 THEN
        INSERT INTO "sr_user_bookmark_stats" AS stats
            ("bookmark_uuid", "comment_count", "first_comment", "collection_id", "owner_id", "created_at")
        SELECT bookmark."uuid",
               0,
               NULL,
               NEW."id",
               bookmark."user_id",
               CURRENT_TIMESTAMP
        FROM "sr_user_bookmark" AS bookmark
        WHERE bookmark."user_id" = NEW."owner_id"
          AND bookmark."is_starred" = true
          AND bookmark."deleted_at" IS NULL
        ON CONFLICT ("bookmark_uuid") DO UPDATE
        SET "collection_id" = EXCLUDED."collection_id"
        WHERE stats."collection_id" IS NULL;
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

-- Keep the raw article share snapshot authoritative. A disabled share remains
-- in metadata so clients can distinguish it from an article with no share;
-- deleting the share row removes the snapshot and restores the default-open
-- behavior for the visibility fields.
CREATE OR REPLACE FUNCTION "trigger_share_update"()
RETURNS TRIGGER AS $$
DECLARE
    old_show_marks BOOLEAN;
    new_show_marks BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE "sr_user_bookmark"
        SET "metadata" = COALESCE("metadata", '{}'::jsonb) - 'share',
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "bookmark_id" = OLD."bookmark_id"
          AND "user_id" = OLD."user_id";

        old_show_marks = OLD."is_enable" AND OLD."show_line" AND OLD."show_comment";
        IF NOT old_show_marks THEN
            PERFORM "sr_user_bookmark_stats_restore"(OLD."bookmark_id", OLD."user_id");
        END IF;

        RETURN OLD;
    END IF;

    new_show_marks = NEW."is_enable" AND NEW."show_line" AND NEW."show_comment";

    IF TG_OP = 'UPDATE' THEN
        old_show_marks = OLD."is_enable" AND OLD."show_line" AND OLD."show_comment";

        IF (OLD."bookmark_id", OLD."user_id") IS DISTINCT FROM (NEW."bookmark_id", NEW."user_id") THEN
            UPDATE "sr_user_bookmark"
            SET "metadata" = COALESCE("metadata", '{}'::jsonb) - 'share',
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "bookmark_id" = OLD."bookmark_id"
              AND "user_id" = OLD."user_id";

            IF NOT old_show_marks THEN
                PERFORM "sr_user_bookmark_stats_restore"(OLD."bookmark_id", OLD."user_id");
            END IF;
        END IF;
    END IF;

    UPDATE "sr_user_bookmark"
    SET "metadata" = jsonb_set(
            COALESCE("metadata", '{}'::jsonb),
            '{share}',
            jsonb_build_object(
                'uuid', NEW."uuid",
                'share_code', NEW."share_code",
                'show_line', NEW."show_line",
                'show_comment', NEW."show_comment",
                'show_userinfo', NEW."show_userinfo",
                'allow_comment', NEW."allow_comment",
                'allow_line', NEW."allow_line",
                'is_enable', NEW."is_enable",
                'created_at', NEW."created_at"
            ),
            true
        ),
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "bookmark_id" = NEW."bookmark_id"
      AND "user_id" = NEW."user_id";

    IF TG_OP = 'INSERT'
       OR (OLD."bookmark_id", OLD."user_id") IS DISTINCT FROM (NEW."bookmark_id", NEW."user_id") THEN
        IF NOT new_show_marks THEN
            UPDATE "sr_user_bookmark_stats" AS stats
            SET "comment_count" = 0,
                "first_comment" = NULL
            FROM "sr_user_bookmark" AS bookmark
            WHERE bookmark."bookmark_id" = NEW."bookmark_id"
              AND bookmark."user_id" = NEW."user_id"
              AND stats."bookmark_uuid" = bookmark."uuid"
              AND stats."owner_id" = bookmark."user_id";
        END IF;
    ELSIF old_show_marks IS DISTINCT FROM new_show_marks THEN
        IF new_show_marks THEN
            PERFORM "sr_user_bookmark_stats_restore"(NEW."bookmark_id", NEW."user_id");
        ELSE
            UPDATE "sr_user_bookmark_stats" AS stats
            SET "comment_count" = 0,
                "first_comment" = NULL
            FROM "sr_user_bookmark" AS bookmark
            WHERE bookmark."bookmark_id" = NEW."bookmark_id"
              AND bookmark."user_id" = NEW."user_id"
              AND stats."bookmark_uuid" = bookmark."uuid"
              AND stats."owner_id" = bookmark."user_id";
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Comment writes only maintain comment-derived stats. Collection association
-- is owned by the star and Collection-status paths above.
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
      AND COALESCE((ub.metadata->'share'->>'is_enable')::boolean, true)
      AND COALESCE((ub.metadata->'share'->>'show_line')::boolean, true)
      AND COALESCE((ub.metadata->'share'->>'show_comment')::boolean, true)
    ON CONFLICT ("bookmark_uuid") DO UPDATE
    SET "comment_count" = stats."comment_count" + 1,
        "first_comment" = COALESCE(stats."first_comment", EXCLUDED."first_comment");

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
