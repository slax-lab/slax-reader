BEGIN;

INSERT INTO "sr_user_collection"
  ("owner_id", "display_name", "avatar", "description", "collection_code",
   "show_marks", "allow_marks", "show_profile", "status", "created_at", "updated_at", "type")
SELECT
  u.id,
  CASE
    WHEN u.lang ILIKE 'zh%' THEN
      CASE WHEN NULLIF(BTRIM(u.name), '') IS NOT NULL THEN BTRIM(u.name) || ' 的阅读推荐' ELSE '我的阅读推荐' END
    ELSE
      CASE WHEN NULLIF(BTRIM(u.name), '') IS NOT NULL THEN BTRIM(u.name) || '''s Reading Recommendations' ELSE 'My Reading Recommendations' END
  END,
  '',
  '',
  md5(gen_random_uuid()::text),
  true,
  true,
  true,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  1
FROM "sr_user" AS u
WHERE u.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "sr_user_collection" AS existing WHERE existing.owner_id = u.id
  )
ON CONFLICT ("owner_id") DO NOTHING;

COMMIT;
