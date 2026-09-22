CREATE TABLE "sr_payment_job" (
  "key" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "lease_token" TEXT,
  "lease_until" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "sr_payment_job_status_kind_idx" ON "sr_payment_job"("status", "kind");
CREATE TABLE "sr_payment_grant" (
  "key" TEXT PRIMARY KEY,
  "user_id" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "period_id" INTEGER UNIQUE,
  "amount" INTEGER NOT NULL DEFAULT 0,
  "refunded" INTEGER NOT NULL DEFAULT 0,
  "minutes" INTEGER NOT NULL DEFAULT 0,
  "revoked" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "sr_payment_grant_user_id_idx" ON "sr_payment_grant"("user_id");
CREATE TABLE "sr_payment_refund" (
  "key" TEXT PRIMARY KEY,
  "grant_key" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "sr_payment_job" ("key", "kind", "payload", "status", "error")
VALUES ('payment:cutover', 'cutover', '{}', 'done', '');
INSERT INTO "sr_payment_job" ("key", "kind", "payload", "status", "error")
SELECT 'stripe:' || live_mode::text || ':' || event_account || ':' || event_id, 'stripe_event',
       jsonb_build_object('eventId', MIN(id)), 'reconciliation', 'Legacy event: entitlement mapping requires review'
FROM sr_stripe_event GROUP BY live_mode, event_account, event_id;
