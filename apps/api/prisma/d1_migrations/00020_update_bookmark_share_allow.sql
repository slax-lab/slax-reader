-- DropIndex
DROP INDEX "slax_mark_comment_bookmark_id_idx";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_bookmark_share" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "share_code" TEXT NOT NULL DEFAULT '',
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "show_line" BOOLEAN NOT NULL DEFAULT false,
    "show_comment" BOOLEAN NOT NULL DEFAULT false,
    "show_userinfo" BOOLEAN NOT NULL DEFAULT false,
    "allow_comment" BOOLEAN NOT NULL DEFAULT false,
    "allow_line" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_slax_bookmark_share" ("bookmark_id", "created_at", "id", "share_code", "show_comment", "show_line", "show_userinfo", "user_id") SELECT "bookmark_id", "created_at", "id", "share_code", "show_comment", "show_line", "show_userinfo", "user_id" FROM "slax_bookmark_share";
DROP TABLE "slax_bookmark_share";
ALTER TABLE "new_slax_bookmark_share" RENAME TO "slax_bookmark_share";
CREATE UNIQUE INDEX "slax_bookmark_share_share_code_key" ON "slax_bookmark_share"("share_code");
CREATE UNIQUE INDEX "slax_bookmark_share_bookmark_id_user_id_key" ON "slax_bookmark_share"("bookmark_id", "user_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

