-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_user_bookmark" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "archive_status" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "slax_user_bookmark_bookmark_id_fkey" FOREIGN KEY ("bookmark_id") REFERENCES "slax_bookmark" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_slax_user_bookmark" ("bookmark_id", "created_at", "id", "is_read", "updated_at", "user_id") SELECT "bookmark_id", "created_at", "id", "is_read", "updated_at", "user_id" FROM "slax_user_bookmark";
DROP TABLE "slax_user_bookmark";
ALTER TABLE "new_slax_user_bookmark" RENAME TO "slax_user_bookmark";
CREATE INDEX "slax_user_bookmark_user_id_archive_status_updated_at_idx" ON "slax_user_bookmark"("user_id", "archive_status", "updated_at");
CREATE UNIQUE INDEX "slax_user_bookmark_user_id_bookmark_id_key" ON "slax_user_bookmark"("user_id", "bookmark_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

