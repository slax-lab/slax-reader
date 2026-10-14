-- AlterTable
ALTER TABLE "sr_user_report" ADD COLUMN     "source" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "version" TEXT NOT NULL DEFAULT '';
