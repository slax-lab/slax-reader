-- CreateTable
CREATE TABLE "slax_user_collection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" INTEGER NOT NULL DEFAULT 0,
    "owner_id" INTEGER NOT NULL DEFAULT 0,
    "display_name" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT '',
    "collection_code" TEXT NOT NULL DEFAULT '',
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "slax_user_collection_subscriber_period" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "collection_id" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '',
    "interval" TEXT NOT NULL DEFAULT '',
    "interval_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "slax_user_collection_subscriber" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "collection_id" INTEGER NOT NULL DEFAULT 0,
    "owner_id" INTEGER NOT NULL DEFAULT 0,
    "stripe_customer_id" TEXT NOT NULL DEFAULT '',
    "subscription_end_time" DATETIME NOT NULL,
    "next_invoice_time" DATETIME NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "slax_user_collection_owner_id_key" ON "slax_user_collection"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "slax_user_collection_collection_code_key" ON "slax_user_collection"("collection_code");
