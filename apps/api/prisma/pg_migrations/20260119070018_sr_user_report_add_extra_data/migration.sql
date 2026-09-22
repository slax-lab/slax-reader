/*
  Warnings:

  - You are about to drop the column `source` on the `sr_user_report` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `sr_user_report` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "sr_user_report" DROP COLUMN "source",
DROP COLUMN "version",
ADD COLUMN     "extra_data" JSONB NOT NULL DEFAULT '{}';
