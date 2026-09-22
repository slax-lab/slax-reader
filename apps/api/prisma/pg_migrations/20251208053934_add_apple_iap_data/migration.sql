-- AlterTable
ALTER TABLE "sr_user_subscription" ADD COLUMN     "apple_original_transaction_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "source_type" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "sr_apple_notification_event" (
    "id" SERIAL NOT NULL,
    "app_account_token" TEXT NOT NULL DEFAULT '',
    "original_transaction_id" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_apple_notification_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sr_apple_notification_event_app_account_token_idx" ON "sr_apple_notification_event"("app_account_token");

UPDATE "sr_user_subscription"
SET "source_type" = CASE
    WHEN "stripe_subscription_id" != '' THEN 'stripe'
    ELSE 'system'
END
WHERE "source_type" = '';
