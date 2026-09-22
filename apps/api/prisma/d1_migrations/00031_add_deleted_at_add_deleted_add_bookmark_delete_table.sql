-- AlterTable
ALTER TABLE "slax_user_bookmark" ADD COLUMN "deleted_at" DATETIME;

-- CreateTable
CREATE TABLE "slax_user_delete_bookmark" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" DATETIME,
    CONSTRAINT "slax_user_delete_bookmark_user_id_bookmark_id_fkey" FOREIGN KEY ("user_id", "bookmark_id") REFERENCES "slax_user_bookmark" ("user_id", "bookmark_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_user_bookmark_tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "tag_name" TEXT NOT NULL DEFAULT '',
    "tag_id" INTEGER NOT NULL DEFAULT 0,
    "system_tag" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "slax_user_bookmark_tag_user_id_bookmark_id_fkey" FOREIGN KEY ("user_id", "bookmark_id") REFERENCES "slax_user_bookmark" ("user_id", "bookmark_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "slax_user_bookmark_tag_bookmark_id_fkey" FOREIGN KEY ("bookmark_id") REFERENCES "slax_bookmark" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_slax_user_bookmark_tag" ("bookmark_id", "created_at", "id", "system_tag", "tag_id", "tag_name", "user_id") SELECT "bookmark_id", "created_at", "id", "system_tag", "tag_id", "tag_name", "user_id" FROM "slax_user_bookmark_tag";
DROP TABLE "slax_user_bookmark_tag";
ALTER TABLE "new_slax_user_bookmark_tag" RENAME TO "slax_user_bookmark_tag";
CREATE INDEX "slax_user_bookmark_tag_tag_id_user_id_idx" ON "slax_user_bookmark_tag"("tag_id", "user_id");
CREATE UNIQUE INDEX "slax_user_bookmark_tag_bookmark_id_user_id_tag_id_key" ON "slax_user_bookmark_tag"("bookmark_id", "user_id", "tag_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "slax_user_delete_bookmark_user_id_bookmark_id_key" ON "slax_user_delete_bookmark"("user_id", "bookmark_id");

