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
        'share', NULL
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_user_bookmark_before_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_starred IS DISTINCT FROM NEW.is_starred THEN
        IF NEW.is_starred = true THEN
            NEW.starred_at = NOW();
        ELSE
            NEW.starred_at = NULL;
        END IF;
    END IF;

    IF OLD.archive_status IS DISTINCT FROM NEW.archive_status THEN
        IF NEW.archive_status = 1 THEN
            NEW.archived_at = NOW();
        ELSE
            NEW.archived_at = NULL;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE sr_user_bookmark
SET metadata = metadata - 'starred_at' - 'archived_at';
