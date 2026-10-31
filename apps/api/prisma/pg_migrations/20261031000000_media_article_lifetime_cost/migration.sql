-- Total spend of an article version across every explicit retry. cost_usd restarts at 0 on a
-- retry that recovers the budget; lifetime_cost_usd never restarts and carries the hard cap.
-- Expand-only: code that does not know the column keeps working.
ALTER TABLE "sr_youtube_article" ADD COLUMN "lifetime_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Rows spent before this column existed.
UPDATE "sr_youtube_article" SET "lifetime_cost_usd" = "cost_usd" WHERE "cost_usd" > 0;
