BEGIN;

-- Raw bookmark updates used to fan out for unrelated fields such as
-- moderation_result. Preserve the existing trigger and metadata shape, but
-- skip the cross-table write when none of the mirrored fields changed.
CREATE OR REPLACE FUNCTION "trigger_bookmark_update"()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF ROW(
            OLD."uuid",
            OLD."title",
            OLD."host_url",
            OLD."target_url",
            OLD."site_name",
            OLD."content_icon",
            OLD."content_cover",
            OLD."content_word_count",
            OLD."description",
            OLD."byline",
            OLD."status",
            OLD."published_at"
        ) IS NOT DISTINCT FROM ROW(
            NEW."uuid",
            NEW."title",
            NEW."host_url",
            NEW."target_url",
            NEW."site_name",
            NEW."content_icon",
            NEW."content_cover",
            NEW."content_word_count",
            NEW."description",
            NEW."byline",
            NEW."status",
            NEW."published_at"
        ) THEN
            RETURN NEW;
        END IF;

        UPDATE "sr_user_bookmark"
        SET "metadata" = jsonb_set(
            COALESCE("metadata", '{}'::jsonb),
            '{bookmark}',
            jsonb_build_object(
                'uuid', NEW."uuid",
                'title', NEW."title",
                'host_url', NEW."host_url",
                'target_url', NEW."target_url",
                'site_name', NEW."site_name",
                'content_icon', NEW."content_icon",
                'content_cover', NEW."content_cover",
                'content_word_count', NEW."content_word_count",
                'description', NEW."description",
                'byline', NEW."byline",
                'status', NEW."status",
                'published_at', NEW."published_at"
            )
        )
        WHERE "bookmark_id" = NEW."id";

        RETURN NEW;
    END IF;

    UPDATE "sr_user_bookmark"
    SET "metadata" = jsonb_set(
        COALESCE("metadata", '{}'::jsonb),
        '{bookmark}',
        jsonb_build_object(
            'deleted', true,
            'deleted_at', CURRENT_TIMESTAMP,
            'uuid', OLD."uuid",
            'title', OLD."title"
        )
    )
    WHERE "bookmark_id" = OLD."id";

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- sr_bookmark_comment.bookmark_id points to sr_user_bookmark.id. Resolve the
-- raw bookmark UUID through that row and preserve source_type for strict APP
-- metadata decoding and PowerSync uploads.
CREATE OR REPLACE FUNCTION "trigger_comment_metadata_on_insert"()
RETURNS TRIGGER AS $$
DECLARE
    raw_bookmark_uuid TEXT;
BEGIN
    SELECT bookmark."uuid"
    INTO raw_bookmark_uuid
    FROM "sr_user_bookmark" AS user_bookmark
    INNER JOIN "sr_bookmark" AS bookmark
      ON bookmark."id" = user_bookmark."bookmark_id"
    WHERE user_bookmark."id" = NEW."bookmark_id";

    NEW."metadata" = jsonb_build_object(
        'user_id', (SELECT "uuid" FROM "sr_user" WHERE "id" = NEW."user_id"),
        'bookmark_id', raw_bookmark_uuid,
        'source_type', NEW."source_type",
        'source_id', CASE
            WHEN NEW."source_type" = 'share' THEN NEW."source_id"
            WHEN NEW."source_type" = 'bookmark' THEN raw_bookmark_uuid
            ELSE NEW."source_id"
        END,
        'root_id', CASE
            WHEN NEW."root_id" > 0
            THEN (SELECT "uuid" FROM "sr_bookmark_comment" WHERE "id" = NEW."root_id")
            ELSE NULL
        END,
        'parent_id', CASE
            WHEN NEW."parent_id" > 0
            THEN (SELECT "uuid" FROM "sr_bookmark_comment" WHERE "id" = NEW."parent_id")
            ELSE NULL
        END
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
