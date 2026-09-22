-- DropIndex
DROP INDEX "public"."sr_apple_notification_event_app_account_token_idx";

-- CreateIndex
CREATE INDEX "sr_apple_notification_event_product_id_app_account_token_idx" ON "sr_apple_notification_event"("product_id", "app_account_token");
