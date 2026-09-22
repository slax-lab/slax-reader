-- YouTube was live for everyone before Labs existed. Users who already saved a
-- YouTube link keep it on; everyone else starts with the switch off.
-- site_name = 'YouTube' is only written after a successful crawl, so the URL
-- pattern also catches users whose YouTube saves failed to parse.
INSERT INTO "sr_user_lab_feature" ("user_id", "feature", "enabled", "created_at", "updated_at")
SELECT DISTINCT ub."user_id", 'youtube', true, now(), now()
FROM "sr_user_bookmark" ub
JOIN "sr_bookmark" b ON b."id" = ub."bookmark_id"
WHERE ub."deleted_at" IS NULL
  AND (b."site_name" = 'YouTube'
       OR b."target_url" ~ 'youtu\.be/|youtube\.com/(watch|shorts|live|embed)')
ON CONFLICT ("user_id", "feature") DO NOTHING;
