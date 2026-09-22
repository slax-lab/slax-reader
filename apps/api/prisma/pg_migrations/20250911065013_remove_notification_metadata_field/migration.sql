/*
  Warnings:

  - You are about to drop the column `metadata` on the `sr_user_notification` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."sr_user_notification" DROP COLUMN "metadata";
