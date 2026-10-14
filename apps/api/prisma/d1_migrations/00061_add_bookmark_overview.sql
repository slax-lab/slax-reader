DELETE FROM "slax_user_bookmark_tag" WHERE `system_tag` = 1;
DELETE FROM 'slax_user_tag' WHERE `system_tag` = 1;

-- CreateTable
CREATE TABLE "slax_user_bookmark_overview" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "overview" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "slax_user_bookmark_tag_user_id_bookmark_id_fkey" FOREIGN KEY ("user_id", "bookmark_id") REFERENCES "slax_user_bookmark" ("user_id", "bookmark_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "slax_user_bookmark_tag_bookmark_id_fkey" FOREIGN KEY ("bookmark_id") REFERENCES "slax_bookmark" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_slax_user_bookmark_tag" ("bookmark_id", "created_at", "id", "is_deleted", "tag_id", "tag_name", "user_id") SELECT "bookmark_id", "created_at", "id", "is_deleted", "tag_id", "tag_name", "user_id" FROM "slax_user_bookmark_tag";
DROP TABLE "slax_user_bookmark_tag";
ALTER TABLE "new_slax_user_bookmark_tag" RENAME TO "slax_user_bookmark_tag";
CREATE INDEX "slax_user_bookmark_tag_tag_id_user_id_is_deleted_idx" ON "slax_user_bookmark_tag"("tag_id", "user_id", "is_deleted");
CREATE INDEX "slax_user_bookmark_tag_bookmark_id_user_id_is_deleted_idx" ON "slax_user_bookmark_tag"("bookmark_id", "user_id", "is_deleted");
CREATE UNIQUE INDEX "slax_user_bookmark_tag_bookmark_id_user_id_tag_id_key" ON "slax_user_bookmark_tag"("bookmark_id", "user_id", "tag_id");
CREATE TABLE "new_slax_user_tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "tag_name" TEXT NOT NULL DEFAULT '',
    "display" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_slax_user_tag" ("created_at", "display", "id", "tag_name", "user_id") SELECT "created_at", "display", "id", "tag_name", "user_id" FROM "slax_user_tag";
DROP TABLE "slax_user_tag";
ALTER TABLE "new_slax_user_tag" RENAME TO "slax_user_tag";
CREATE UNIQUE INDEX "slax_user_tag_user_id_tag_name_key" ON "slax_user_tag"("user_id", "tag_name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "slax_user_bookmark_overview_bookmark_id_user_id_idx" ON "slax_user_bookmark_overview"("bookmark_id", "user_id");

