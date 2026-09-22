-- DropIndex
DROP INDEX "slax_user_collection_subscriber_user_id_collection_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "slax_user_collection_subscriber_user_id_collection_id_key" ON "slax_user_collection_subscriber"("user_id", "collection_id");

