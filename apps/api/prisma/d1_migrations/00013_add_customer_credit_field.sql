-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_user_subscription" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "stripe_subscription_id" TEXT NOT NULL DEFAULT '',
    "stripe_customer_id" TEXT NOT NULL DEFAULT '',
    "stripe_stripe_currency" TEXT NOT NULL DEFAULT '',
    "first_subscription_time" DATETIME NOT NULL,
    "subscription_end_time" DATETIME NOT NULL,
    "next_invoice_time" DATETIME NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "stripe_credit" INTEGER NOT NULL DEFAULT 0,
    "subscribed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_slax_user_subscription" ("auto_renew", "created_at", "first_subscription_time", "id", "next_invoice_time", "stripe_customer_id", "stripe_stripe_currency", "stripe_subscription_id", "subscribed", "subscription_end_time", "user_id") SELECT "auto_renew", "created_at", "first_subscription_time", "id", "next_invoice_time", "stripe_customer_id", "stripe_stripe_currency", "stripe_subscription_id", "subscribed", "subscription_end_time", "user_id" FROM "slax_user_subscription";
DROP TABLE "slax_user_subscription";
ALTER TABLE "new_slax_user_subscription" RENAME TO "slax_user_subscription";
CREATE UNIQUE INDEX "slax_user_subscription_user_id_key" ON "slax_user_subscription"("user_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

