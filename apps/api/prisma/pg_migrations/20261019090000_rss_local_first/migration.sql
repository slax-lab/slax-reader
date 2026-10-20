-- AlterTable
ALTER TABLE "sr_rss_feed" ADD COLUMN     "icon_url" TEXT;

-- AlterTable
ALTER TABLE "sr_rss_entry" ADD COLUMN     "is_history" BOOLEAN NOT NULL DEFAULT false;
