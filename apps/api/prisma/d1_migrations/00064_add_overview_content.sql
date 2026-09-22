-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_user_bookmark_overview" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "overview" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_slax_user_bookmark_overview" ("bookmark_id", "created_at", "id", "overview", "user_id") SELECT "bookmark_id", "created_at", "id", "overview", "user_id" FROM "slax_user_bookmark_overview";
DROP TABLE "slax_user_bookmark_overview";
ALTER TABLE "new_slax_user_bookmark_overview" RENAME TO "slax_user_bookmark_overview";
CREATE INDEX "slax_user_bookmark_overview_bookmark_id_user_id_idx" ON "slax_user_bookmark_overview"("bookmark_id", "user_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

