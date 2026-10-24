ALTER TABLE "sr_rss_feed" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'rss';
ALTER TABLE "sr_rss_feed" ADD CONSTRAINT "sr_rss_feed_kind" CHECK (kind IN ('rss','newsletter'));
CREATE TABLE "sr_newsletter_address" (
 "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "user_id" INTEGER NOT NULL,
 "domain" TEXT NOT NULL,
 "local_part" TEXT NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "retired_at" TIMESTAMP(3),
 CONSTRAINT "sr_newsletter_address_canonical" CHECK (domain=lower(domain) AND local_part=lower(local_part))
);
CREATE UNIQUE INDEX "sr_newsletter_address_domain_local_part_key" ON "sr_newsletter_address"("domain","local_part");
CREATE UNIQUE INDEX "sr_newsletter_address_user_id_domain_key" ON "sr_newsletter_address"("user_id","domain");
CREATE TABLE "sr_newsletter_receipt" (
 "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "user_id" INTEGER NOT NULL,
 "address_id" TEXT NOT NULL,
 "source_key" TEXT NOT NULL,
 "message_key" TEXT NOT NULL,
 "raw_key" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','done','cancelled')),
 "lease_token" TEXT,
 "lease_until" TIMESTAMP(3),
 "retry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "attempts" INTEGER NOT NULL DEFAULT 0,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completed_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "sr_newsletter_receipt_user_id_source_key_message_key_key" ON "sr_newsletter_receipt"("user_id","source_key","message_key");
CREATE INDEX "sr_newsletter_receipt_state_retry_at_idx" ON "sr_newsletter_receipt"("state","retry_at");
CREATE INDEX "sr_newsletter_receipt_user_id_created_at_idx" ON "sr_newsletter_receipt"("user_id","created_at");
CREATE INDEX "sr_newsletter_receipt_raw_key_idx" ON "sr_newsletter_receipt"("raw_key");
