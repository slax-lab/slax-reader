-- CreateTable
CREATE TABLE "slax_user_subscription_period" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "type" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '',
    "interval" TEXT NOT NULL DEFAULT '',
    "interval_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "slax_user_invite" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT NOT NULL DEFAULT '',
    "invite_user_id" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '',
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "slax_user_subscription" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "stripe_subscription_id" TEXT NOT NULL DEFAULT '',
    "stripe_customer_id" TEXT NOT NULL DEFAULT '',
    "stripe_stripe_currency" TEXT NOT NULL DEFAULT '',
    "first_subscription_time" DATETIME NOT NULL,
    "subscription_end_time" DATETIME NOT NULL,
    "next_invoice_time" DATETIME NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "subscribed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "slax_stripe_event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event_id" TEXT NOT NULL DEFAULT '',
    "event_type" TEXT NOT NULL DEFAULT '',
    "event_data" TEXT NOT NULL DEFAULT '',
    "previous_event_data" TEXT NOT NULL DEFAULT '',
    "live_mode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "slax_user_subscription_period_user_id_idx" ON "slax_user_subscription_period"("user_id");

-- CreateIndex
CREATE INDEX "slax_user_subscription_period_source_idx" ON "slax_user_subscription_period"("source");

-- CreateIndex
CREATE INDEX "slax_user_invite_user_id_idx" ON "slax_user_invite"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "slax_user_subscription_user_id_key" ON "slax_user_subscription"("user_id");

