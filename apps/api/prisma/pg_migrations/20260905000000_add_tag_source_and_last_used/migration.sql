-- sr_user_tag: vocabulary ownership + recency
ALTER TABLE "sr_user_tag" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "sr_user_tag" ADD COLUMN "last_used_at" TIMESTAMP(3);

-- sr_user_bookmark_tag: who attached the tag ("user" | "ai"), "" for history
ALTER TABLE "sr_user_bookmark_tag" ADD COLUMN "source" TEXT NOT NULL DEFAULT '';

CREATE INDEX "sr_user_tag_user_id_display_source_idx" ON "sr_user_tag"("user_id", "display", "source");

-- Backfill last_used_at from the newest live link. History cannot tell user from AI,
-- so every existing link counts once.
UPDATE "sr_user_tag" t SET "last_used_at" = (
  SELECT MAX(bt."created_at") FROM "sr_user_bookmark_tag" bt
  WHERE bt."tag_id" = t."id" AND bt."user_id" = t."user_id" AND bt."is_deleted" = false
);
