-- AlterTable
ALTER TABLE "public"."sr_user_receive_activity_record" ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE INDEX "sr_user_receive_activity_record_metadata_idx" ON "public"."sr_user_receive_activity_record"("metadata");
