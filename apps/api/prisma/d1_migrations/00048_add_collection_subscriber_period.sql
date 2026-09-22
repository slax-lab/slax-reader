-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_user_collection_subscriber_period" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "collection_id" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '',
    "type" INTEGER NOT NULL DEFAULT 0,
    "interval" TEXT NOT NULL DEFAULT '',
    "interval_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_slax_user_collection_subscriber_period" ("collection_id", "created_at", "id", "interval", "interval_count", "source", "user_id") SELECT "collection_id", "created_at", "id", "interval", "interval_count", "source", "user_id" FROM "slax_user_collection_subscriber_period";
DROP TABLE "slax_user_collection_subscriber_period";
ALTER TABLE "new_slax_user_collection_subscriber_period" RENAME TO "slax_user_collection_subscriber_period";
CREATE INDEX "slax_user_collection_subscriber_period_user_id_collection_id_idx" ON "slax_user_collection_subscriber_period"("user_id", "collection_id");
CREATE INDEX "slax_user_collection_subscriber_period_source_idx" ON "slax_user_collection_subscriber_period"("source");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

