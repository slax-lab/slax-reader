-- CreateTable
CREATE TABLE "sr_newsletter_feed" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "source_key" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL DEFAULT '',
    "message_key" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL DEFAULT '',
    "excerpt" TEXT NOT NULL DEFAULT '',
    "content_key" TEXT,
    "content_truncated" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_newsletter_feed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sr_newsletter_feed_user_id_received_at_id_idx" ON "sr_newsletter_feed"("user_id", "received_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "sr_newsletter_feed_user_id_source_key_received_at_id_idx" ON "sr_newsletter_feed"("user_id", "source_key", "received_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sr_newsletter_feed_user_id_source_key_message_key_key" ON "sr_newsletter_feed"("user_id", "source_key", "message_key");
