-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_mark_comment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "type" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "root_id" INTEGER NOT NULL DEFAULT 0,
    "parent_id" INTEGER NOT NULL DEFAULT 0,
    "approx_source" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "source_type" TEXT NOT NULL DEFAULT '',
    "source_id" TEXT NOT NULL DEFAULT '',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_slax_mark_comment" ("bookmark_id", "comment", "content", "created_at", "id", "is_deleted", "parent_id", "root_id", "source", "source_id", "source_type", "type", "updated_at", "user_id") SELECT "bookmark_id", "comment", "content", "created_at", "id", "is_deleted", "parent_id", "root_id", "source", "source_id", "source_type", "type", "updated_at", "user_id" FROM "slax_mark_comment";
DROP TABLE "slax_mark_comment";
ALTER TABLE "new_slax_mark_comment" RENAME TO "slax_mark_comment";
CREATE INDEX "slax_mark_comment_user_id_created_at_is_deleted_idx" ON "slax_mark_comment"("user_id", "created_at", "is_deleted");
CREATE INDEX "slax_mark_comment_bookmark_id_root_id_is_deleted_idx" ON "slax_mark_comment"("bookmark_id", "root_id", "is_deleted");
CREATE INDEX "slax_mark_comment_bookmark_id_type_is_deleted_idx" ON "slax_mark_comment"("bookmark_id", "type", "is_deleted");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

