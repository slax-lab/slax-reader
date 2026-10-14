-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_user_collection_subscriber" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "collection_id" INTEGER NOT NULL DEFAULT 0,
    "owner_id" INTEGER NOT NULL DEFAULT 0,
    "stripe_customer_id" TEXT NOT NULL DEFAULT '',
    "subscription_end_time" DATETIME NOT NULL,
    "next_invoice_time" DATETIME NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_slax_user_collection_subscriber" ("auto_renew", "collection_id", "created_at", "id", "next_invoice_time", "owner_id", "stripe_customer_id", "subscription_end_time", "updated_at", "user_id") SELECT "auto_renew", "collection_id", "created_at", "id", "next_invoice_time", "owner_id", "stripe_customer_id", "subscription_end_time", "updated_at", "user_id" FROM "slax_user_collection_subscriber";
DROP TABLE "slax_user_collection_subscriber";
ALTER TABLE "new_slax_user_collection_subscriber" RENAME TO "slax_user_collection_subscriber";
CREATE UNIQUE INDEX "slax_user_collection_subscriber_user_id_collection_id_key" ON "slax_user_collection_subscriber"("user_id", "collection_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

