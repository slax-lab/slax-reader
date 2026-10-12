-- CreateTable
CREATE TABLE "sr_rss_feed" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "feed_url" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "site_url" TEXT,
    "etag" TEXT,
    "last_modified" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "next_fetch_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_allowed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_rss_feed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sr_rss_subscription" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "user_id" INTEGER NOT NULL,
    "feed_id" TEXT NOT NULL,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_rss_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sr_rss_entry" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "feed_id" TEXT NOT NULL,
    "entry_key" TEXT NOT NULL,
    "article_url" TEXT,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "summary" TEXT NOT NULL,
    "content_key" TEXT NOT NULL,
    "content_truncated" BOOLEAN NOT NULL DEFAULT false,
    "image_url" TEXT,
    "published_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sort_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_rss_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sr_rss_save_job" (
    "bookmark_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_rss_save_job_pkey" PRIMARY KEY ("bookmark_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sr_rss_feed_feed_url_key" ON "sr_rss_feed"("feed_url");

-- CreateIndex
CREATE INDEX "sr_rss_feed_due" ON "sr_rss_feed"("next_fetch_at");

-- CreateIndex
CREATE INDEX "sr_rss_subscription_feed" ON "sr_rss_subscription"("feed_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_rss_subscription_user_id_feed_id_key" ON "sr_rss_subscription"("user_id", "feed_id");

-- CreateIndex
CREATE INDEX "sr_rss_entry_page" ON "sr_rss_entry"("feed_id", "sort_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "sr_rss_entry_expiry" ON "sr_rss_entry"("first_seen_at");

-- CreateIndex
CREATE INDEX "sr_rss_entry_content" ON "sr_rss_entry"("content_key");

-- CreateIndex
CREATE UNIQUE INDEX "sr_rss_entry_feed_id_entry_key_key" ON "sr_rss_entry"("feed_id", "entry_key");

-- CreateIndex
CREATE INDEX "sr_rss_save_job_user" ON "sr_rss_save_job"("user_id");
