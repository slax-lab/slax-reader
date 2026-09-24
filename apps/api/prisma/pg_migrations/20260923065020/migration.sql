-- AlterTable
ALTER TABLE "sr_rss_feed" ADD COLUMN     "history_checked_at" TIMESTAMP(3),
ADD COLUMN     "history_retry_at" TIMESTAMP(3),
ADD COLUMN     "history_seen" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "history_url" TEXT;
