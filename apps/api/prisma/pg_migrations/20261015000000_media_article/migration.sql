-- Generalise the YouTube article tables to media articles (YouTube and podcasts). Every existing
-- row is a YouTube row; data does not change. The tables keep their names (Prisma maps
-- sr_media_article to sr_youtube_article and source_id to video_id), and the language-aware key of
-- youtube-ai-article stays: YouTube video ids and podcast source ids never collide. Apart from the
-- contract step below, this migration only adds.
-- Contract step of youtube-ai-article: drop the P0 unique key (video_id, source_hash, prompt_version).
-- Only the P0 code upserts on it, so this migration must reach beta only after youtube-ai-article
-- runs in production. Without the drop, a caption version can hold one language row only.
DROP INDEX "sr_youtube_article_video_id_source_hash_prompt_version_key";

ALTER TABLE "sr_youtube_article" ADD COLUMN "media_kind" TEXT NOT NULL DEFAULT 'youtube';
CREATE UNIQUE INDEX "sr_media_article_version_key" ON "sr_youtube_article"("media_kind", "video_id", "source_hash", "target_language", "prompt_version");

ALTER TABLE "sr_youtube_article_ref" ADD COLUMN "media_kind" TEXT NOT NULL DEFAULT 'youtube';
CREATE INDEX "sr_media_article_ref_media_kind_source_id_source_hash_idx" ON "sr_youtube_article_ref"("media_kind", "video_id", "source_hash");

-- One podcast episode per audio URL: metadata and the transcription job. Transcripts are R2 objects
-- under podcast/canonical/transcripts/; articles are sr_media_article rows with media_kind 'podcast'.
CREATE TABLE "sr_podcast_episode" (
    "id" SERIAL NOT NULL,
    "source_id" TEXT NOT NULL,
    "audio_url" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "show_name" TEXT NOT NULL DEFAULT '',
    "author" TEXT NOT NULL DEFAULT '',
    "cover_url" TEXT NOT NULL DEFAULT '',
    "duration_sec" INTEGER,
    "language" TEXT,
    "shownotes" TEXT NOT NULL DEFAULT '',
    "publisher_transcripts" JSONB,
    "transcript_status" TEXT NOT NULL DEFAULT 'pending',
    "transcript_source" TEXT,
    "provider_job_id" TEXT,
    "asr_cost_job_id" TEXT,
    "transcript_key" TEXT,
    "transcript_hash" TEXT,
    "speakers" BOOLEAN NOT NULL DEFAULT false,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "run_id" TEXT,
    "lease_until" TIMESTAMP(3),
    "next_retry_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "sr_podcast_episode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sr_podcast_episode_source_id_key" ON "sr_podcast_episode"("source_id");
CREATE INDEX "sr_podcast_episode_transcript_status_next_retry_at_idx" ON "sr_podcast_episode"("transcript_status", "next_retry_at");
