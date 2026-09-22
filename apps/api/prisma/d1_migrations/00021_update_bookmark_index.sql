-- DropIndex
DROP INDEX "slax_user_bookmark_user_id_is_starred_updated_at_idx";

-- DropIndex
DROP INDEX "slax_user_bookmark_user_id_archive_status_updated_at_idx";

-- CreateTable
CREATE TABLE "slax_user_tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "tag_name" TEXT NOT NULL DEFAULT '',
    "system_tag" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "slax_user_bookmark_tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "tag_name" TEXT NOT NULL DEFAULT '',
    "system_tag" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "slax_user_tag_user_id_tag_name_key" ON "slax_user_tag"("user_id", "tag_name");

-- CreateIndex
CREATE UNIQUE INDEX "slax_user_bookmark_tag_bookmark_id_user_id_tag_name_key" ON "slax_user_bookmark_tag"("bookmark_id", "user_id", "tag_name");

