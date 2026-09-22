-- Backfill empty collection avatars from their owners.
UPDATE "sr_user_collection" AS uc
SET "avatar" = u."picture"
FROM "sr_user" AS u
WHERE uc."owner_id" = u."id"
  AND uc."avatar" = ''
  AND u."picture" <> '';
