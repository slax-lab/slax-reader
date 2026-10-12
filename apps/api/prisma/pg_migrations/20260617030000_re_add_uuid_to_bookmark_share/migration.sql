-- AlterTable
ALTER TABLE "sr_bookmark_share" ADD COLUMN IF NOT EXISTS "uuid" TEXT NOT NULL DEFAULT gen_random_uuid();

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "sr_bookmark_share_uuid_key" ON "sr_bookmark_share"("uuid");
