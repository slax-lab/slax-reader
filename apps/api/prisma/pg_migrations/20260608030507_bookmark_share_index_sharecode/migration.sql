/*
  Warnings:

  - You are about to drop the column `uuid` on the `sr_bookmark_share` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "sr_bookmark_share_share_code_key";

-- DropIndex
DROP INDEX "sr_bookmark_share_uuid_key";

-- AlterTable
ALTER TABLE "sr_bookmark_share" DROP COLUMN "uuid";

-- CreateIndex
CREATE INDEX "sr_bookmark_share_share_code_idx" ON "sr_bookmark_share"("share_code");
