-- DropIndex
DROP INDEX "public"."sr_user_bookmark_user_id_deleted_at_archive_status_updated__idx";

-- DropIndex
DROP INDEX "public"."sr_user_bookmark_user_id_deleted_at_is_starred_updated_at_idx";

-- CreateIndex
CREATE INDEX "sr_user_bookmark_user_id_deleted_at_archive_status_created__idx" ON "sr_user_bookmark"("user_id", "deleted_at", "archive_status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sr_user_bookmark_user_id_deleted_at_is_starred_created_at_idx" ON "sr_user_bookmark"("user_id", "deleted_at", "is_starred", "created_at" DESC);
