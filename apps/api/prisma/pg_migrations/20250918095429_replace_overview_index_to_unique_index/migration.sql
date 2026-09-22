/*
  Warnings:

  - A unique constraint covering the columns `[bookmark_id,user_id]` on the table `sr_user_bookmark_overview` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex

DELETE FROM sr_user_bookmark_overview a
WHERE EXISTS (
    SELECT 1 FROM sr_user_bookmark_overview b 
    WHERE a.bookmark_id = b.bookmark_id 
    AND a.ctid > b.ctid
);

DROP INDEX "public"."sr_user_bookmark_overview_bookmark_id_user_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_bookmark_overview_bookmark_id_user_id_key" ON "public"."sr_user_bookmark_overview"("bookmark_id", "user_id");
