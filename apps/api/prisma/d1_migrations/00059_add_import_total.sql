-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_bookmark_import" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT '',
    "object_key" TEXT NOT NULL DEFAULT '',
    "status" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL DEFAULT '',
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "batch_count" INTEGER NOT NULL DEFAULT 0,
    "success_total" INTEGER NOT NULL DEFAULT 0,
    "failed_total" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_slax_bookmark_import" ("batch_count", "created_at", "id", "object_key", "reason", "status", "total_count", "type", "user_id") SELECT "batch_count", "created_at", "id", "object_key", "reason", "status", "total_count", "type", "user_id" FROM "slax_bookmark_import";
DROP TABLE "slax_bookmark_import";
ALTER TABLE "new_slax_bookmark_import" RENAME TO "slax_bookmark_import";
CREATE INDEX "slax_bookmark_import_user_id_idx" ON "slax_bookmark_import"("user_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

