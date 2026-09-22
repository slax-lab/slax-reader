-- DropIndex
DROP INDEX "slax_user_collection_subscriber_collection_id_user_id_idx";

-- CreateIndex
CREATE INDEX "slax_user_collection_subscriber_user_id_collection_id_idx" ON "slax_user_collection_subscriber"("user_id", "collection_id");

-- CreateIndex
CREATE INDEX "slax_user_collection_subscriber_period_user_id_collection_id_idx" ON "slax_user_collection_subscriber_period"("user_id", "collection_id");

-- CreateIndex
CREATE INDEX "slax_user_collection_subscriber_period_source_idx" ON "slax_user_collection_subscriber_period"("source");

