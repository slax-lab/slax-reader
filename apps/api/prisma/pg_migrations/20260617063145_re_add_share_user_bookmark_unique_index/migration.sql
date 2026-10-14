/*
  Warnings:

  - A unique constraint covering the columns `[bookmark_id,user_id]` on the table `sr_bookmark_share` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_share_bookmark_id_user_id_key" ON "sr_bookmark_share"("bookmark_id", "user_id");
