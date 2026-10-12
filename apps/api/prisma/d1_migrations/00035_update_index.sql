-- DropIndex
DROP INDEX "slax_user_bookmark_user_id_is_starred_updated_at_idx";

-- DropIndex
DROP INDEX "slax_user_bookmark_user_id_archive_status_updated_at_idx";

-- DropIndex
DROP INDEX "slax_user_bookmark_user_id_deleted_at_updated_at_idx";

-- CreateIndex
CREATE INDEX "slax_user_bookmark_user_id_deleted_at_archive_status_updated_at_idx" ON "slax_user_bookmark"("user_id", "deleted_at", "archive_status", "updated_at");

-- CreateIndex
CREATE INDEX "slax_user_bookmark_user_id_deleted_at_is_starred_updated_at_idx" ON "slax_user_bookmark"("user_id", "deleted_at", "is_starred", "updated_at");

-- CreateIndex
CREATE INDEX "slax_user_bookmark_tag_bookmark_id_user_id_is_deleted_idx" ON "slax_user_bookmark_tag"("bookmark_id", "user_id", "is_deleted");