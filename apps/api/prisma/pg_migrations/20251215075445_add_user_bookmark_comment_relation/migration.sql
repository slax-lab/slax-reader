-- AlterTable
ALTER TABLE "sr_bookmark_comment" ADD COLUMN     "user_bookmark_uuid" TEXT NOT NULL DEFAULT '';

DELETE FROM sr_bookmark_comment
WHERE id IN (
    SELECT bc.id
    FROM sr_bookmark_comment bc
    LEFT JOIN sr_user_bookmark ub ON bc.bookmark_id = ub.id
    WHERE ub.id IS NULL
);

UPDATE "sr_bookmark_comment" AS bc
SET "user_bookmark_uuid" = ub.uuid
FROM "sr_user_bookmark" AS ub
WHERE bc.bookmark_id = ub.id;

-- CreateIndex
CREATE INDEX "sr_bookmark_comment_user_bookmark_uuid_idx" ON "sr_bookmark_comment"("user_bookmark_uuid");
