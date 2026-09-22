-- sr_youtube_article: canonical job table for the derived YouTube AI article, one row per
-- (video_id, source_hash, prompt_version). Captions and articles are R2 objects; this row only
-- holds pointers, versions, status and the eligibility result.
CREATE TABLE "sr_youtube_article" (
    "id" SERIAL NOT NULL,
    "video_id" TEXT NOT NULL,
    "caption_key" TEXT,
    "caption_text_key" TEXT,
    "caption_language" TEXT,
    "caption_kind" TEXT,
    "source_hash" TEXT NOT NULL,
    "eligibility_json" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "article_key" TEXT,
    "article_text_key" TEXT,
    "model" TEXT,
    "prompt_version" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "quality_json" JSONB,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMP(3),
    "next_retry_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "sr_youtube_article_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sr_youtube_article_video_id_source_hash_prompt_version_key" ON "sr_youtube_article"("video_id", "source_hash", "prompt_version");

CREATE INDEX "sr_youtube_article_status_next_retry_at_idx" ON "sr_youtube_article"("status", "next_retry_at");

-- sr_youtube_article_ref: which caption version a bookmark saw when it was crawled. One row per
-- bookmark; deleted with the bookmark. Canonical rows with no refs left are swept separately.
CREATE TABLE "sr_youtube_article_ref" (
    "id" SERIAL NOT NULL,
    "bookmark_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "video_id" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sr_youtube_article_ref_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sr_youtube_article_ref_bookmark_id_key" ON "sr_youtube_article_ref"("bookmark_id");

CREATE INDEX "sr_youtube_article_ref_video_id_source_hash_idx" ON "sr_youtube_article_ref"("video_id", "source_hash");

CREATE INDEX "sr_youtube_article_ref_user_id_idx" ON "sr_youtube_article_ref"("user_id");
