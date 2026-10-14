BEGIN;

-- Hidden stats are derived data. Remove them once so PowerSync emits REMOVE;
-- the share trigger below applies the same rule to future policy changes.
DELETE FROM "sr_user_bookmark_stats" AS stats
USING "sr_user_bookmark" AS bookmark, "sr_bookmark_share" AS share
WHERE stats."bookmark_uuid" = bookmark."uuid"
  AND stats."owner_id" = bookmark."user_id"
  AND share."bookmark_id" = bookmark."bookmark_id"
  AND share."user_id" = bookmark."user_id"
  AND NOT (share."is_enable" AND share."show_line" AND share."show_comment");

-- Reopening visibility restores the derived row from its source comments.
-- This is only called for a false -> true transition, which is rare.
CREATE OR REPLACE FUNCTION "sr_user_bookmark_stats_restore"(
    target_bookmark_id INTEGER,
    target_user_id INTEGER
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO "sr_user_bookmark_stats" AS stats
        ("bookmark_uuid", "comment_count", "first_comment", "owner_id", "created_at")
    SELECT bookmark."uuid",
           counts."comment_count",
           first_mark."first_comment",
           bookmark."user_id",
           CURRENT_TIMESTAMP
    FROM "sr_user_bookmark" AS bookmark
    CROSS JOIN LATERAL (
        SELECT COUNT(*)::integer AS "comment_count"
        FROM "sr_bookmark_comment" AS comment
        WHERE comment."bookmark_id" = bookmark."id"
          AND comment."is_deleted" = false
          AND comment."type" IN (1, 2, 4, 5)
    ) AS counts
    LEFT JOIN LATERAL (
        SELECT jsonb_build_object(
            'uuid', comment."uuid",
            'type', comment."type",
            'source', comment."source",
            'content', comment."content",
            'comment', comment."comment"
        ) AS "first_comment"
        FROM "sr_bookmark_comment" AS comment
        WHERE comment."bookmark_id" = bookmark."id"
          AND comment."user_id" = bookmark."user_id"
          AND comment."is_deleted" = false
          AND comment."type" IN (2, 5)
        ORDER BY comment."created_at" ASC, comment."id" ASC
        LIMIT 1
    ) AS first_mark ON true
    WHERE bookmark."bookmark_id" = target_bookmark_id
      AND bookmark."user_id" = target_user_id
      AND counts."comment_count" > 0
    ON CONFLICT ("bookmark_uuid") DO UPDATE
    SET "comment_count" = EXCLUDED."comment_count",
        "first_comment" = EXCLUDED."first_comment",
        "owner_id" = EXCLUDED."owner_id";
END;
$$ LANGUAGE plpgsql;

-- Reuse the existing share trigger. Stats are written only when visibility
-- changes; allow-action and profile-only updates do not touch the stats row.
CREATE OR REPLACE FUNCTION "trigger_share_update"()
RETURNS TRIGGER AS $$
DECLARE
    old_show_marks BOOLEAN;
    new_show_marks BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE "sr_user_bookmark"
        SET "metadata" = COALESCE("metadata", '{}'::jsonb) - 'share' - 'collection_policy',
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
            SET "metadata" = COALESCE("metadata", '{}'::jsonb) - 'share' - 'collection_policy',
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
            CASE
                WHEN NEW."is_enable" THEN jsonb_set(
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
                )
                ELSE COALESCE("metadata", '{}'::jsonb) - 'share'
            END,
            '{collection_policy}',
            jsonb_build_object(
                'show_marks', new_show_marks,
                'allow_marks', NEW."is_enable" AND NEW."allow_line" AND NEW."allow_comment",
                'show_profile', NEW."is_enable" AND NEW."show_userinfo"
            ),
            true
        ),
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "bookmark_id" = NEW."bookmark_id"
      AND "user_id" = NEW."user_id";

    IF TG_OP = 'INSERT'
       OR (OLD."bookmark_id", OLD."user_id") IS DISTINCT FROM (NEW."bookmark_id", NEW."user_id") THEN
        IF NOT new_show_marks THEN
            DELETE FROM "sr_user_bookmark_stats" AS stats
            USING "sr_user_bookmark" AS bookmark
            WHERE bookmark."bookmark_id" = NEW."bookmark_id"
              AND bookmark."user_id" = NEW."user_id"
              AND stats."bookmark_uuid" = bookmark."uuid"
              AND stats."owner_id" = bookmark."user_id";
        END IF;
    ELSIF old_show_marks IS DISTINCT FROM new_show_marks THEN
        IF new_show_marks THEN
            PERFORM "sr_user_bookmark_stats_restore"(NEW."bookmark_id", NEW."user_id");
        ELSE
            DELETE FROM "sr_user_bookmark_stats" AS stats
            USING "sr_user_bookmark" AS bookmark
            WHERE bookmark."bookmark_id" = NEW."bookmark_id"
              AND bookmark."user_id" = NEW."user_id"
              AND stats."bookmark_uuid" = bookmark."uuid"
              AND stats."owner_id" = bookmark."user_id";
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Do not recreate hidden stats when a new owner mark is added while sharing
-- is disabled. Missing policy remains the default-open behavior.
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
      AND COALESCE((ub.metadata->'collection_policy'->>'show_marks')::boolean, true)
    ON CONFLICT ("bookmark_uuid") DO UPDATE
    SET "comment_count" = stats."comment_count" + 1,
        "first_comment" = COALESCE(stats."first_comment", EXCLUDED."first_comment");

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
