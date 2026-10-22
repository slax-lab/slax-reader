-- One AI article per target language: add target_language to sr_youtube_article and make it
-- part of the unique key. Rows written by P0 (shadow gate only, no article yet) become the
-- English version, or the Chinese version when the captions are Chinese.
ALTER TABLE "sr_youtube_article" ADD COLUMN "target_language" TEXT NOT NULL DEFAULT 'en';

UPDATE "sr_youtube_article" SET "target_language" = 'zh' WHERE "caption_language" LIKE 'zh%';

-- Expand only: the old unique key (video_id, source_hash, prompt_version) stays, because the code
-- serving production still upserts on it while beta runs this migration. Until the contract
-- migration drops it, a version holds one language row; the code handles the conflict.

CREATE UNIQUE INDEX "sr_youtube_article_video_id_source_hash_target_language_pro_key" ON "sr_youtube_article"("video_id", "source_hash", "target_language", "prompt_version");

-- run_id: the workflow instance that holds the row. Every write of a running attempt is conditioned
-- on it, so a stale or duplicate run can never renew, publish or finish someone else's attempt.
-- cost_usd: estimated model spend of this version across all attempts; the per-video budget.
ALTER TABLE "sr_youtube_article" ADD COLUMN "run_id" TEXT;
ALTER TABLE "sr_youtube_article" ADD COLUMN "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0;
