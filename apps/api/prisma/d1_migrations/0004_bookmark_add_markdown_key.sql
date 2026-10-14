-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_bookmark" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL DEFAULT '',
    "host_url" TEXT NOT NULL DEFAULT '',
    "target_url" TEXT NOT NULL DEFAULT '',
    "site_name" TEXT NOT NULL DEFAULT '',
    "content_icon" TEXT NOT NULL DEFAULT '',
    "content_cover" TEXT NOT NULL DEFAULT '',
    "content_key" TEXT NOT NULL DEFAULT '',
    "content_md_key" TEXT NOT NULL DEFAULT '',
    "content_word_count" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "byline" TEXT NOT NULL DEFAULT '',
    "private_user" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "published_at" DATETIME NOT NULL
);
INSERT INTO "new_slax_bookmark" ("byline", "content_cover", "content_icon", "content_key", "content_word_count", "created_at", "description", "host_url", "id", "private_user", "published_at", "site_name", "status", "target_url", "title", "updated_at") SELECT "byline", "content_cover", "content_icon", "content_key", "content_word_count", "created_at", "description", "host_url", "id", "private_user", "published_at", "site_name", "status", "target_url", "title", "updated_at" FROM "slax_bookmark";
DROP TABLE "slax_bookmark";
ALTER TABLE "new_slax_bookmark" RENAME TO "slax_bookmark";
CREATE UNIQUE INDEX "slax_bookmark_target_url_private_user_key" ON "slax_bookmark"("target_url", "private_user");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

