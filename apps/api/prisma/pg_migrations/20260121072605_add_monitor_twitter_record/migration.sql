-- CreateTable
CREATE TABLE "sr_twitter_mentions_record" (
    "id" SERIAL NOT NULL,
    "tweet_id" TEXT NOT NULL DEFAULT '',
    "reply_tweet_id" TEXT NOT NULL DEFAULT '',
    "mention_twitter_id" TEXT NOT NULL DEFAULT '',
    "mention_twitter_name" TEXT NOT NULL DEFAULT '',
    "mention_content" TEXT NOT NULL DEFAULT '',
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "mention_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_twitter_mentions_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sr_twitter_mentions_record_tweet_id_key" ON "sr_twitter_mentions_record"("tweet_id");
