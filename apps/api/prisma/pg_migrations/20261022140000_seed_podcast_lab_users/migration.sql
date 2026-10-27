-- Users who already save podcast links get the podcast Labs feature on, like the
-- youtube seed for users who had saved YouTube links before Labs existed. Only adds:
-- an existing false row (the user turned the switch off) is preserved by ON CONFLICT.
INSERT INTO "sr_user_lab_feature" ("user_id", "feature", "enabled", "created_at", "updated_at")
SELECT DISTINCT ub."user_id", 'podcast', true, now(), now()
FROM "sr_user_bookmark" ub
JOIN "sr_bookmark" b ON b."id" = ub."bookmark_id"
WHERE ub."deleted_at" IS NULL
  AND (b."target_url" ~* 'xiaoyuzhoufm\.com/episode/[A-Za-z0-9]+'
       OR b."target_url" ~* 'podcasts\.apple\.com/[^?#]*/id[0-9]+[^#]*[?&]i=[0-9]+'
       OR b."target_url" ~* 'open\.spotify\.com/(intl-[a-z-]+/)?episode/[A-Za-z0-9]+'
       OR b."target_url" ~* '/[^?#]*\.(mp3|m4a|aac|ogg|oga|opus|wav)([?#]|$)')
ON CONFLICT ("user_id", "feature") DO NOTHING;
