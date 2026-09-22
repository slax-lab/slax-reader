-- DropIndex
DROP INDEX "slax_user_tag_user_id_tag_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "slax_user_tag_user_id_tag_name_system_tag_key" ON "slax_user_tag"("user_id", "tag_name", "system_tag");

