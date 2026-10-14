-- =====================================================
-- 1. sr_user_bookmark_tag 触发器 - 维护 tags 数组
-- =====================================================
CREATE OR REPLACE FUNCTION trigger_tag_uuid_update()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.is_deleted = false THEN
        UPDATE sr_user_bookmark
        SET metadata = jsonb_set(
            COALESCE(metadata, '{"tags": []}'::jsonb),
            '{tags}',
            COALESCE(metadata->'tags', '[]'::jsonb) || to_jsonb((SELECT uuid FROM sr_user_tag WHERE id = NEW.tag_id))
        )
        WHERE user_id = NEW.user_id AND bookmark_id = NEW.bookmark_id;
        
    ELSIF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.is_deleted = true) THEN
        UPDATE sr_user_bookmark
        SET metadata = jsonb_set(
            COALESCE(metadata, '{"tags": []}'::jsonb),
            '{tags}',
            COALESCE(
                (SELECT jsonb_agg(elem)
                 FROM jsonb_array_elements(metadata->'tags') elem
                 WHERE elem != to_jsonb((SELECT uuid FROM sr_user_tag WHERE id = COALESCE(NEW.tag_id, OLD.tag_id)))),
                '[]'::jsonb
            )
        )
        WHERE user_id = COALESCE(NEW.user_id, OLD.user_id) 
            AND bookmark_id = COALESCE(NEW.bookmark_id, OLD.bookmark_id);
        
    ELSIF TG_OP = 'UPDATE' AND OLD.is_deleted = true AND NEW.is_deleted = false THEN
        UPDATE sr_user_bookmark
        SET metadata = jsonb_set(
            COALESCE(metadata, '{"tags": []}'::jsonb),
            '{tags}',
            CASE 
                WHEN metadata->'tags' @> to_jsonb(ARRAY[(SELECT uuid FROM sr_user_tag WHERE id = NEW.tag_id)])::jsonb 
                THEN metadata->'tags'
                ELSE COALESCE(metadata->'tags', '[]'::jsonb) || to_jsonb((SELECT uuid FROM sr_user_tag WHERE id = NEW.tag_id))
            END
        )
        WHERE user_id = NEW.user_id AND bookmark_id = NEW.bookmark_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_tag_uuid_increment ON sr_user_bookmark_tag;
CREATE TRIGGER trigger_tag_uuid_increment
    AFTER INSERT OR UPDATE OR DELETE ON sr_user_bookmark_tag
    FOR EACH ROW
    EXECUTE FUNCTION trigger_tag_uuid_update();

-- =====================================================
-- 2. sr_bookmark_share 触发器 - 维护 share 对象
-- =====================================================
CREATE OR REPLACE FUNCTION trigger_share_update()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.is_enable = true) THEN
        UPDATE sr_user_bookmark
        SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{share}',
            jsonb_build_object(
                'uuid', NEW.uuid,
                'share_code', NEW.share_code,
                'show_line', NEW.show_line,
                'show_comment', NEW.show_comment,
                'show_userinfo', NEW.show_userinfo,
                'allow_comment', NEW.allow_comment,
                'allow_line', NEW.allow_line,
                'is_enable', NEW.is_enable,
                'created_at', NEW.created_at
            )
        )
        WHERE user_id = NEW.user_id AND bookmark_id = NEW.bookmark_id;
        
    ELSIF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.is_enable = false) THEN
        UPDATE sr_user_bookmark
        SET metadata = COALESCE(metadata, '{}'::jsonb) - 'share',
            updated_at = now()
        WHERE user_id = COALESCE(NEW.user_id, OLD.user_id) 
            AND bookmark_id = COALESCE(NEW.bookmark_id, OLD.bookmark_id);
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_share_increment ON sr_bookmark_share;
CREATE TRIGGER trigger_share_increment
    AFTER INSERT OR UPDATE OR DELETE ON sr_bookmark_share
    FOR EACH ROW
    EXECUTE FUNCTION trigger_share_update();

-- =====================================================
-- 3. sr_user_bookmark 触发器 - 创建时填充 bookmark 信息
-- =====================================================
CREATE OR REPLACE FUNCTION trigger_user_bookmark_insert()
RETURNS TRIGGER AS $$
BEGIN
    -- sr_user_bookmark表属于关联表，创建顺序上在sr_bookmark之后
    -- 故需要在创建时初始化 metadata 并填充 bookmark 信息，否则同步不到sr_bookmark表的记录
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

DROP TRIGGER IF EXISTS trigger_user_bookmark_on_insert ON sr_user_bookmark;
CREATE TRIGGER trigger_user_bookmark_on_insert
    BEFORE INSERT ON sr_user_bookmark
    FOR EACH ROW
    EXECUTE FUNCTION trigger_user_bookmark_insert();

-- =====================================================
-- 4. sr_bookmark 触发器 - 更新时同步到所有关联的 sr_user_bookmark
-- =====================================================
CREATE OR REPLACE FUNCTION trigger_bookmark_update()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        UPDATE sr_user_bookmark
        SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{bookmark}',
            jsonb_build_object(
                'uuid', NEW.uuid,
                'title', NEW.title,
                'host_url', NEW.host_url,
                'target_url', NEW.target_url,
                'site_name', NEW.site_name,
                'content_icon', NEW.content_icon,
                'content_cover', NEW.content_cover,
                'content_word_count', NEW.content_word_count,
                'description', NEW.description,
                'byline', NEW.byline,
                'status', NEW.status,
                'published_at', NEW.published_at
            )
        )
        WHERE bookmark_id = NEW.id;
        
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE sr_user_bookmark
        SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{bookmark}',
            jsonb_build_object(
                'deleted', true,
                'deleted_at', now(),
                'uuid', OLD.uuid,
                'title', OLD.title
            )
        )
        WHERE bookmark_id = OLD.id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_bookmark_sync ON sr_bookmark;
CREATE TRIGGER trigger_bookmark_sync
    AFTER UPDATE OR DELETE ON sr_bookmark
    FOR EACH ROW
    EXECUTE FUNCTION trigger_bookmark_update();

-- =====================================================
-- 5. sr_bookmark_comment 触发器 - 创建时填充 metadata
-- =====================================================
CREATE OR REPLACE FUNCTION trigger_comment_metadata_on_insert()
RETURNS TRIGGER AS $$
BEGIN
    NEW.metadata = jsonb_build_object(
        'user_id', (SELECT uuid FROM sr_user WHERE id = NEW.user_id),
        'bookmark_id', (SELECT uuid FROM sr_bookmark WHERE id = NEW.bookmark_id),
        'source_id', CASE 
            WHEN NEW.source_type = 'share' THEN NEW.source_id
            WHEN NEW.source_type = 'bookmark' THEN (SELECT uuid FROM sr_bookmark WHERE id = NEW.bookmark_id)
            ELSE NEW.source_id
        END,
        'root_id', CASE 
            WHEN NEW.root_id > 0 
            THEN (SELECT uuid FROM sr_bookmark_comment WHERE id = NEW.root_id)
            ELSE NULL 
        END,
        'parent_id', CASE 
            WHEN NEW.parent_id > 0 
            THEN (SELECT uuid FROM sr_bookmark_comment WHERE id = NEW.parent_id)
            ELSE NULL 
        END
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_comment_metadata_insert ON sr_bookmark_comment;
CREATE TRIGGER trigger_comment_metadata_insert
    BEFORE INSERT ON sr_bookmark_comment
    FOR EACH ROW
    EXECUTE FUNCTION trigger_comment_metadata_on_insert();

-- =====================================================
-- 6. sr_user_delete_bookmark 触发器 - 软删除时填充 metadata
-- =====================================================
CREATE OR REPLACE FUNCTION trigger_user_delete_bookmark_metadata_on_insert()
RETURNS TRIGGER AS $$
BEGIN
    NEW.metadata = jsonb_build_object(
        'bookmark', (SELECT uuid FROM sr_bookmark WHERE id = NEW.bookmark_id)
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_delete_bookmark_metadata_insert ON sr_user_delete_bookmark;
CREATE TRIGGER trigger_user_delete_bookmark_metadata_insert
    BEFORE INSERT ON sr_user_delete_bookmark
    FOR EACH ROW
    EXECUTE FUNCTION trigger_user_delete_bookmark_metadata_on_insert();