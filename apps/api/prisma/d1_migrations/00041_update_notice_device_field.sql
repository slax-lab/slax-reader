-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_user_notice_device" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_slax_user_notice_device" ("created_at", "id", "type", "user_id") SELECT "created_at", "id", "type", "user_id" FROM "slax_user_notice_device";
DROP TABLE "slax_user_notice_device";
ALTER TABLE "new_slax_user_notice_device" RENAME TO "slax_user_notice_device";
CREATE INDEX "slax_user_notice_device_user_id_type_idx" ON "slax_user_notice_device"("user_id", "type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

