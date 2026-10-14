BEGIN;

-- Collection permissions are a sparse, denormalized PowerSync snapshot. The
-- authoritative values remain on each article's sr_bookmark_share row. A
-- missing collection_policy means every permission is enabled.
UPDATE "sr_user_bookmark" AS bookmark
SET "metadata" = jsonb_set(
    COALESCE(bookmark."metadata", '{}'::jsonb),
    '{collection_policy}',
    jsonb_build_object(
        'show_marks', share."is_enable" AND share."show_line" AND share."show_comment",
        'allow_marks', share."is_enable" AND share."allow_line" AND share."allow_comment",
        'show_profile', share."is_enable" AND share."show_userinfo"
    ),
    true
)
FROM "sr_bookmark_share" AS share
WHERE share."bookmark_id" = bookmark."bookmark_id"
  AND share."user_id" = bookmark."user_id";

-- Reuse the existing share trigger so one share change produces one
-- sr_user_bookmark update and one PowerSync-visible metadata change.
CREATE OR REPLACE FUNCTION "trigger_share_update"()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE "sr_user_bookmark"
        SET "metadata" = COALESCE("metadata", '{}'::jsonb) - 'share' - 'collection_policy',
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "bookmark_id" = OLD."bookmark_id"
          AND "user_id" = OLD."user_id";

        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE'
       AND (OLD."bookmark_id", OLD."user_id") IS DISTINCT FROM (NEW."bookmark_id", NEW."user_id") THEN
        UPDATE "sr_user_bookmark"
        SET "metadata" = COALESCE("metadata", '{}'::jsonb) - 'share' - 'collection_policy',
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "bookmark_id" = OLD."bookmark_id"
          AND "user_id" = OLD."user_id";
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
                'show_marks', NEW."is_enable" AND NEW."show_line" AND NEW."show_comment",
                'allow_marks', NEW."is_enable" AND NEW."allow_line" AND NEW."allow_comment",
                'show_profile', NEW."is_enable" AND NEW."show_userinfo"
            ),
            true
        ),
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "bookmark_id" = NEW."bookmark_id"
      AND "user_id" = NEW."user_id";

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sr_user_bookmark_mirror_share_policy" ON "sr_bookmark_share";
DROP FUNCTION IF EXISTS "sr_user_bookmark_mirror_share_policy"();

DROP TRIGGER IF EXISTS "trigger_share_increment" ON "sr_bookmark_share";
CREATE TRIGGER "trigger_share_increment"
AFTER INSERT OR UPDATE OR DELETE ON "sr_bookmark_share"
FOR EACH ROW
EXECUTE FUNCTION "trigger_share_update"();

COMMIT;
