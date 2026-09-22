-- DropIndex
DROP INDEX "sr_user_bookmark_user_id_deleted_at_archive_status_created__idx";

-- DropIndex
DROP INDEX "sr_user_bookmark_user_id_deleted_at_is_starred_created_at_idx";

-- AlterTable
ALTER TABLE "sr_user_bookmark" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "starred_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sr_user_bookmark_user_id_deleted_at_archive_status_archived_idx" ON "sr_user_bookmark"("user_id", "deleted_at", "archive_status", "archived_at" DESC);

-- CreateIndex
CREATE INDEX "sr_user_bookmark_user_id_deleted_at_is_starred_starred_at_idx" ON "sr_user_bookmark"("user_id", "deleted_at", "is_starred", "starred_at" DESC);

-- BackfillData
UPDATE "sr_user_bookmark" SET "starred_at" = "updated_at" WHERE "is_starred" = true;
UPDATE "sr_user_bookmark" SET "archived_at" = "updated_at" WHERE "archive_status" = 1;

CREATE OR REPLACE FUNCTION trigger_user_bookmark_insert()
RETURNS TRIGGER AS $$
BEGIN
    NEW.metadata = jsonb_build_object(
        'bookmark', (
            SELECT jsonb_build_object(
                'uuid', uuid,
                'title', title,
                'host_url', host_url,
                'target_url', target_url,
                'site_name', site_name,
                'content_icon', content_icon,
                'content_cover', content_cover,
                'content_word_count', content_word_count,
                'description', description,
                'byline', byline,
                'status', status,
                'published_at', published_at
            )
            FROM sr_bookmark
            WHERE id = NEW.bookmark_id
        ),
        'tags', '[]'::jsonb,
        'share', NULL,
        'starred_at', NEW.starred_at,
        'archived_at', NEW.archived_at
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CreateFunction: BEFORE UPDATE 触发器 - is_starred/archive_status 变化时自动更新时间并同步 metadata
CREATE OR REPLACE FUNCTION trigger_user_bookmark_before_update()
RETURNS TRIGGER AS $$
BEGIN
    -- is_starred 变化时更新 starred_at
    IF OLD.is_starred IS DISTINCT FROM NEW.is_starred THEN
        IF NEW.is_starred = true THEN
            NEW.starred_at = NOW();
        ELSE
            NEW.starred_at = NULL;
        END IF;
    END IF;

    -- archive_status 变化时更新 archived_at
    IF OLD.archive_status IS DISTINCT FROM NEW.archive_status THEN
        IF NEW.archive_status = 1 THEN
            NEW.archived_at = NOW();
        ELSE
            NEW.archived_at = NULL;
        END IF;
    END IF;

    -- 同步到 metadata
    NEW.metadata = jsonb_set(
        jsonb_set(
            COALESCE(NEW.metadata, '{}'::jsonb),
            '{starred_at}',
            COALESCE(to_jsonb(NEW.starred_at), 'null'::jsonb)
        ),
        '{archived_at}',
        COALESCE(to_jsonb(NEW.archived_at), 'null'::jsonb)
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_bookmark_before_update ON sr_user_bookmark;
CREATE TRIGGER trigger_user_bookmark_before_update
    BEFORE UPDATE ON sr_user_bookmark
    FOR EACH ROW
    EXECUTE FUNCTION trigger_user_bookmark_before_update();
