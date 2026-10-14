-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_user_tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "tag_name" TEXT NOT NULL DEFAULT '',
    "system_tag" BOOLEAN NOT NULL DEFAULT false,
    "display" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_slax_user_tag" ("created_at", "id", "system_tag", "tag_name", "user_id") SELECT "created_at", "id", "system_tag", "tag_name", "user_id" FROM "slax_user_tag";
DROP TABLE "slax_user_tag";
ALTER TABLE "new_slax_user_tag" RENAME TO "slax_user_tag";
CREATE UNIQUE INDEX "slax_user_tag_user_id_tag_name_key" ON "slax_user_tag"("user_id", "tag_name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

